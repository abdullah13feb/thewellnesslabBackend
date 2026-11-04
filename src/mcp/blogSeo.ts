// SEO and compliance checks for a blog post, following the TWL SEO and AEO Plan (2 Nov 2026).
// The search-title logic mirrors radiant-aura-labs/lib/seoPages.ts (blogTitle), so the title shown here
// is the one the live page uses.

export const BRAND = "The Wellness Lab UAE";
const withBrand = (t: string) => `${t} | ${BRAND}`;
export const TITLE_ROOM = 60 - withBrand("").length;

export function searchTitle(postTitle: string) {
  const t = String(postTitle || "").replace(/\s+/g, " ").trim();
  if (t.length <= TITLE_ROOM) return withBrand(t);
  const head = t.split(/\s*[:|–—]\s+|\s+-\s+/)[0];
  if (head.length >= 12 && head.length <= TITLE_ROOM) return withBrand(head);
  const cut = t.slice(0, TITLE_ROOM + 1);
  return withBrand(cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, ""));
}

export function slugify(text: string) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 75)
    .replace(/-+$/g, "");
}

export const textOf = (html: string) =>
  String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

export const wordCount = (html: string) => (textOf(html).match(/\S+/g) || []).length;
export const readTimeFor = (html: string) => `${Math.max(1, Math.round(wordCount(html) / 220))} min read`;

const CLAIM_PATTERNS: [RegExp, string][] = [
  [/\bcures?\b|\bcured\b/i, '"cure"'],
  [/\bheal(s|ing|ed)?\b/i, '"heal"'],
  [/\beliminat(e|es|ed|ing)\b/i, '"eliminate"'],
  [/\btreat(s|ed|ing)?\b(?!\s+(area|zone|surface))/i, '"treat"'],
  [/clinically[\s-]proven/i, '"clinically proven"'],
  [/\bguarantee(d|s)?\b/i, '"guaranteed"'],
  [/\bfda[\s-]approved\b/i, '"FDA approved" (name the 510(k) only for the model it covers)'],
  [/\bmost advanced\b|\bbest in the (uae|world)\b|\bno\.?\s?1\b/i, "an unprovable superlative"],
];

const NAME_CASE = /\b(Rex|rex)\s+(Mini|Ultra|Pro|Core|Prestige|Pet Pod|mini|ultra|pro|core|prestige|pet pod)\b/g;

const FORBIDDEN_TAGS: [RegExp, string][] = [
  [/<title[\s>]/i, "<title> (the page sets its own title)"],
  [/<meta\b/i, "<meta> tags"],
  [/<link\b[^>]*rel=["']?canonical/i, "a canonical <link>"],
  [/<h1[\s>]/i, "<h1> (the post title is the page's only H1; start sections at <h2>)"],
  [/<(html|head|body)[\s>]/i, "<html>/<head>/<body> wrappers"],
  [/application\/ld\+json/i, "JSON-LD (the page adds Article markup itself)"],
  [/<script\b/i, "<script> tags"],
  [/<iframe\b/i, "<iframe> (embeds are blocked on the site)"],
];

export type CheckContext = {
  products?: { slug: string; name: string; price: number }[];
  existingSlugs?: Set<string>;
};

export type CheckResult = {
  errors: string[];
  warnings: string[];
  info: Record<string, unknown>;
};

export function checkPost(
  post: { title?: string | null; slug?: string | null; excerpt?: string | null; content?: string | null; image?: string | null },
  ctx: CheckContext = {}
): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: Record<string, unknown> = {};
  const title = String(post.title || "").trim();
  const slug = String(post.slug || "").trim();
  const excerpt = String(post.excerpt || "").trim();
  const html = String(post.content || "");
  const text = textOf(html);

  if (!title) errors.push("Title is missing.");
  info.searchTitle = searchTitle(title);
  if (title.length > TITLE_ROOM)
    warnings.push(
      `Title is ${title.length} characters; Google will show "${info.searchTitle}". Keep the title to ${TITLE_ROOM} characters or put the key phrase before a colon.`
    );
  if (/—/.test(title)) warnings.push("Title has an em dash; the brand rules say no em dashes.");

  if (!slug) errors.push("Slug is missing.");
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) errors.push(`Slug "${slug}" must be lowercase words joined by hyphens.`);
    if (ctx.existingSlugs?.has(slug)) errors.push(`Slug "${slug}" is already used by another post.`);
  }
  info.url = slug ? `https://thewellnesslab.ae/blog/${slug}` : null;

  info.descriptionLength = excerpt.length;
  if (!excerpt) errors.push("Excerpt is missing; it is the search description.");
  else if (excerpt.length > 160) warnings.push(`Excerpt is ${excerpt.length} characters; search engines cut it after about 160.`);
  else if (excerpt.length < 110) warnings.push(`Excerpt is ${excerpt.length} characters; aim for 120 to 160 (answer, proof, call to action).`);

  info.words = (text.match(/\S+/g) || []).length;
  info.readTime = readTimeFor(html);
  if (!text) errors.push("Content is empty.");
  else if ((info.words as number) < 600) warnings.push(`Only ${info.words} words; guides that rank here run 900 or more.`);
  for (const [re, what] of FORBIDDEN_TAGS) if (re.test(html)) errors.push(`Content contains ${what}.`);
  const h2 = (html.match(/<h2[\s>]/gi) || []).length;
  info.sections = h2;
  if (text && h2 < 2) warnings.push("Use at least 2 <h2> section headings, each opening with its answer.");

  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  if (links.some((l) => /\/blogs\/./.test(l))) errors.push("A link points to /blogs/<slug>; posts live at /blog/<slug>.");
  if (links.some((l) => /^https?:\/\/www\.thewellnesslab\.ae/i.test(l)))
    warnings.push("Use links without www (https://thewellnesslab.ae/...) or relative links (/products/rex-pro).");
  const internal = links.filter((l) => l.startsWith("/") || /thewellnesslab\.ae/i.test(l));
  info.internalLinks = internal.length;
  if (!internal.some((l) => /\/products(\/|$)/.test(l)))
    warnings.push("Link to at least one product page (for example /products/rex-pro) and to /products or /quiz.");

  for (const [re, what] of CLAIM_PATTERNS) {
    const m = text.match(re);
    if (m && m.index !== undefined)
      warnings.push(
        `Compliance: avoid ${what} ("…${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim()}…"). Use supports, helps or aids.`
      );
  }
  const names = [...new Set([...text.matchAll(NAME_CASE)].map((m) => m[0]))];
  if (names.length) warnings.push(`Write product names in capitals: ${names.map((n) => `"${n}" → "${n.toUpperCase()}"`).join(", ")}.`);
  if (/—/.test(text)) warnings.push("Content has em dashes; the brand rules say no em dashes.");

  if (ctx.products?.length) {
    const live = new Set(ctx.products.map((p) => Number(p.price)).filter((n) => n > 0));
    live.add(4000); // optional motorised stand
    const found = [...text.matchAll(/AED\s?([0-9][0-9,]*(?:\.\d+)?)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
    const wrong = [...new Set(found.filter((n) => n >= 100 && !live.has(n)))];
    if (wrong.length)
      warnings.push(
        `Prices not in Products: ${wrong.map((n) => `AED ${n.toLocaleString("en-US")}`).join(", ")}. Live prices: ${ctx.products
          .map((p) => `${p.name} AED ${Number(p.price).toLocaleString("en-US")}`)
          .join(", ")}.`
      );
  }

  if (!post.image) warnings.push("No cover image; upload one with upload_image and pass its url as image.");
  return { errors, warnings, info };
}
