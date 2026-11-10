// Admin WhatsApp alerts for new leads and new orders, mirroring the email alerts in email.ts.
// Config lives in the same Setting rows (lead_notification_config / order_notification_config) under
// the whatsapp* fields, managed from the admin portal's notification dialogs.

import prisma from "./prisma.js";
import { sendWhatsappMessage, sendWhatsappInteractive, type InteractiveButton } from "./whatsappGateway.js";
import { orderRef, money, gstTime, phoneIntl, ADMIN_LEADS_URL, ADMIN_ORDERS_URL } from "./alertEmails.js";
import { suggestedProductOf } from "./quizLead.js";

type WhatsappNotifyConfig = {
  whatsappEnabled?: boolean;
  whatsappNumbers?: string;
  whatsappDeviceId?: string;
  whatsappMessage?: string;
  // Tappable buttons under the alert (GOWA /send/interactive). Missing = on.
  whatsappCallButton?: boolean;
  whatsappLinkButton?: boolean;
  // Button editor (admin portal). When present, replaces the two flags above.
  whatsappButtons?: NotifyButton[];
};

export type NotifyButton = { type: "call" | "url" | "copy" | "reply"; label: string; value: string };

const DEFAULT_DEVICE = "Wellnesslab";

async function readConfig(primaryKey: string, fallbackKey?: string): Promise<WhatsappNotifyConfig | null> {
  let setting = await prisma.setting.findUnique({ where: { key: primaryKey } });
  if ((!setting || !setting.value) && fallbackKey) {
    setting = await prisma.setting.findUnique({ where: { key: fallbackKey } });
  }
  if (!setting?.value) return null;
  try {
    return JSON.parse(setting.value);
  } catch (e) {
    console.error(`Failed to parse ${primaryKey} setting for WhatsApp notify:`, e);
    return null;
  }
}

// Comma-separated numbers -> international digit strings (UAE local numbers get 971).
function parseNumbers(raw: unknown): string[] {
  return String(raw || "")
    .split(",")
    .map((n) => phoneIntl(n.trim()))
    .filter((n) => n.length >= 8);
}

function applyTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
  }
  return out;
}

// Buttons configured in the admin portal. `value` may contain {{placeholders}} from the alert
// values (phone, email, link, ...). A button whose resolved value is unusable (no phone on the
// lead, not an http(s) URL, empty copy text) is skipped. No buttons = plain text message.
function buildButtons(config: WhatsappNotifyConfig, values: Record<string, string>, linkLabel: string): InteractiveButton[] {
  const specs: NotifyButton[] = Array.isArray(config.whatsappButtons)
    ? config.whatsappButtons
    : [
        // Configs saved before the button editor existed.
        ...(config.whatsappCallButton !== false ? [{ type: "call" as const, label: "📞 Call Customer", value: "{{phone}}" }] : []),
        ...(config.whatsappLinkButton !== false ? [{ type: "url" as const, label: linkLabel, value: "{{link}}" }] : []),
      ];

  const buttons: InteractiveButton[] = [];
  specs.forEach((spec, i) => {
    const label = String(spec?.label || "").trim();
    const value = applyTemplate(String(spec?.value || ""), values).trim();
    if (!label) return;
    switch (spec.type) {
      case "call": {
        const intl = phoneIntl(value);
        if (intl.length >= 8) buttons.push({ name: "cta_call", params: { display_text: label, phone_number: `+${intl}` } });
        break;
      }
      case "url":
        if (/^https?:\/\/\S+$/i.test(value)) buttons.push({ name: "cta_url", params: { display_text: label, url: value } });
        break;
      case "copy":
        if (value && value !== "-") buttons.push({ name: "cta_copy", params: { display_text: label, copy_code: value } });
        break;
      case "reply":
        buttons.push({ name: "quick_reply", params: { display_text: label, id: value || `btn_${i + 1}` } });
        break;
    }
  });
  return buttons.slice(0, 10);
}

async function dispatch(numbers: string[], message: string, deviceId: string, label: string, buttons: InteractiveButton[] = []) {
  for (const number of numbers) {
    try {
      if (buttons.length > 0) {
        const interactive = await sendWhatsappInteractive(number, message, buttons, deviceId);
        if (interactive.success) {
          console.log(`${label} WhatsApp interactive notification sent to ${number} via ${deviceId}`);
          continue;
        }
        console.warn(`${label} WhatsApp interactive to ${number} failed, falling back to text:`, interactive.error);
      }
      const result = await sendWhatsappMessage("default", number, message, deviceId);
      if (result.success) {
        console.log(`${label} WhatsApp notification sent to ${number} via ${deviceId}`);
      } else {
        console.error(`${label} WhatsApp notification to ${number} failed:`, result.error);
      }
    } catch (err) {
      console.error(`${label} WhatsApp notification to ${number} threw:`, err);
    }
  }
}

