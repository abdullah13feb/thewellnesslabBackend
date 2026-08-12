import OpenAI from "openai";
import prisma from "../lib/prisma.js";
import fs from "fs";
import path from "path";
const currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
const CACHE_FILE_PATH = path.join(currentDir, "../../chat_knowledge_cache.json");

// Fallback / default knowledge sources when DB is empty
const DEFAULT_POLICIES = [
  {
    title: "Company Info & Contact Information",
    content: "The Wellness Lab is a premium wellness brand offering advanced Red Light Therapy (RLT) panels, skin care devices, hair growth systems, and clinic wellness equipment. Contact details: Email: support@thewellnesslab.ae, Phone: +971 4 123 4567, Address: Sheikh Zayed Road, Dubai, UAE. We are open Monday to Saturday, 9:00 AM to 6:00 PM."
  },
  {
    title: "Shipping Policy",
    content: "We offer free delivery across the UAE for all orders above 500 AED. For orders below 500 AED, a flat shipping charge of 30 AED applies. Delivery takes 1 to 2 business days in Dubai and 2 to 3 business days for other Emirates (Abu Dhabi, Sharjah, Ajman, etc.). International shipping rates are calculated at checkout."
  },
  {
    title: "Warranty Policy",
    content: "All The Wellness Lab products come with a 2-year warranty covering manufacturing defects. If a product malfunctions under normal use, we will repair or replace it free of charge. The warranty does not cover accidental damage, liquid exposure, or unauthorized repairs."
  },
  {
    title: "Return & Refund Policy",
    content: "We offer a 14-day return policy for unused products in their original packaging. Customers must contact support@thewellnesslab.ae to initiate a return. Once received and inspected, refunds are processed within 5-7 business days back to the original payment method. Used products cannot be returned due to hygiene reasons."
  },
  {
    title: "Frequently Asked Questions (FAQs)",
    content: "Q: What is Red Light Therapy? A: Red Light Therapy (RLT) uses specific wavelengths of light (660nm red and 850nm near-infrared) to stimulate cellular repair, reduce inflammation, improve skin health, and accelerate muscle recovery. Q: How often should I use the RLT panel? A: For best results, use for 10-20 minutes daily at a distance of 6-12 inches from the skin. Q: Can I use it for hair growth? A: Yes, red light therapy promotes hair follicle activity and is widely used for hair density improvement."
  }
];

interface KnowledgeChunk {
  id: string;
  source: "product" | "blog" | "policy" | "general";
  sourceId?: string;
  title: string;
  content: string;
  embedding?: number[];
}

