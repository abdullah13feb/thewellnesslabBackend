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

// Conversions API Purchase for a won WhatsApp lead (sales team sets Closed Deal + deal value), sent once per contact.
// Chats from a Click to WhatsApp ad go as business_messaging with the ad click id when META_WABA_ID is set
// (credited to the exact ad); every other won chat goes as action_source "chat" with the hashed phone, so Meta
// matches the sale to the same person who was sent as a WhatsApp Lead.
export async function sendWonLeadPurchase(phoneNumber: string) {
  const contact = await prisma.wellnessLabContact.findUnique({ where: { phoneNumber } });
  if (!contact || !WON_STATUSES.includes(contact.leadStatus) || contact.metaPurchaseSentAt) return;
  if (!contact.dealValue || contact.dealValue <= 0) return;

  // Paid on the website in the last 30 days: that sale already reached Meta as a website Purchase.
  const last9 = phoneNumber.replace(/\D/g, "").slice(-9);
  if (last9.length === 9) {
    const webOrder = await prisma.order.findFirst({
      where: { paymentStatus: "paid", guestPhone: { contains: last9 }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
      select: { id: true },
    });
    if (webOrder) {
      console.log(`[Meta CAPI] WhatsApp Purchase for ${phoneNumber} not sent: paid website order ${webOrder.id} already sent`);
      return;
    }
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
  const custom_data = { currency: "AED", value: contact.dealValue, content_category: "whatsapp_deal" };

  const waba = (process.env.META_WABA_ID || "").trim();
  const ok =
    waba && contact.ctwaClid
      ? await sendMetaEvent({
          event_name: "Purchase",
          event_id: `wa-${contact.id}`,
          action_source: "business_messaging",
          messaging_channel: "whatsapp",
          user_data: { ...user, whatsapp_business_account_id: waba, ctwa_clid: contact.ctwaClid },
          custom_data,
        })
      : await sendMetaEvent({
          event_name: "Purchase",
          event_id: `wa-${contact.id}`,
          action_source: "chat",
          user_data: user,
          custom_data,
        });

  if (!ok) {
    await prisma.wellnessLabContact.update({ where: { phoneNumber }, data: { metaPurchaseSentAt: null } });
  }
}
