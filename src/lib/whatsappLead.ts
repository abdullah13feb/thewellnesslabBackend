import prisma from "./prisma.js";

// Every Wellness Lab WhatsApp chat is also a row in the Lead table (one lead per phone number),
// so website leads and WhatsApp leads are managed in one place (Marketing OS Leads tab, admin portal).
// The lead is linked to its WellnessLabContact by dynamicFields["WhatsApp Phone"] (digits only).

export const WA_PHONE_KEY = "WhatsApp Phone";
export const SOURCE_WHATSAPP = "WhatsApp";
export const SOURCE_CTWA = "WhatsApp Ad (CTWA)";
const PLACEHOLDER_NAME = "WhatsApp Customer";

const digits = (v: unknown) => String(v ?? "").split("@")[0].replace(/\D/g, "");
const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
const isRealName = (n?: string | null) => !!n && n !== PLACEHOLDER_NAME && n !== "The Wellness Lab" && n !== "Urban Sauna";

// WhatsApp contacts were created with NEW_LEAD; the Lead table uses the LeadStatus values (NEW, ...).
export const contactStatusToLead = (s?: string | null) => (!s || s === "NEW_LEAD" ? "NEW" : s);

export function findWhatsappLead(phone: string) {
  return prisma.lead.findFirst({
    where: { dynamicFields: { path: [WA_PHONE_KEY], equals: phone } },
    orderBy: { createdAt: "asc" },
  });
}

// Ad names from the Meta Graph API (needs a valid META_ACCESS_TOKEN). Cached per Lambda container; never throws.
const adCache = new Map<string, Record<string, string> | null>();
async function lookupAd(adId: string): Promise<Record<string, string> | null> {
  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  if (!adId || !token) return null;
  if (adCache.has(adId)) return adCache.get(adId)!;
  let info: Record<string, string> | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(adId)}?fields=name,campaign{name},adset{name}&access_token=${encodeURIComponent(token)}`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    const d: any = await r.json();
    if (r.ok && d?.name) {
      info = { "CTWA Ad Name": d.name, "CTWA Campaign": d.campaign?.name || "", "CTWA Ad Set": d.adset?.name || "" };
    }
  } catch {
    /* Meta unavailable: the lead still keeps the ad id and headline */
  }
  adCache.set(adId, info);
  return info;
}

// Ad details from the Click to WhatsApp referral that GOWA forwards.
function adFields(ad: { adId?: string; ctwaClid?: string; clickedAt?: Date | null; referral?: any }) {
  const r = ad.referral && typeof ad.referral === "object" ? ad.referral : {};
  const f: Record<string, string> = {};
  const set = (k: string, v: string) => v && (f[k] = v);
  set("CTWA Ad ID", clip(ad.adId || r.source_id, 60));
  set("CTWA Ad Title", clip(r.ad_title || r.headline, 200));
  set("CTWA Ad Text", clip(r.ad_body || r.body, 600));
  set("CTWA Ad Link", clip(r.source_url, 500));
  set("CTWA Platform", clip(r.source_app, 30));
  set("CTWA Media", clip(r.media_type, 20));
  set("CTWA Thumbnail", clip(r.thumbnail_url, 1000));
  set("CTWA Click ID", clip(ad.ctwaClid, 300));
  if (ad.clickedAt) f["CTWA Clicked At"] = ad.clickedAt.toISOString();
  return f;
}

/**
 * Creates the lead for a WhatsApp number on its first incoming message, or refreshes it:
 * a real name replaces the "WhatsApp Customer" placeholder, and a new ad click marks it as a CTWA lead.
 * Never throws: a WhatsApp message must always be logged even if this fails.
 */
export async function upsertWhatsappLead(input: {
  phone: string;
  customerName?: string | null;
  message?: string | null;
  adId?: string;
  ctwaClid?: string;
  referral?: any;
  at?: Date;
}) {
  try {
    const phone = digits(input.phone);
    if (!phone) return null;
    const fromAd = Boolean(input.ctwaClid || input.adId);
    const ad = fromAd ? adFields({ adId: input.adId, ctwaClid: input.ctwaClid, clickedAt: input.at || new Date(), referral: input.referral }) : {};
    const adName = fromAd && ad["CTWA Ad ID"] ? await lookupAd(ad["CTWA Ad ID"]) : null;
    const existing = await findWhatsappLead(phone);

    if (!existing) {
      return await prisma.lead.create({
        data: {
          name: isRealName(input.customerName) ? clip(input.customerName, 120) : `+${phone}`,
          phone: `+${phone}`,
          source: fromAd ? SOURCE_CTWA : SOURCE_WHATSAPP,
          status: "NEW",
          dynamicFields: {
            [WA_PHONE_KEY]: phone,
            ...(input.message ? { "First Message": clip(input.message, 1000) } : {}),
            ...ad,
            ...(adName || {}),
          },
          ...(input.at ? { createdAt: input.at } : {}),
        },
      });
    }

    const fields = (existing.dynamicFields as Record<string, any>) || {};
    const data: any = {};
    if (isRealName(input.customerName) && (existing.name === `+${phone}` || !isRealName(existing.name))) {
      data.name = clip(input.customerName, 120);
    }
    // A new ad click (different click id) updates the ad details on the lead.
    if (fromAd && ad["CTWA Click ID"] !== fields["CTWA Click ID"]) {
      data.dynamicFields = { ...fields, ...ad, ...(adName || {}) };
      if (existing.source === SOURCE_WHATSAPP) data.source = SOURCE_CTWA;
    }
    return Object.keys(data).length ? await prisma.lead.update({ where: { id: existing.id }, data }) : existing;
  } catch (err: any) {
    console.error("[WhatsApp lead upsert error]:", err.message);
    return null;
  }
}

// WhatsApp contact changed in the CRM WhatsApp inbox -> mirror name/status onto its lead.
export async function syncContactToLead(phone: string, contact: { customerName?: string | null; leadStatus?: string | null }) {
  try {
    const lead = await findWhatsappLead(digits(phone));
    if (!lead) return;
    const data: any = {};
    if (contact.leadStatus && contactStatusToLead(contact.leadStatus) !== lead.status) data.status = contactStatusToLead(contact.leadStatus);
    if (isRealName(contact.customerName) && contact.customerName !== lead.name) data.name = contact.customerName;
    if (Object.keys(data).length) await prisma.lead.update({ where: { id: lead.id }, data });
  } catch (err: any) {
    console.error("[WhatsApp lead sync error]:", err.message);
  }
}