export const sendLeadNotificationWhatsapp = async (lead: any) => {
  try {
    const config = await readConfig("lead_notification_config");
    if (!config?.whatsappEnabled || !config.whatsappNumbers) return;

    const numbers = parseNumbers(config.whatsappNumbers);
    if (numbers.length === 0) {
      console.log("No valid WhatsApp numbers in lead notification config.");
      return;
    }

    const suggestedProduct = suggestedProductOf(lead);
    const values: Record<string, string> = {
      name: lead.name || "Form Submission",
      phone: lead.phone || "-",
      email: lead.email || "-",
      city: lead.city || "-",
      source: lead.source || "Website",
      product: suggestedProduct || "-",
      time: gstTime(lead.createdAt),
      link: ADMIN_LEADS_URL,
    };

    const message =
      config.whatsappMessage && config.whatsappMessage.trim() !== ""
        ? applyTemplate(config.whatsappMessage, values)
        : [
            "🚨 *New Lead Received*",
            "",
            `👤 Name: ${values.name}`,
            `📱 Phone: ${values.phone}`,
            `📧 Email: ${values.email}`,
            `🏙️ City: ${values.city}`,
            `📥 Source: ${values.source}`,
            ...(suggestedProduct ? [`💡 Suggested: ${suggestedProduct}`] : []),
            `🕐 ${values.time}`,
            "",
            `View leads: ${ADMIN_LEADS_URL}`,
          ].join("\n");

    const buttons = buildButtons(config, values, "Open Leads");
    await dispatch(numbers, message, config.whatsappDeviceId || DEFAULT_DEVICE, "Lead", buttons);
  } catch (error) {
    console.error("Error sending lead WhatsApp notification:", error);
  }
};

export const sendOrderNotificationWhatsapp = async (order: any) => {
  try {
    const config = await readConfig("order_notification_config", "lead_notification_config");
    if (!config?.whatsappEnabled || !config.whatsappNumbers) return;

    const numbers = parseNumbers(config.whatsappNumbers);
    if (numbers.length === 0) {
      console.log("No valid WhatsApp numbers in order notification config.");
      return;
    }

    const shortId = orderRef(order);
    const customerName = order.guestName || order.user?.name || "Customer";
    const customerEmail = order.guestEmail || order.userEmail || order.user?.email || "-";
    const customerPhone = order.guestPhone || order.user?.phone || "-";
    const total = `AED ${money(order.totalPrice)}`;
    const payment = (order.paymentMethod || "cod").toUpperCase();
    const items = Array.isArray(order.items)
      ? order.items
          .map((it: any) => `• ${it.product?.name || it.productName || "Item"} x${it.quantity || 1}`)
          .join("\n")
      : "";

    const values: Record<string, string> = {
      orderId: shortId,
      customerName,
      totalPrice: total,
      email: customerEmail,
      phone: customerPhone,
      paymentMethod: payment,
      items,
      time: gstTime(order.createdAt),
      link: ADMIN_ORDERS_URL,
    };

    const message =
      config.whatsappMessage && config.whatsappMessage.trim() !== ""
        ? applyTemplate(config.whatsappMessage, values)
        : [
            `🚨 *New Order Received* #${shortId}`,
            "",
            `👤 Customer: ${customerName}`,
            `📱 Phone: ${customerPhone}`,
            `📧 Email: ${customerEmail}`,
            `💰 Total: ${total}`,
            `💳 Payment: ${payment}`,
            ...(items ? ["🛒 Items:", items] : []),
            `🕐 ${values.time}`,
            "",
            `View orders: ${ADMIN_ORDERS_URL}`,
          ].join("\n");

    const buttons = buildButtons(config, values, "Open Orders");
    await dispatch(numbers, message, config.whatsappDeviceId || DEFAULT_DEVICE, "Order", buttons);
  } catch (error) {
    console.error("Error sending order WhatsApp notification:", error);
  }
};

// Admin-portal button editor -> stored button specs (max 10, GOWA limit).
export function sanitizeNotifyButtons(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((b: any) => b && ["call", "url", "copy", "reply"].includes(b.type))
    .map((b: any) => ({ type: b.type, label: String(b.label || "").trim().slice(0, 25), value: String(b.value || "").trim().slice(0, 500) }))
    .filter((b) => b.label)
    .slice(0, 10);
}
