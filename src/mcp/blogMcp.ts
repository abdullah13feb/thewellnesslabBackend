// Remote MCP server for the blog: lets an AI assistant (claude.ai custom connector, ChatGPT connector,
// Claude Code, Claude Desktop) write posts, check them against the SEO and AEO plan, upload images to S3,
// and save, schedule or publish posts. It cannot delete posts.
//
// URL:  POST /api/mcp/<BLOG_MCP_KEY>     (key in the URL, for apps that only take a URL)
//       POST /api/mcp  + x-api-key header (for Claude Code / Desktop)
// The key is a blog-only secret (env BLOG_MCP_KEY), separate from the admin API keys.
// Stateless Streamable HTTP with JSON responses, so it runs on Lambda behind API Gateway.

import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import net from "net";
import type { IncomingMessage } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { marked } from "marked";
import prisma from "../lib/prisma.js";
import { uploadBufferToS3 } from "../routes/upload.js";
import { BRAND, TITLE_ROOM, checkPost, readTimeFor, searchTitle, slugify } from "./blogSeo.js";

const router = Router();

const SITE = "https://thewellnesslab.ae";
const CATEGORIES = ["Health & Wellness", "Technology", "Lifestyle", "Clinical Analysis"] as const;
const DEFAULT_AUTHOR = "The Wellness Lab Editorial Team";
// No draft flag in the database: the site hides posts whose publishAt is in the future, so a draft is a
// post scheduled for 2099.
const DRAFT_DATE = new Date("2099-12-31T00:00:00.000Z");
const S3_BUCKET = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "thewellnesslab-public-assets";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_IMAGES = 8;

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

function keyMatches(given: string | undefined) {
  const expected = (process.env.BLOG_MCP_KEY || "").trim();
  if (!expected || expected.length < 24 || !given) return false;
  return crypto.timingSafeEqual(sha(given.trim()), sha(expected));
}

function authorize(req: Request, res: Response, next: NextFunction) {
  const auth = req.get("authorization") || "";
  const given = req.params.key || req.get("x-api-key") || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : undefined);
  if (keyMatches(given)) return next();
  return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: wrong or missing blog key." }, id: null });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type PostRow = {
  id: string;
  title: string;
  slug: string | null;
  publishAt: Date | null;
  category: string;
  image: string | null;
  updatedAt: Date;
};

const statusOf = (p: { publishAt: Date | null }) => {
  if (!p.publishAt) return "published";
  const d = new Date(p.publishAt);
  if (d.getUTCFullYear() >= 2099) return "draft";
  return d.getTime() > Date.now() ? "scheduled" : "published";
};

const summary = (p: PostRow) => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  status: statusOf(p),
  publishAt: p.publishAt,
  category: p.category,
  image: p.image,
  updatedAt: p.updatedAt,
  url: p.slug ? `${SITE}/blog/${p.slug}` : null,
});

