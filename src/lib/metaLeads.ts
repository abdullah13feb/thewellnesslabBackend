import type { Request } from "express";
import prisma from "./prisma.js";
import { sendMetaEvent, normPhone, userData, firstIp } from "./metaCapi.js";

// Conversions API lead events. Nothing here throws: a lead or a WhatsApp message is always saved
// even if Meta is down.

// ─── Website Lead (Quiz / Flash Sale Popup / Contact form) ─────────────────────────────

const LIVE_STOREFRONT_HOSTS = ["thewellnesslab.ae", "www.thewellnesslab.ae"];

// Lead sources that come from ads / the storefront, with the content_category the browser pixel uses.
// Anything else (Apollo, Apify imports, ...) is never sent to Meta.
const WEBSITE_LEAD_SOURCES: Record<string, string> = {
  Quiz: "Find Your Panel Quiz",
  "Flash Sale Popup": "flash_sale_popup",
  "Contact Form": "contact_form",
};

const hostOf = (url: unknown) => {
  try {
    return typeof url === "string" && url ? new URL(url).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
};

// True only for a browser request from the live storefront (not staging, previews, localhost or scripts).
export function isLiveStorefront(req: Request) {
  const host = hostOf(req.headers.origin) || hostOf(req.headers.referer);
  return LIVE_STOREFRONT_HOSTS.includes(host);
}

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");

export type WebsiteLeadMeta = {
  eventId?: unknown; // the same event id the browser pixel sent, for deduplication
  fbp?: unknown;
  fbc?: unknown;
  page?: unknown;
};

export async function sendWebsiteLead(
  req: Request,
  lead: { id: string; source?: string | null; name?: string | null; email?: string | null; phone?: string | null; city?: string | null },
  meta: WebsiteLeadMeta = {}
) {
  try {
    const category = WEBSITE_LEAD_SOURCES[lead.source || ""];
    if (!category) return;
    if (!isLiveStorefront(req)) {
      console.log(`[Meta CAPI] Lead ${lead.id} not sent: not from the live storefront`);
      return;
    }

    const eventId = /^[\w.:-]{6,100}$/.test(String(meta.eventId || "")) ? String(meta.eventId) : `lead-${lead.id}`;
    const fbp = clip(meta.fbp, 200);
    const fbc = clip(meta.fbc, 500);
    const page = clip(meta.page, 1000);
    const ip = firstIp(req.headers["x-forwarded-for"]) || req.ip || "";
    const ua = clip(req.headers["user-agent"], 1000);

    await sendMetaEvent({
      event_name: "Lead",
      event_id: eventId,
      action_source: "website",
      event_source_url: hostOf(page) && LIVE_STOREFRONT_HOSTS.includes(hostOf(page)) ? page : clip(req.headers.referer, 1000) || undefined,
      user_data: {
        ...userData({ email: lead.email, phone: lead.phone, name: lead.name, city: lead.city }),
        ...(fbp ? { fbp } : {}),
        ...(fbc ? { fbc } : {}),
        ...(ip ? { client_ip_address: ip } : {}),
        ...(ua ? { client_user_agent: ua } : {}),
      },
      custom_data: { content_category: category, lead_source: lead.source },
    });
  } catch (err: any) {
    console.error(`[Meta CAPI] Lead ${lead.id} error:`, err.message);
  }
}

// ─── WhatsApp leads ────────────────────────────────────────────────────────────────────

// Our own devices; extra staff / test numbers come from META_LEAD_EXCLUDE_PHONES (comma separated).
const OWN_NUMBERS = ["971559206585", "971585865195"];
const excludedPhones = () =>
  new Set([
    ...OWN_NUMBERS,
    ...(process.env.META_LEAD_EXCLUDE_PHONES || "").split(",").map((p) => normPhone(p)).filter(Boolean),
  ]);

// Groups, broadcast lists, channels and status updates are not people.
const isNonPersonJid = (jid: string) => /@(g\.us|broadcast|newsletter)|^status@/i.test(jid);

// A phone that has a paid order is an existing customer, not a new lead.
async function isExistingCustomer(phoneNumber: string) {
  const last9 = phoneNumber.slice(-9);
  if (last9.length < 9) return false;
  const order = await prisma.order.findFirst({
    where: { paymentStatus: "paid", guestPhone: { contains: last9 } },
    select: { id: true },
  });
  return Boolean(order);
}

const cleanPhone = (raw: string) => String(raw || "").split("@")[0].replace(/\D/g, "");

const personName = (name?: string | null) =>
  name && !["WhatsApp Customer", "The Wellness Lab", "Urban Sauna"].includes(name) ? name : "";

async function eligible(phoneNumber: string, jid: string) {
  if (!phoneNumber || phoneNumber.length < 8 || isNonPersonJid(jid)) return false;
  if (excludedPhones().has(normPhone(phoneNumber))) return false;
  if (await isExistingCustomer(phoneNumber)) {
    console.log(`[Meta CAPI] WhatsApp lead ${phoneNumber} skipped: existing customer`);
    return false;
  }
  return true;
}

// LeadSubmitted for a chat that came from a Click to WhatsApp ad: once per ad click id
// (a person who later clicks another ad counts again). Returns true when sent.
// Needs META_WABA_ID; without it the chat is treated like any other chat (sendWhatsappChatLead).
export async function sendWhatsappAdLead(rawPhone: string, jid = "") {
  try {
    const phoneNumber = cleanPhone(rawPhone);
    const waba = (process.env.META_WABA_ID || "").trim();
    if (!waba) return false;

    const contact = await prisma.wellnessLabContact.findUnique({ where: { phoneNumber } });
    if (!contact?.ctwaClid || contact.metaLeadClid === contact.ctwaClid) return false;
    if (!(await eligible(phoneNumber, jid || rawPhone))) return false;

    // Claim this click first, so a repeated webhook (or the second webhook route) cannot send it twice.
    const clid = contact.ctwaClid;
    const claim = await prisma.wellnessLabContact.updateMany({
      where: { phoneNumber, NOT: { metaLeadClid: clid } },
      data: { metaLeadClid: clid, metaLeadSentAt: contact.metaLeadSentAt || new Date() },
    });
    if (claim.count === 0) return false;

    const ok = await sendMetaEvent({
      event_name: "LeadSubmitted",
      event_id: `wa-lead-${clid}`.slice(0, 100),
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      user_data: {
        ...userData({ phone: normPhone(phoneNumber), email: contact.email, name: personName(contact.customerName), city: contact.city }),
        whatsapp_business_account_id: waba,
        ctwa_clid: clid,
      },
      custom_data: contact.adId ? { ad_id: contact.adId } : undefined,
    });
    if (!ok) {
      // Release the claim so the next message from this click retries.
      await prisma.wellnessLabContact.update({
        where: { phoneNumber },
        data: { metaLeadClid: contact.metaLeadClid, metaLeadSentAt: contact.metaLeadSentAt },
      });
    }
    return ok;
  } catch (err: any) {
    console.error(`[Meta CAPI] WhatsApp LeadSubmitted ${rawPhone} error:`, err.message);
    return false;
  }
}

// Lead (action_source = chat) for a new person messaging us without an ad click: once per phone number, ever.
// "New" means this incoming message is the first message we have ever logged with this number, so existing
// contacts (never backfilled) and people replying to our own bulk messages are not counted.
export async function sendWhatsappChatLead(opts: { rawPhone: string; jid?: string; messageLogId: string; customerName?: string }) {
  try {
    const phoneNumber = cleanPhone(opts.rawPhone);
    const contact = await prisma.wellnessLabContact.findUnique({ where: { phoneNumber } });
    if (!contact || contact.metaLeadSentAt) return;
    if (contact.ctwaClid && (process.env.META_WABA_ID || "").trim()) return; // ad chat: LeadSubmitted covers it
    if (Date.now() - contact.createdAt.getTime() > 24 * 3600 * 1000) return; // contact predates this chat

    const earlier = await prisma.wellnessLabMessageLog.count({
      where: { phoneNumber, id: { not: opts.messageLogId } },
    });
    if (earlier > 0) return;
    if (!(await eligible(phoneNumber, opts.jid || opts.rawPhone))) return;

    const claim = await prisma.wellnessLabContact.updateMany({
      where: { phoneNumber, metaLeadSentAt: null },
      data: { metaLeadSentAt: new Date() },
    });
    if (claim.count === 0) return;

    const ok = await sendMetaEvent({
      event_name: "Lead",
      event_id: `wa-chat-lead-${contact.id}`,
      action_source: "chat",
      user_data: userData({
        phone: normPhone(phoneNumber),
        email: contact.email,
        name: personName(opts.customerName) || personName(contact.customerName),
        city: contact.city,
      }),
      custom_data: { content_category: "whatsapp_chat", lead_source: "WhatsApp" },
    });
    if (!ok) {
      // Not retried: later messages are no longer the first one. Logged by sendMetaEvent.
      await prisma.wellnessLabContact.update({ where: { phoneNumber }, data: { metaLeadSentAt: null } });
    }
  } catch (err: any) {
    console.error(`[Meta CAPI] WhatsApp chat Lead ${opts.rawPhone} error:`, err.message);
  }
}
