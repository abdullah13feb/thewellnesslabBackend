import OpenAI from "openai";
import chatKnowledgeService from "./chat-knowledge.service.js";
import prisma from "../lib/prisma.js";
import { ChatSession, ChatMessage } from "@prisma/client";

class ChatAIService {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  /**
   * Determine if a user's message should trigger a human handoff automatically
   */
  public shouldHandoff(message: string): boolean {
    const text = message.toLowerCase();
    
    // Exact list of keywords/scenarios requested:
    // 1. Customer requests a human/agent
    // 2. Customer asks for quotation / quote
    // 3. Customer asks for discount / coupon
    // 4. Customer asks for bulk order / wholesale
    // 5. Customer asks for clinic pricing / corporate pricing
    const handoffTriggers = [
      "human", "agent", "person", "representative", "consultant", "salesman", "salesperson", "support team", "live support",
      "quotation", "quote", "pricing quote", "send quote",
      "discount", "promo", "coupon", "offer", "deal", "reduction",
      "bulk", "wholesale", "large order", "volume order", "batch order",
      "clinic pricing", "clinic purchase", "b2b pricing", "hospital pricing"
    ];

    return handoffTriggers.some(trigger => text.includes(trigger));
  }

  /**
   * Classify lead (HOT, WARM, COLD) and score (0-100) based on message history
   */
  public async classifyLead(messages: { role: string; content: string }[]): Promise<{ leadScore: "HOT" | "WARM" | "COLD"; leadScoreNum: number }> {
    if (!this.openai || messages.length === 0) {
      return { leadScore: "COLD", leadScoreNum: 10 };
    }

    const conversationText = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
    
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a CRM Lead Classifier. Analyze the conversation history and classify the visitor as:
- HOT: Wants pricing, quotes, consultation, wants to buy, or ready to order.
- WARM: Comparing products, asking for specific features, wants recommendations, showing active interest.
- COLD: General information, educational questions, casual curiosity.

Provide your evaluation strictly in JSON format with two keys:
"score": an integer from 0 to 100
"category": "HOT" | "WARM" | "COLD"`
          },
          {
            role: "user",
            content: conversationText
          }
        ],
        response_format: { type: "json_object" }
      });

      const resText = response.choices[0]?.message?.content;
      if (resText) {
        const parsed = JSON.parse(resText);
        return {
          leadScore: parsed.category as "HOT" | "WARM" | "COLD",
          leadScoreNum: Number(parsed.score)
        };
      }
    } catch (e) {
      console.error("[ChatAI] Error classifying lead:", e);
    }

    return { leadScore: "COLD", leadScoreNum: 20 };
  }

  /**
   * Generate conversation summary, intent and recommended actions
   */
  public async generateSummary(
    session: ChatSession & { messages: ChatMessage[] }
  ): Promise<{ aiSummary: string; aiIntent: string; aiAction: string }> {
    if (!this.openai || session.messages.length === 0) {
      return {
        aiSummary: "No summary available.",
        aiIntent: "General Inquiry",
        aiAction: "Reach out to lead."
      };
    }

    const conversationText = session.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a CRM Chat Summarizer. Synthesize the chat history. Output a JSON object with:
"summary": A clean short summary (max 3 lines) of what was discussed.
"intent": Short buyer intent (e.g. "High Purchase Intent", "Comparing Features", "Educational").
"action": Recommended action for sales agent (e.g. "Provide quotation for Panel X", "Explain warranty").`
          },
          {
            role: "user",
            content: conversationText
          }
        ],
        response_format: { type: "json_object" }
      });

      const resText = response.choices[0]?.message?.content;
      if (resText) {
        const parsed = JSON.parse(resText);
        return {
          aiSummary: parsed.summary,
          aiIntent: parsed.intent,
          aiAction: parsed.action
        };
      }
    } catch (e) {
      console.error("[ChatAI] Error generating summary:", e);
    }

    return {
      aiSummary: `Visitor is interested in ${session.interestedIn || "wellness products"}.`,
      aiIntent: "Unknown Intent",
      aiAction: "Contact lead."
    };
  }

  /**
   * Generate next reply from the AI Bot, using RAG context
   */
  public async generateResponse(
    session: ChatSession,
    messages: { role: string; content: string }[]
  ): Promise<{ content: string; confidence: number; recommendedProducts: string[] }> {
    const latestUserMsg = messages[messages.length - 1]?.content || "";

    // 1. Search knowledge base
    const chunks = await chatKnowledgeService.search(latestUserMsg, 4);
    const contextText = chunks.map(c => `[Context: ${c.title}]\n${c.content}`).join("\n\n");

    // 2. Build system instructions
    const systemPrompt = `You are the AI Product Assistant for The Wellness Lab.
You help visitors discover products, answer questions using the company knowledge base, and qualify leads.

Here is the retrieved business knowledge to use:
---
${contextText}
---

Visitor Details:
- Name: ${session.visitorName}
- Interested In: ${session.interestedIn || "Not specified"}
- Looking for: ${session.helpWith || "Not specified"}

CRITICAL RULES:
1. Always base your answer ONLY on the retrieved business knowledge above.
2. NEVER hallucinate or make up facts.
3. If the answer cannot be found in the knowledge base, politely say you don't have that information and offer to connect them with a human agent.
4. Keep answers conversational, natural, and helpful. Use clear formatting.
5. If recommending products, refer to products in the context.
6. Return your response in JSON format containing:
   - "message": The response text to show the user.
   - "confidence": Your confidence score from 0.0 to 1.0 (set low if you cannot answer from context).
   - "recommendedProducts": String array of product slugs or names mentioned or recommended in this response.`;

    if (!this.openai) {
      return {
        content: "I'm having trouble connecting to my AI core right now, but I can get a human consultant to help you! Would you like me to transfer you?",
        confidence: 0.1,
        recommendedProducts: []
      };
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))
        ],
        response_format: { type: "json_object" }
      });

      const resText = response.choices[0]?.message?.content;
      if (resText) {
        const parsed = JSON.parse(resText);
        return {
          content: parsed.message || "How can I help you today?",
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.9,
          recommendedProducts: Array.isArray(parsed.recommendedProducts) ? parsed.recommendedProducts : []
        };
      }
    } catch (e) {
      console.error("[ChatAI] Error generating AI response:", e);
    }

    return {
      content: "I'm here to help! If you'd like to speak with our sales team directly, just let me know and I will transfer you.",
      confidence: 0.5,
      recommendedProducts: []
    };
  }
}

export default new ChatAIService();
