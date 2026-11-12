import prisma from "./prisma.js";
import { uploadBufferToS3 } from "../routes/upload.js";

// Details of the Meta ads behind Click-to-WhatsApp (CTWA) leads: ad, campaign and ad set names, status,
// ad text and the banner image. Looked up once per ad in the Meta Marketing API with META_ACCESS_TOKEN
// (needs ads_read on the ad account), cached in the Setting table, and the banner is copied to the public
// S3 bucket because Meta image links expire after a few days.

const CACHE_KEY = "ctwa_ad_cache";
const GRAPH = "https://graph.facebook.com/v21.0";
const REFRESH_MS = 24 * 3600 * 1000; // names and status are re-read at most once a day
const RETRY_FAILED_MS = 3600 * 1000; // a failed lookup (bad token, no access) is retried after an hour

export type CtwaAdInfo = {
  adId: string;
  ok: boolean;
  error?: string;
  name?: string;
  status?: string;
  campaign?: string;
  objective?: string;
  adSet?: string;
  title?: string;
  body?: string;
  imageUrl?: string; // permanent copy in S3
  permalink?: string; // Instagram / Facebook post of the ad
  fetchedAt: string;
};

type Cache = Record<string, CtwaAdInfo>;

async function readCache(): Promise<Cache> {
  const s = await prisma.setting.findUnique({ where: { key: CACHE_KEY } });
  try {
    return s?.value ? JSON.parse(s.value) : {};
  } catch {
    return {};
  }
}

async function writeCache(cache: Cache) {
  const value = JSON.stringify(cache);
  await prisma.setting.upsert({ where: { key: CACHE_KEY }, update: { value }, create: { key: CACHE_KEY, value } });
}

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error?.message || `Meta API ${r.status}`);
  return d;
}

// Best banner for an ad: the full image of an image ad, the cover of a video ad, else the thumbnail.
function pickImage(creative: any): string {
  const spec = creative?.object_story_spec || {};
  return (
    creative?.image_url ||
    spec.video_data?.image_url ||
    spec.link_data?.picture ||
    spec.photo_data?.url ||
    creative?.thumbnail_url ||
    ""
  );
}

async function copyToS3(url: string, adId: string): Promise<string> {
  if (!url) return "";
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return url;
    const type = r.headers.get("content-type") || "image/jpeg";
    const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
    const { location } = await uploadBufferToS3(Buffer.from(await r.arrayBuffer()), `ad-${adId}${ext}`, type, "ctwa-ads");
    return location;
  } catch (err: any) {
    console.warn(`[CTWA ads] banner copy for ${adId} failed:`, err.message);
    return url;
  }
}

async function fetchAd(adId: string, previous?: CtwaAdInfo): Promise<CtwaAdInfo> {
  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  const now = new Date().toISOString();
  if (!token) return { adId, ok: false, error: "META_ACCESS_TOKEN is not set", fetchedAt: now };
  try {
    const ad = await graph(
      `${encodeURIComponent(adId)}?fields=name,effective_status,campaign{name,objective},adset{name},` +
        `creative{title,body,image_url,thumbnail_url,instagram_permalink_url,object_story_spec,effective_object_story_id}`,
      token,
    );
    const c = ad.creative || {};
    let image = pickImage(c);
    // A bigger thumbnail when the creative only has the small default one.
    if (!c.image_url && c.id) {
      try {
        const big = await graph(`${c.id}?fields=thumbnail_url&thumbnail_width=600&thumbnail_height=600`, token);
        if (!pickImage({ ...c, thumbnail_url: undefined }) && big.thumbnail_url) image = big.thumbnail_url;
      } catch {
        /* keep the default thumbnail */
      }
    }
    const spec = c.object_story_spec || {};
    const storyId = c.effective_object_story_id ? String(c.effective_object_story_id) : "";
    return {
      adId,
      ok: true,
      name: ad.name,
      status: ad.effective_status,
      campaign: ad.campaign?.name,
      objective: ad.campaign?.objective,
      adSet: ad.adset?.name,
      title: c.title || spec.link_data?.name || spec.video_data?.title || "",
      body: c.body || spec.link_data?.message || spec.video_data?.message || "",
      // Copy the banner only when it is new; an existing S3 copy is kept.
      imageUrl: previous?.imageUrl?.includes("amazonaws.com/") ? previous.imageUrl : await copyToS3(image, adId),
      permalink: c.instagram_permalink_url || (storyId.includes("_") ? `https://www.facebook.com/${storyId.replace("_", "/posts/")}` : ""),
      fetchedAt: now,
    };
  } catch (err: any) {
    console.warn(`[CTWA ads] lookup of ad ${adId} failed:`, err.message);
    return { ...(previous?.ok ? previous : {}), adId, ok: previous?.ok || false, error: err.message, fetchedAt: now } as CtwaAdInfo;
  }
}

const isStale = (info?: CtwaAdInfo) => {
  if (!info) return true;
  const age = Date.now() - new Date(info.fetchedAt).getTime();
  return info.ok ? age > REFRESH_MS : age > RETRY_FAILED_MS;
};

/** Ad details for these ad ids, from the cache, looking up new or stale ones in Meta (max `limit` per call). */
export async function getCtwaAds(adIds: string[], opts: { refresh?: boolean; limit?: number } = {}) {
  const ids = [...new Set(adIds.map((x) => String(x || "").trim()).filter((x) => /^\d{6,25}$/.test(x)))];
  const cache = await readCache();
  const todo = ids.filter((id) => opts.refresh || isStale(cache[id])).slice(0, opts.limit ?? 20);
  if (todo.length) {
    const results = await Promise.all(todo.map((id) => fetchAd(id, cache[id])));
    for (const r of results) cache[r.adId] = r;
    await writeCache(cache);
  }
  return Object.fromEntries(ids.map((id) => [id, cache[id] || null]));
}
