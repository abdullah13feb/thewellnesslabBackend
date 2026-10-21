import prisma from "./prisma.js";
import { sendMetaEvent, normPhone, userData } from "./metaCapi.js";

// Lead statuses that mean the WhatsApp lead bought.
export const WON_STATUSES = ["CLOSED_DEAL", "WON"];

// GOWA forwards WhatsApp Web payloads, so the Click to WhatsApp click id can sit at different depths
// (referral.ctwa_clid, contextInfo.externalAdReply.ctwaClid, ...). Find it by key name.
export function findCtwaClid(payload: unknown, depth = 0): string {
  if (!payload || typeof payload !== "object" || depth > 6) return "";
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (/^ctwa_?clid$/i.test(key) && typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const found = findCtwaClid(value, depth + 1);
    if (found) return found;
  }
  return "";
}

// Remember the latest ad click on the contact, next to its ad id.
export async function saveCtwaClick(rawPhone: string, ctwaClid: string, adId?: string) {
  const phoneNumber = String(rawPhone || "").split("@")[0].replace(/\D/g, "");
  if (!phoneNumber || !ctwaClid) return;
  try {
    await prisma.wellnessLabContact.upsert({
      where: { phoneNumber },
      update: { ctwaClid, adId: adId || undefined, ctwaClickedAt: new Date() },
      create: { phoneNumber, ctwaClid, adId: adId || "", ctwaClickedAt: new Date(), leadStatus: "NEW_LEAD" },
    });
  } catch (err: any) {
    console.warn("[CTWA click save warning]:", err.message);
  }
}

// Conversions API Purchase for a won WhatsApp lead, sent once per contact. Needs the ad click id
// (only leads that came from a Click to WhatsApp ad have one), a deal value and META_WABA_ID.
export async function sendWonLeadPurchase(phoneNumber: string) {
  const contact = await prisma.wellnessLabContact.findUnique({ where: { phoneNumber } });
  if (!contact || !WON_STATUSES.includes(contact.leadStatus) || contact.metaPurchaseSentAt) return;
  if (!contact.ctwaClid || !contact.dealValue || contact.dealValue <= 0) return;

  const waba = (process.env.META_WABA_ID || "").trim();
  if (!waba) {
    console.warn(`[Meta CAPI] META_WABA_ID is not set; WhatsApp Purchase for ${phoneNumber} not sent`);
    return;
  }

  const claim = await prisma.wellnessLabContact.updateMany({
    where: { phoneNumber, metaPurchaseSentAt: null },
    data: { metaPurchaseSentAt: new Date() },
  });
  if (claim.count === 0) return;

  const user = userData({
    phone: normPhone(phoneNumber),
    email: contact.email,
    name: contact.customerName !== "WhatsApp Customer" ? contact.customerName : "",
    city: contact.city,
  });

  const ok = await sendMetaEvent({
    event_name: "Purchase",
    event_id: `wa-${contact.id}`,
    action_source: "business_messaging",
    messaging_channel: "whatsapp",
    user_data: { ...user, whatsapp_business_account_id: waba, ctwa_clid: contact.ctwaClid },
    custom_data: { currency: "AED", value: contact.dealValue },
  });

  if (!ok) {
    await prisma.wellnessLabContact.update({ where: { phoneNumber }, data: { metaPurchaseSentAt: null } });
  }
}