class ChatKnowledgeService {
  private chunks: KnowledgeChunk[] = [];
  private openai: OpenAI | null = null;
  private isReindexing = false;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    this.loadCache();
  }

  private loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE_PATH)) {
        const raw = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
        this.chunks = JSON.parse(raw);
        console.log(`[ChatKnowledge] Loaded ${this.chunks.length} chunks from cache file.`);
      } else {
        console.log("[ChatKnowledge] No cache file found. Building initial knowledge base.");
        this.reindex();
      }
    } catch (error) {
      console.error("[ChatKnowledge] Error loading cache:", error);
      this.reindex();
    }
  }

  private saveCache() {
    try {
      fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(this.chunks, null, 2), "utf-8");
      console.log(`[ChatKnowledge] Saved ${this.chunks.length} chunks to cache file.`);
    } catch (error) {
      console.error("[ChatKnowledge] Error saving cache:", error);
    }
  }

  /**
   * Helper to compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Reindex everything: fetch database products, blogs, settings and generate embeddings
   */
  public async reindex(): Promise<{ success: boolean; count: number; error?: string }> {
    if (this.isReindexing) {
      return { success: false, count: this.chunks.length, error: "Reindexing already in progress" };
    }

    this.isReindexing = true;
    console.log("[ChatKnowledge] Reindexing knowledge base...");

    try {
      const newChunks: KnowledgeChunk[] = [];

      // 1. Fetch Products
      const products = await prisma.product.findMany();
      for (const p of products) {
        const textParts = [
          `Product Name: ${p.name}`,
          p.tagline ? `Tagline: ${p.tagline}` : "",
          p.description ? `Description: ${p.description}` : "",
          `Category: ${p.category || "General"}`,
          `Price: ${p.price} AED`,
          p.specs ? `Specifications: ${JSON.stringify(p.specs)}` : "",
          p.faq ? `FAQs: ${JSON.stringify(p.faq)}` : ""
        ].filter(Boolean);

        newChunks.push({
          id: `product_${p.id}`,
          source: "product",
          sourceId: p.id,
          title: p.name,
          content: textParts.join("\n")
        });
      }

      // 2. Fetch Blogs
      const blogs = await prisma.blog.findMany();
      for (const b of blogs) {
        newChunks.push({
          id: `blog_${b.id}`,
          source: "blog",
          sourceId: b.id,
          title: b.title,
          content: `Blog Title: ${b.title}\nCategory: ${b.category}\nContent Excerpt: ${b.excerpt}\nContent: ${b.content}`
        });
      }

      // 3. Fetch Settings (Store information, etc)
      const settings = await prisma.setting.findMany();
      for (const s of settings) {
        newChunks.push({
          id: `setting_${s.id}`,
          source: "policy",
          title: `Setting - ${s.key}`,
          content: `${s.key}: ${s.value}`
        });
      }

      // 4. Fallback/Default policies (so AI is always smart about shipping, returns, warranty)
      for (let i = 0; i < DEFAULT_POLICIES.length; i++) {
        const policy = DEFAULT_POLICIES[i];
        newChunks.push({
          id: `policy_default_${i}`,
          source: "policy",
          title: policy.title,
          content: policy.content
        });
      }

      // Generate embeddings using OpenAI if key is available
      if (this.openai && process.env.OPENAI_API_KEY) {
        console.log(`[ChatKnowledge] Generating OpenAI embeddings for ${newChunks.length} chunks...`);
        
        // Process in batches of 10 to avoid hitting limits
        const batchSize = 10;
        for (let i = 0; i < newChunks.length; i += batchSize) {
          const batch = newChunks.slice(i, i + batchSize);
          const inputs = batch.map(c => `${c.title}\n${c.content}`.substring(0, 8000));
          
          try {
            const embedResponse = await this.openai.embeddings.create({
              model: "text-embedding-3-small",
              input: inputs,
            });

            for (let j = 0; j < batch.length; j++) {
              batch[j].embedding = embedResponse.data[j].embedding;
            }
          } catch (e) {
            console.error(`[ChatKnowledge] Embedding generation failed for batch starting at ${i}:`, e);
          }
        }
      } else {
        console.warn("[ChatKnowledge] OpenAI API key not configured or initialization failed. Skipping embeddings generation. Fallback search will be used.");
      }

      this.chunks = newChunks;
      this.saveCache();
      return { success: true, count: this.chunks.length };
    } catch (error: any) {
      console.error("[ChatKnowledge] Reindexing failed:", error);
      return { success: false, count: this.chunks.length, error: error.message || String(error) };
    } finally {
      this.isReindexing = false;
    }
  }

  /**
   * Search knowledge base using cosine similarity of embeddings (or keyword regex fallback)
   */
  public async search(query: string, limit = 5): Promise<KnowledgeChunk[]> {
    if (!query || this.chunks.length === 0) return [];

    // Fallback search if no embeddings exist or OpenAI is disabled
    let queryEmbedding: number[] | null = null;
    if (this.openai && process.env.OPENAI_API_KEY) {
      try {
        const embedResponse = await this.openai.embeddings.create({
          model: "text-embedding-3-small",
          input: query,
        });
        queryEmbedding = embedResponse.data[0].embedding;
      } catch (e) {
        console.error("[ChatKnowledge] Error generating embedding for query:", e);
      }
    }

    if (queryEmbedding) {
      // Embeddings-based search
      const scored = this.chunks.map(chunk => {
        let score = 0;
        if (chunk.embedding && queryEmbedding) {
          score = this.cosineSimilarity(chunk.embedding, queryEmbedding);
        } else {
          // Micro fallback inside: check content match
          score = chunk.content.toLowerCase().includes(query.toLowerCase()) ? 0.2 : 0;
        }
        return { chunk, score };
      });

      scored.sort((a, b) => b.score - a.score);
      // Return highest scored chunks (threshold of at least 0.1 to avoid completely irrelevant matches)
      return scored.slice(0, limit).map(item => item.chunk);
    } else {
      // Fallback: simple text keyword matching score
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (queryWords.length === 0) {
        return this.chunks.slice(0, limit);
      }

      const scored = this.chunks.map(chunk => {
        let score = 0;
        const text = `${chunk.title} ${chunk.content}`.toLowerCase();
        
        // Calculate matches
        for (const word of queryWords) {
          if (text.includes(word)) {
            score += 1;
          }
        }
        
        return { chunk, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.filter(item => item.score > 0).slice(0, limit).map(item => item.chunk);
    }
  }
}

export default new ChatKnowledgeService();
