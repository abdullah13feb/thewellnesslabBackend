// Admin WhatsApp alerts for new leads and new orders, mirroring the email alerts in email.ts.
// Config lives in the same Setting rows (lead_notification_config / order_notification_config) under
// the whatsapp* fields, managed from the admin portal's notification dialogs.

import prisma from "./prisma.js";
import { sendWhatsappMessage } from "./whatsappGateway.js";
import { orderRef, money, gstTime, phoneIntl, ADMIN_LEADS_URL, ADMIN_ORDERS_URL } from "./alertEmails.js";
import { suggestedProductOf } from "./quizLead.js";

type WhatsappNotifyConfig = {
  whatsappEnabled?: boolean;
  whatsappNumbers?: string;
  whatsappDeviceId?: string;
  whatsappMessage?: string;
};

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

async function dispatch(numbers: string[], message: string, deviceId: string, label: string) {
  for (const number of numbers) {
    try {
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

    await dispatch(numbers, message, config.whatsappDeviceId || DEFAULT_DEVICE, "Lead");
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

    await dispatch(numbers, message, config.whatsappDeviceId || DEFAULT_DEVICE, "Order");
  } catch (error) {
    console.error("Error sending order WhatsApp notification:", error);
  }
};