const text = (obj: unknown) => ({ content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

async function products() {
  const list = await prisma.product.findMany({ select: { slug: true, name: true, price: true } });
  return list.map((p) => ({ slug: p.slug, name: String(p.name).toUpperCase(), price: Number(p.price) || 0 }));
}

async function findPost(idOrSlug: string) {
  return prisma.blog.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
}

async function context(selfId?: string) {
  const [prods, slugs] = await Promise.all([
    products(),
    prisma.blog.findMany({ where: selfId ? { NOT: { id: selfId } } : {}, select: { slug: true } }),
  ]);
  return { products: prods, existingSlugs: new Set(slugs.map((s) => s.slug).filter(Boolean) as string[]) };
}

const toHtml = (args: { content_markdown?: string; content_html?: string }) =>
  args.content_html != null
    ? String(args.content_html)
    : args.content_markdown != null
      ? (marked.parse(String(args.content_markdown), { gfm: true, async: false }) as string)
      : undefined;

function publishAtFor(mode: "draft" | "now" | "schedule", at?: string): Date | null {
  if (mode === "now") return null;
  if (mode === "schedule") {
    const d = new Date(at || "");
    if (!at || Number.isNaN(d.getTime())) throw new Error("publish_at must be a date and time, for example 2026-11-20T09:00:00+04:00.");
    if (d.getTime() <= Date.now()) throw new Error('publish_at is in the past; use publish "now" instead.');
    return d;
  }
  return DRAFT_DATE;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { ext: "png", mime: "image/png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (buf.length > 6 && buf.toString("ascii", 0, 4) === "GIF8") return { ext: "gif", mime: "image/gif" };
  if (buf.length > 12 && buf.toString("ascii", 4, 12).startsWith("ftypavi")) return { ext: "avif", mime: "image/avif" };
  return null;
}

const isOwnImage = (url: string) => new RegExp(`^https://${S3_BUCKET.replace(/\./g, "\\.")}\\.s3[.-]`).test(url);

function assertPublicHttps(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:") throw new Error("Image URLs must use https.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const privateHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (net.isIP(host) &&
      (/^(10\.|127\.|169\.254\.|192\.168\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1" || /^f[cd]/i.test(host)));
  if (privateHost) throw new Error("Image URL points to a private address.");
}

async function downloadImage(url: string): Promise<Buffer> {
  assertPublicHttps(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Could not download the image (${res.status}).`);
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_IMAGE_BYTES) throw new Error("Image is larger than 8 MB.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 8 MB.");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

function decodeBase64(data: string): Buffer {
  const raw = data.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) throw new Error("image_base64 is empty or not base64.");
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("Image is larger than 8 MB.");
  return buf;
}

/** Stores an image in the site's S3 bucket under blog/ and returns its public URL. */
async function storeImage(buf: Buffer, name: string) {
  const kind = sniffImage(buf);
  if (!kind) throw new Error("That file is not a PNG, JPEG, WebP, GIF or AVIF image.");
  const base = slugify(name || "blog-image").slice(0, 50) || "blog-image";
  const saved = await uploadBufferToS3(buf, `${base}.${kind.ext}`, kind.mime, "blog");
  return { url: saved.location, bytes: buf.length, type: kind.mime };
}

/** A cover image given as a link elsewhere (for example a temporary AI image link) is copied to S3. */
async function ensureStoredImage(url: string | undefined, name: string) {
  if (!url) return url;
  if (url.startsWith("data:")) return (await storeImage(decodeBase64(url), name)).url;
  if (isOwnImage(url)) return url;
  return (await storeImage(await downloadImage(url), name)).url;
}

/** Inline <img> sources that are base64 data or external links are copied to S3 so they never expire. */
async function storeInlineImages(html: string, name: string) {
  const srcs = [...new Set([...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]))];
  const todo = srcs.filter((s) => s.startsWith("data:image/") || (/^https:\/\//.test(s) && !isOwnImage(s))).slice(0, MAX_INLINE_IMAGES);
  let out = html;
  const notes: string[] = [];
  for (const [i, src] of todo.entries()) {
    try {
      const url = await ensureStoredImage(src, `${name}-${i + 1}`);
      if (url) out = out.split(src).join(url);
    } catch (e) {
      notes.push(`Inline image ${i + 1} was left as is: ${(e as Error).message}`);
    }
  }
  return { html: out, notes };
}

/* ------------------------------------------------------------------ */
/* MCP server                                                          */
/* ------------------------------------------------------------------ */

const WRITING_GUIDE = `How to write a post for thewellnesslab.ae (from the TWL SEO and AEO Plan):
- Audience: UAE buyers of red light therapy devices. Prices in AED. Write plainly, for people.
- Answer first: the first two lines give the answer with its number (AED, minutes, cm, months), then the detail.
- Title: the post heading, ${TITLE_ROOM} characters or fewer so the search title "<title> | ${BRAND}" fits in 60.
- Excerpt: 120 to 160 characters; it is the search description (answer, proof, call to action).
- Structure: no H1 (the title is the H1); sections as H2 (## in Markdown) in the buyer's words, each opening with its answer; facts tables as text; a visible FAQ of 4 to 6 real buyer questions.
- Links: up to /products or /quiz, across to two related guides (/blog/<slug>), down to the matching product (/products/<slug>). Never /blogs/<slug>.
- Product names in capitals: REX MINI, REX ULTRA, REX PRO, REX CORE, REX PRESTIGE, REX PET POD. Prices only from get_site_facts.
- Facts: REX ULTRA, PRO, CORE and PRESTIGE share 9 wavelengths: 480, 630, 650, 660, 670, 810, 830, 850 and 1060 nm. Panel routine: twice a day, 15 to 25 minutes. Free UAE delivery; panels installed by the team; 15-minute demo on WhatsApp (+971 58 586 5195).
- Compliance: use supports, helps, aids. Never cure, treat, heal or eliminate; no unprovable superlatives; no em dashes. Citations from 2022 or later with first author and journal. Health topics end with a line that the device does not replace medical advice.
- Images: upload with upload_image (base64 from an image you generated, or an https link) and use the returned url as image (cover) or in the content. Never invent reviews, ratings, certificates or prices.`;

const contentShape = {
  content_markdown: z.string().optional().describe("Post body in Markdown (preferred). Sections start at ## (H2); no # H1."),
  content_html: z.string().optional().describe("Post body as HTML instead of Markdown. No <h1>, <title>, <meta>, <script> or <iframe>."),
};

/**
 * Every tool retries once on a passing database error (a fresh Lambda's first query can fail while the
 * connection pool opens) and returns a readable message instead of an exception.
 */
function resilient<A extends unknown[], R>(name: string, cb: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R | ReturnType<typeof fail>> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await cb(...args);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        const transient = /prisma|connection|ECONNRESET|timed out|prepared statement/i.test(msg);
        if (transient && attempt < 2) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        console.error(`[blog-mcp] ${name} failed:`, msg.slice(0, 300));
        return fail(`${name} failed: ${msg.split("\n").filter(Boolean).slice(-1)[0] || "unexpected error"}. Try again.`);
      }
    }
  };
}

function buildServer() {
  const server = new McpServer({ name: "twl-blog", version: "1.0.0" });
  const registerTool = server.registerTool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: any, cb: any) => registerTool(name, config, resilient(name, cb) as any);

  server.registerTool(
    "get_site_facts",
    {
      title: "Get site facts and writing rules",
      description: "Live REX names, prices and links from Products, blog categories, existing posts, and the writing and compliance rules. Call this before writing a post.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [prods, posts] = await Promise.all([
        products(),
        prisma.blog.findMany({ select: { title: true, slug: true, publishAt: true }, orderBy: { createdAt: "desc" } }),
      ]);
      return text({
        products: prods.map((p) => ({ name: p.name, price_aed: p.price, link: `/products/${p.slug}`, url: `${SITE}/products/${p.slug}` })),
        other_pages: { all_products: "/products", quiz: "/quiz", why_9_wavelengths: "/why-9-wavelengths", dubai: "/red-light-therapy-dubai" },
        categories: CATEGORIES,
        published_posts: posts.filter((p) => statusOf(p) === "published" && p.slug).map((p) => ({ title: p.title, link: `/blog/${p.slug}` })),
        writing_guide: WRITING_GUIDE,
      });
    }
  );

  server.registerTool(
    "list_posts",
    {
      title: "List blog posts",
      description: "Lists blog posts with their status: published, scheduled or draft.",
      inputSchema: { status: z.enum(["all", "published", "scheduled", "draft"]).optional().describe("Filter by status (default all).") },
      annotations: { readOnlyHint: true },
    },
    async ({ status = "all" }) => {
      const posts = (await prisma.blog.findMany({ orderBy: { createdAt: "desc" } })).map(summary);
      return text(status === "all" ? posts : posts.filter((p) => p.status === status));
    }
  );

  server.registerTool(
    "get_post",
    {
      title: "Get a blog post",
      description: "Returns one post (by id or slug) with its HTML content, status and SEO check.",
      inputSchema: { id_or_slug: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ id_or_slug }) => {
      const post = await findPost(id_or_slug);
      if (!post) return fail(`No post with id or slug "${id_or_slug}".`);
      return text({ ...summary(post), excerpt: post.excerpt, author: post.author, readTime: post.readTime, content_html: post.content, seo_check: checkPost(post, await context(post.id)) });
    }
  );

  const postShape = {
    title: z.string().min(1).describe(`The post heading (its only H1). Keep to ${TITLE_ROOM} characters so the search title fits.`),
    excerpt: z.string().min(1).describe("120 to 160 characters; used as the search description."),
    ...contentShape,
    slug: z.string().optional().describe("URL slug; made from the title if left out."),
    category: z.enum(CATEGORIES).optional(),
    image: z.string().optional().describe("Cover image: a url from upload_image, any https image link, or a data:image/... base64 string. Non-S3 images are copied to S3."),
    author: z.string().optional(),
    featured: z.boolean().optional(),
  };

  server.registerTool(
    "check_post",
    {
      title: "Check a post before saving",
      description: "Runs the SEO and compliance check without saving: search title, description length, headings, links, product names, prices and claim wording.",
      inputSchema: postShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const content = toHtml(args);
      if (content === undefined) return fail("Give content_markdown or content_html.");
      return text(checkPost({ ...args, slug: args.slug ? slugify(args.slug) : slugify(args.title), content }, await context()));
    }
  );

  server.registerTool(
    "upload_image",
    {
      title: "Upload an image",
      description:
        "Stores an image in the site's S3 bucket and returns its public url, to use as a post's cover image or inside its content. Give either image_base64 (an image you generated or were given) or image_url (https link). PNG, JPEG, WebP, GIF or AVIF, up to 8 MB.",
      inputSchema: {
        image_base64: z.string().optional().describe("The image as base64, with or without a data:image/...;base64, prefix."),
        image_url: z.string().optional().describe("An https link to the image; it is downloaded and copied to S3."),
        name: z.string().optional().describe("Short descriptive file name, for example rex-pro-home-gym."),
        alt: z.string().optional().describe("Alt text describing the image, used in the returned HTML and Markdown snippets."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ image_base64, image_url, name = "blog-image", alt = "" }) => {
      if (!image_base64 && !image_url) return fail("Give image_base64 or image_url.");
      try {
        const buf = image_base64 ? decodeBase64(image_base64) : await downloadImage(image_url!);
        const saved = await storeImage(buf, name);
        console.log(`[blog-mcp] upload_image ${saved.type} ${saved.bytes} bytes -> ${saved.url}`);
        const safeAlt = alt.replace(/"/g, "&quot;");
        return text({ ...saved, markdown: `![${alt}](${saved.url})`, html: `<img src="${saved.url}" alt="${safeAlt}" loading="lazy">` });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.registerTool(
    "create_post",
    {
      title: "Create a blog post",
      description:
        'Creates a post. Saved as a draft (hidden from the site) unless publish is "now" or "schedule"; only publish when the user asks. Posts with check errors are not published unless force is true.',
      inputSchema: {
        ...postShape,
        publish: z.enum(["draft", "now", "schedule"]).optional().describe("draft (default), now, or schedule (with publish_at)."),
        publish_at: z.string().optional().describe("For schedule: ISO date and time, for example 2026-11-20T09:00:00+04:00 (UAE time)."),
        force: z.boolean().optional().describe("Publish even if the check reports errors. Only when the user explicitly asks."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ publish = "draft", publish_at, force = false, ...args }) => {
      let content = toHtml(args);
      if (content === undefined) return fail("Give content_markdown or content_html.");
      const slug = args.slug ? slugify(args.slug) : slugify(args.title);
      const ctx = await context();
      if (ctx.existingSlugs.has(slug)) return fail(`Slug "${slug}" is already used. Pass a different slug.`);

      let publishAt: Date | null;
      let image: string | undefined;
      const notes: string[] = [];
      try {
        publishAt = publishAtFor(publish, publish_at);
        image = await ensureStoredImage(args.image, `${slug}-cover`);
        const inline = await storeInlineImages(content, slug);
        content = inline.html;
        notes.push(...inline.notes);
      } catch (e) {
        return fail((e as Error).message);
      }

      const check = checkPost({ ...args, slug, content, image }, ctx);
      if (publish !== "draft" && check.errors.length && !force)
        return fail(`Not published: fix these first, or save as a draft.\n- ${check.errors.join("\n- ")}`);

      const saved = await prisma.blog.create({
        data: {
          title: args.title.trim(),
          slug,
          excerpt: args.excerpt.trim(),
          content,
          category: args.category || "Health & Wellness",
          author: args.author || DEFAULT_AUTHOR,
          image: image || null,
          readTime: readTimeFor(content),
          featured: args.featured ?? false,
          publishAt,
        },
      });
      console.log(`[blog-mcp] create_post ${saved.id} "${saved.slug}" status=${statusOf(saved)}`);
      const st = statusOf(saved);
      return text({
        saved: summary(saved),
        search_title: searchTitle(saved.title),
        note:
          st === "draft"
            ? "Saved as a draft: not on the site. Use publish_post to publish or schedule it."
            : st === "scheduled"
              ? `Scheduled for ${saved.publishAt?.toISOString()}; it appears on the site within about 5 minutes of that time.`
              : "Published: on the site and in the sitemap within about 5 minutes.",
        notes,
        seo_check: check,
      });
    }
  );

  server.registerTool(
    "update_post",
    {
      title: "Update a blog post",
      description: "Changes fields of a post (by id or slug). Does not change whether it is published; use publish_post or unpublish_post for that.",
      inputSchema: {
        id_or_slug: z.string().min(1),
        title: z.string().optional(),
        excerpt: z.string().optional(),
        ...contentShape,
        slug: z.string().optional().describe("Changing the slug of a published post breaks its old URL; avoid it."),
        category: z.enum(CATEGORIES).optional(),
        image: z.string().optional().describe("New cover image (url from upload_image, https link, or data:image base64)."),
        author: z.string().optional(),
        featured: z.boolean().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id_or_slug, ...args }) => {
      const current = await findPost(id_or_slug);
      if (!current) return fail(`No post with id or slug "${id_or_slug}".`);
      let content = toHtml(args);
      const notes: string[] = [];
      let image: string | undefined;
      try {
        if (content !== undefined) {
          const inline = await storeInlineImages(content, current.slug || current.id);
          content = inline.html;
          notes.push(...inline.notes);
        }
        image = args.image !== undefined ? await ensureStoredImage(args.image, `${current.slug || current.id}-cover`) : undefined;
      } catch (e) {
        return fail((e as Error).message);
      }
      const data = {
        ...(args.title !== undefined && { title: args.title.trim() }),
        ...(args.excerpt !== undefined && { excerpt: args.excerpt.trim() }),
        ...(content !== undefined && { content, readTime: readTimeFor(content) }),
        ...(args.slug !== undefined && { slug: slugify(args.slug) }),
        ...(args.category !== undefined && { category: args.category }),
        ...(image !== undefined && { image }),
        ...(args.author !== undefined && { author: args.author }),
        ...(args.featured !== undefined && { featured: args.featured }),
      };
      if (!Object.keys(data).length) return fail("Nothing to change.");
      const ctx = await context(current.id);
      if (data.slug && ctx.existingSlugs.has(data.slug)) return fail(`Slug "${data.slug}" is already used.`);
      const saved = await prisma.blog.update({ where: { id: current.id }, data });
      console.log(`[blog-mcp] update_post ${saved.id} fields=${Object.keys(data).join(",")}`);
      return text({ saved: summary(saved), search_title: searchTitle(saved.title), notes, seo_check: checkPost(saved, ctx) });
    }
  );

  server.registerTool(
    "publish_post",
    {
      title: "Publish or schedule a post",
      description: "Publishes a draft now, or schedules it with publish_at. Refuses if the SEO check has errors, unless force is true.",
      inputSchema: {
        id_or_slug: z.string().min(1),
        publish_at: z.string().optional().describe("Leave out to publish now; or an ISO date and time to schedule."),
        force: z.boolean().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id_or_slug, publish_at, force = false }) => {
      const current = await findPost(id_or_slug);
      if (!current) return fail(`No post with id or slug "${id_or_slug}".`);
      const check = checkPost(current, await context(current.id));
      if (check.errors.length && !force) return fail(`Not published: fix these first.\n- ${check.errors.join("\n- ")}`);
      let publishAt: Date | null;
      try {
        publishAt = publishAtFor(publish_at ? "schedule" : "now", publish_at);
      } catch (e) {
        return fail((e as Error).message);
      }
      const saved = await prisma.blog.update({ where: { id: current.id }, data: { publishAt } });
      console.log(`[blog-mcp] publish_post ${saved.id} status=${statusOf(saved)}`);
      return text({
        saved: summary(saved),
        note: publishAt ? `Scheduled for ${publishAt.toISOString()}.` : "Published: on the site and in the sitemap within about 5 minutes.",
        seo_check: check,
      });
    }
  );

  server.registerTool(
    "unpublish_post",
    {
      title: "Take a post off the site",
      description: "Turns a published or scheduled post back into a draft (hidden from the site and sitemap). The post is kept, not deleted.",
      inputSchema: { id_or_slug: z.string().min(1) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id_or_slug }) => {
      const current = await findPost(id_or_slug);
      if (!current) return fail(`No post with id or slug "${id_or_slug}".`);
      const saved = await prisma.blog.update({ where: { id: current.id }, data: { publishAt: DRAFT_DATE } });
      console.log(`[blog-mcp] unpublish_post ${saved.id}`);
      return text({ saved: summary(saved), note: "Now a draft: hidden from the site and sitemap within about 5 minutes." });
    }
  );

  server.registerPrompt(
    "write_blog_post",
    {
      title: "Write a blog post",
      description: "Drafts a new post for thewellnesslab.ae on a topic, following the house rules, and saves it as a draft.",
      argsSchema: { topic: z.string().describe("What the post is about, for example: REX PRO vs REX CORE for home gyms") },
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Write a blog post for thewellnesslab.ae about: ${topic}

1. Call get_site_facts for live prices, links, existing posts and the writing rules.
2. Write the post in Markdown following those rules (answer first, ## sections, internal links, FAQ, compliant wording).
3. If you can make a cover image, upload it with upload_image and use the returned url as image.
4. Call check_post and fix every error and warning you can.
5. Save it with create_post as a draft (do not publish). Then show the search title, the excerpt and any remaining warnings.`,
          },
        },
      ],
    })
  );

  return server;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

async function handle(req: Request, res: Response) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    // Clerk's req.auth has a different shape from the MCP SDK's; this route authenticates with the blog key.
    await transport.handleRequest(req as unknown as IncomingMessage, res, req.body);
  } catch (e) {
    console.error("[blog-mcp] request failed:", (e as Error).message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
}

// Stateless server: no event stream or sessions to open or close.
const notAllowed = (_req: Request, res: Response) =>
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST." }, id: null });

router.post("/", authorize, handle);
router.post("/:key", authorize, handle);
router.get(["/", "/:key"], notAllowed);
router.delete(["/", "/:key"], notAllowed);

export default router;
