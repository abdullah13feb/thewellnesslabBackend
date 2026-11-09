// The internal "new lead" and "new order" alert emails (designs in FixesNeeded/LeadAlert_Quiz_Template.html and
// OrderAlert_Template.html). Email-safe: tables and inline styles only, no <style> block, so Gmail and Outlook
// render them the same. Every value from a lead or order is escaped.

import { ANSWER_LABELS, QUIZ_FIELDS } from "./quizLead.js";
import { IP_FIELDS } from "./ipLocation.js";
import { TRACKING_FIELDS, deviceOf } from "./leadTracking.js";

const ADMIN_URL = (process.env.ADMIN_URL || "https://crm.thewellnesslab.ae").replace(/\/+$/, "");
export const ADMIN_LEADS_URL = `${ADMIN_URL}/leads`;
export const ADMIN_ORDERS_URL = `${ADMIN_URL}/orders`;

const DASH = "&mdash;";
const NOT_CAPTURED = "Not captured";

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).trim());
const show = (v: unknown, empty = DASH) => (text(v) ? esc(text(v)) : empty);

// Customer-facing order reference: TWL-10482. Orders without an order number fall back to the end of the
// system id.
export function orderRef(order: any): string {
  const n = Number(order?.orderNumber);
  return Number.isInteger(n) && n > 0 ? `TWL-${n}` : String(order?.id || "").slice(-6).toUpperCase();
}

export const money = (n: unknown) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Digits with the country code, for wa.me and tel: links. UAE numbers typed locally (050..., 50...) get 971.
export function phoneIntl(phone: unknown): string {
  let d = text(phone).replace(/\D/g, "").replace(/^00/, "");
  if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `971${d}`;
  return d;
}
const telHref = (phone: unknown) => {
  const intl = phoneIntl(phone);
  return intl.length >= 8 ? `tel:+${intl}` : `tel:${text(phone).replace(/[^\d+]/g, "")}`;
};

// "Sat, 7 Nov 2026 · 1:05 PM (GST)"
export function gstTime(when: unknown): string {
  const d = when ? new Date(when as any) : new Date();
  const date = isNaN(d.getTime()) ? new Date() : d;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", year: "numeric" })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const time = date.toLocaleTimeString("en-US", { timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit" });
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} · ${time} (GST)`;
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const brand = `<span style="font-weight:300;">The</span><span style="font-weight:600;">Wellness</span><span style="font-weight:300;">Lab</span>`;

// Phones (Gmail, Apple Mail, Outlook apps): side-by-side blocks stack, padding and the big numbers shrink.
// Clients that ignore <style> still get a fluid layout, since the card is width:100% up to 560px.
const MOBILE_CSS = `<style>
@media only screen and (max-width:480px) {
  .px { padding-left:16px !important; padding-right:16px !important; }
  .stack { display:block !important; width:100% !important; box-sizing:border-box; text-align:left !important; }
  .flush { padding-left:0 !important; padding-right:0 !important; }
  .stack-gap { padding-top:8px !important; }
  .half { display:inline-block !important; width:50% !important; box-sizing:border-box; padding:8px 16px !important; vertical-align:top; }
  .amt { font-size:28px !important; line-height:34px !important; }
  .name { font-size:20px !important; line-height:26px !important; }
  .thumb { width:48px !important; height:48px !important; }
  .thumb-cell { width:52px !important; }
  .qty-cell { width:40px !important; }
  .total-cell { width:auto !important; font-size:12px !important; padding-left:6px !important; }
  .item-name { font-size:13px !important; }
}
</style>`;

const shell = (inner: string, footer: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">${MOBILE_CSS}</head>
<body style="margin:0;padding:0;background-color:#EDE7DD;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EDE7DD" style="background-color:#EDE7DD;margin:0;padding:0;">
<tr><td align="center" style="padding:16px 10px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;font-family:Poppins,Helvetica,Arial,sans-serif;color:#1C1C1E;">
${inner}
  <tr><td align="center" style="padding:8px 0 0 0;font-size:10px;line-height:14px;color:#A39E95;">${footer} &nbsp;&middot;&nbsp; The Wellness Lab</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

// ---------------------------------------------------------------- Lead alert

const KNOWN_LEAD_FIELDS = new Set<string>([
  ...Object.values(QUIZ_FIELDS),
  ...Object.values(ANSWER_LABELS),
  ...Object.values(IP_FIELDS),
  ...Object.values(TRACKING_FIELDS),
]);

const answerCell = (label: string, value: string, side: "left" | "right") => `<td width="50%" valign="top" style="padding:${side === "left" ? "0 3px 6px 0" : "0 0 6px 3px"};">${
  label
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F7F4EF" style="background-color:#F7F4EF;border-radius:6px;padding:8px 12px;"><p style="margin:0;font-size:11px;line-height:15px;color:#8E8981;">${esc(label)}</p><p style="margin:3px 0 0 0;font-size:13px;line-height:18px;font-weight:600;color:#1C1C1E;">${esc(value)}</p></td></tr></table>`
    : "&nbsp;"
}</td>`;

const stripCell = (width: string, padding: string, label: string, valueHtml: string) =>
  `<td class="half" width="${width}" valign="top" style="padding:${padding};"><p style="margin:0;font-size:9px;line-height:13px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#A39E95;">${label}</p>${valueHtml}</td>`;
const stripValue = (html: string) => `<p style="margin:3px 0 0 0;font-size:13px;line-height:18px;font-weight:600;color:#1C1C1E;">${html}</p>`;

const trackCell = (label: string, valueHtml: string, side: "left" | "right") =>
  `<td class="stack flush" width="50%" valign="top" style="padding:${side === "left" ? "2px 8px 2px 0" : "2px 0 2px 8px"};"><span style="color:#A39E95;">${label}</span><br><span style="color:#55524D;">${valueHtml}</span></td>`;

export function leadAlertHtml(lead: any): string {
  const df: Record<string, unknown> = lead?.dynamicFields && typeof lead.dynamicFields === "object" ? lead.dynamicFields : {};
  const get = (key: string) => text(df[key]);
  const isQuiz = Boolean(get(QUIZ_FIELDS.suggested));

  const email = text(lead?.email);
  const phone = text(lead?.phone);
  const intl = phoneIntl(phone);

  // Hero: who, and the three ways to reach them (only the ones we have details for).
  const contactLine = [
    phone ? `<a href="${esc(telHref(phone))}" style="color:#BDB8AF;text-decoration:none;">${esc(phone)}</a>` : "",
    email ? `<a href="mailto:${esc(email)}" style="color:#BDB8AF;text-decoration:none;">${esc(email)}</a>` : "",
  ]
    .filter(Boolean)
    .join(" &nbsp;&middot;&nbsp; ");
  const buttons = [
    intl.length >= 8
      ? `<td bgcolor="#1FA855" style="background-color:#1FA855;border-radius:6px;"><a href="https://wa.me/${intl}" target="_blank" style="display:block;padding:7px 16px;font-size:12px;line-height:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">WhatsApp</a></td>`
      : "",
    phone
      ? `<td style="border:1px solid #4A4A4D;border-radius:6px;"><a href="${esc(telHref(phone))}" style="display:block;padding:6px 16px;font-size:12px;line-height:16px;font-weight:600;color:#F4F0E9;text-decoration:none;">Call</a></td>`
      : "",
    email
      ? `<td style="border:1px solid #4A4A4D;border-radius:6px;"><a href="mailto:${esc(email)}" style="display:block;padding:6px 16px;font-size:12px;line-height:16px;font-weight:600;color:#F4F0E9;text-decoration:none;">Email</a></td>`
      : "",
  ].filter(Boolean);
  const buttonsHtml = buttons.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
      ${buttons.join(`<td width="8" style="width:8px;font-size:1px;">&nbsp;</td>`)}
    </tr></table>`
    : "";

  // Strip: who it's for, city, source, status.
  const source = [esc(text(lead?.source) || "Website"), isQuiz && get(QUIZ_FIELDS.path) ? esc(get(QUIZ_FIELDS.path)) : ""]
    .filter(Boolean)
    .join(" &middot; ");
  const strip = `<tr><td bgcolor="#F7F4EF" style="background-color:#F7F4EF;border-bottom:1px solid #ECE7DF;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${stripCell("22%", "9px 0 9px 22px", "Who it's for", stripValue(show(get(ANSWER_LABELS.who))))}
      ${stripCell("20%", "9px 0 9px 10px", "City", stripValue(show(lead?.city)))}
      ${stripCell("38%", "9px 0 9px 10px", "Source", stripValue(source))}
      ${stripCell(
        "20%",
        "9px 22px 9px 10px",
        "Status",
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:3px;"><tr><td bgcolor="#E3F3E8" style="background-color:#E3F3E8;border-radius:4px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:600;letter-spacing:1px;color:#1A7F43;">${esc(text(lead?.status) || "NEW")}</td></tr></table>`
      )}
    </tr></table>
  </td></tr>`;

  // Match: the quiz recommendation.
  const also = get(QUIZ_FIELDS.also);
  const match = isQuiz
    ? `<tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 22px 0 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F1E3D8" style="background-color:#F1E3D8;border-left:4px solid #B5663C;border-radius:8px;"><tr>
      <td class="stack" valign="middle" style="padding:10px 14px;">
        <p style="margin:0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#B5663C;">Recommended Panel</p>
        <p style="margin:3px 0 0 0;font-size:18px;line-height:24px;font-weight:600;letter-spacing:1px;color:#1C1C1E;">${esc(get(QUIZ_FIELDS.suggested))}</p>
      </td>${
        also
          ? `
      <td class="stack" align="right" valign="middle" style="padding:0 14px 10px 14px;">
        <p style="margin:0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#9A8676;">Also consider</p>
        <p style="margin:3px 0 0 0;font-size:14px;line-height:20px;font-weight:600;letter-spacing:0.5px;color:#1C1C1E;">${esc(also)}</p>
      </td>`
          : ""
      }
    </tr></table>
  </td></tr>`
    : "";

  // Answers: quiz answers in quiz order (Goal, Coverage, Practice, Where it will live, or the pet questions),
  // then any other form fields, two per row.
  const answers: [string, string][] = Object.entries(ANSWER_LABELS)
    .filter(([key]) => key !== "who")
    .map(([, label]) => [sentenceCase(label), get(label)] as [string, string])
    .filter(([, v]) => v);
  for (const [key, value] of Object.entries(df)) {
    if (!KNOWN_LEAD_FIELDS.has(key) && text(value)) answers.push([key, text(value)]);
  }
  const answerRows: string[] = [];
  for (let i = 0; i < answers.length; i += 2) {
    const [l1, v1] = answers[i];
    const [l2, v2] = answers[i + 1] || ["", ""];
    answerRows.push(`<tr>${answerCell(l1, v1, "left")}${answerCell(l2, v2, "right")}</tr>`);
  }
  const company = text(lead?.company);
  const jobTitle = text(lead?.jobTitle);
  const companyLine =
    company || jobTitle
      ? `<p style="margin:0;font-size:11px;line-height:16px;color:#8E8981;">Company: <span style="color:#1C1C1E;">${show(company)}</span> &nbsp;&middot;&nbsp; Job title: <span style="color:#1C1C1E;">${show(jobTitle)}</span></p>`
      : "";
  const answersBlock =
    answerRows.length || companyLine
      ? `<tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 22px 0 22px;">
    ${
      answerRows.length
        ? `<p style="margin:0 0 6px 0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8E8981;">What they told us</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${answerRows.join("\n      ")}
    </table>`
        : ""
    }
    ${companyLine}
  </td></tr>`
      : "";

  // Tracking.
  const page = get(QUIZ_FIELDS.page);
  const eventId = get(QUIZ_FIELDS.eventId);
  const ipPlace = [get(IP_FIELDS.location), get(IP_FIELDS.isp)].filter(Boolean).map(esc).join(" &middot; ");
  const trackingRows = [
    `<tr>${trackCell("Campaign", show(get(TRACKING_FIELDS.campaign), NOT_CAPTURED), "left")}${trackCell("Device", show(get(TRACKING_FIELDS.device), NOT_CAPTURED), "right")}</tr>`,
    page || eventId
      ? `<tr>${trackCell(
          "Quiz page",
          page ? `<a href="${esc(page)}" target="_blank" style="color:#55524D;text-decoration:underline;word-break:break-all;">${esc(page)}</a>` : NOT_CAPTURED,
          "left"
        )}${trackCell("Event ID", show(eventId, NOT_CAPTURED), "right")}</tr>`
      : "",
    `<tr>${trackCell("IP address", show(get(IP_FIELDS.ip), NOT_CAPTURED), "left")}${trackCell("IP location", ipPlace || NOT_CAPTURED, "right")}</tr>`,
  ].filter(Boolean);

  const inner = `
  <tr><td class="px" bgcolor="#1C1C1E" style="background-color:#1C1C1E;border-radius:12px 12px 0 0;padding:14px 22px 0 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="font-size:16px;line-height:20px;color:#F4F0E9;">${brand}</td>
      <td align="right" valign="middle" style="font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#B5663C;">&#9679;&nbsp; ${isQuiz ? "New Quiz Lead" : "New Lead"}</td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr><td height="1" bgcolor="#B5663C" style="height:1px;line-height:1px;font-size:1px;background-color:#B5663C;">&nbsp;</td></tr></table>
  </td></tr>
  <tr><td class="px" bgcolor="#1C1C1E" style="background-color:#1C1C1E;padding:12px 22px 16px 22px;">
    <p style="margin:0;font-size:11px;line-height:16px;color:#8E8981;">${esc(gstTime(lead?.createdAt))}</p>
    <p class="name" style="margin:2px 0 0 0;font-size:22px;line-height:28px;font-weight:600;color:#F4F0E9;">${show(lead?.name, "New lead")}</p>
    ${contactLine ? `<p style="margin:2px 0 0 0;font-size:12px;line-height:18px;color:#BDB8AF;">${contactLine}</p>` : ""}
    ${buttonsHtml}
  </td></tr>
  ${strip}
  ${match}
  ${answersBlock}
  <tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:10px 22px 14px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="#1C1C1E" style="background-color:#1C1C1E;border-radius:8px;"><a href="${esc(ADMIN_LEADS_URL)}" target="_blank" style="display:block;padding:10px 20px;font-size:13px;line-height:18px;font-weight:600;color:#F4F0E9;text-decoration:none;">Open in Admin Portal &rarr;</a></td>
    </tr></table>
  </td></tr>
  <tr><td class="px" bgcolor="#F7F4EF" style="background-color:#F7F4EF;border-radius:0 0 12px 12px;padding:10px 22px 12px 22px;">
    <p style="margin:0 0 4px 0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#A39E95;">Tracking</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:11px;line-height:15px;">
      ${trackingRows.join("\n      ")}
    </table>
  </td></tr>
`;
  return shell(inner, "Automated lead notification");
}

// ---------------------------------------------------------------- Order alert

const PAYMENT_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  stripe: "Card",
  card: "Card",
  paymob: "Card",
  apple_pay: "Apple Pay",
  tabby: "Tabby",
};

const isHttpsImage = (url: unknown) => /^https:\/\/\S+$/i.test(text(url));

function itemImage(url: string, name: string) {
  if (isHttpsImage(url)) {
    return `<img class="thumb" src="${esc(url)}" alt="${esc(name)}" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border:1px solid #ECE7DF;border-radius:8px;background-color:#FFFFFF;">`;
  }
  return `<table role="presentation" class="thumb" width="64" cellpadding="0" cellspacing="0" border="0"><tr><td class="thumb" width="64" height="64" align="center" valign="middle" bgcolor="#F7F4EF" style="width:64px;height:64px;border:1px solid #ECE7DF;border-radius:8px;background-color:#F7F4EF;font-size:9px;line-height:12px;font-weight:600;letter-spacing:0.5px;color:#A39E95;">${esc(name)}</td></tr></table>`;
}

// Where the order came from, from what checkout saved on the order (UTM tags, Meta click id, IP, user agent).
// ip is the location lookup for order.clientIp (lookupIp), done by the caller.
function orderTracking(order: any, ip: { location?: string; isp?: string }) {
  const source = [text(order?.utmSource), text(order?.utmMedium)].filter(Boolean).join(" / ");
  const adClick = text(order?.fbclid) || text(order?.fbc) ? "Yes (Meta ad)" : "";
  const ipPlace = [ip.location, ip.isp].filter(Boolean).map(esc).join(" &middot; ");
  const rows = [
    `<tr>${trackCell("Campaign", show(order?.utmCampaign, NOT_CAPTURED), "left")}${trackCell("Device", show(deviceOf(text(order?.clientUserAgent)), NOT_CAPTURED), "right")}</tr>`,
    `<tr>${trackCell("Source", show(source, NOT_CAPTURED), "left")}${trackCell("Meta ad click", show(adClick, "No"), "right")}</tr>`,
    `<tr>${trackCell("IP address", show(order?.clientIp, NOT_CAPTURED), "left")}${trackCell("IP location", ipPlace || NOT_CAPTURED, "right")}</tr>`,
  ];
  return `<p style="margin:0 0 4px 0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#A39E95;">Tracking</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:11px;line-height:15px;">
      ${rows.join("\n      ")}
    </table>`;
}

export function orderAlertHtml(order: any, ip: { location?: string; isp?: string } = {}): string {
  const id = text(order?.id);
  const shortId = orderRef(order);
  const items: { name: string; qty: number; price: number; image: string }[] = (Array.isArray(order?.items) ? order.items : []).map((it: any) => ({
    name: text(it?.product?.name || it?.name) || "Product",
    qty: Number(it?.quantity) || 1,
    price: Number(it?.price) || 0,
    image: text(it?.product?.image || it?.product?.images?.[0] || it?.image),
  }));
  const count = items.reduce((n, it) => n + it.qty, 0);
  const total = Number(order?.totalPrice) || 0;
  const subtotal = Number(order?.subtotal) || items.reduce((n, it) => n + it.price * it.qty, 0);
  const shipping = Number(order?.shippingCharge) || 0;
  const discount = Number(order?.discount) || 0;
  const vat = (total * 5) / 105;

  const paid = text(order?.paymentStatus).toLowerCase() === "paid";
  const method = text(order?.paymentMethod).toLowerCase() || "cod";
  const methodLabel = PAYMENT_LABELS[method] || method.replace(/_/g, " ");

  const customerName = text(order?.guestName || order?.user?.name) || "Customer";
  const email = text(order?.guestEmail || order?.userEmail || order?.user?.email);
  const phone = text(order?.guestPhone || order?.user?.phone);
  const intl = phoneIntl(phone);
  const pincode = text(order?.pincode);
  const addressHtml = [text(order?.address), [text(order?.city), pincode && pincode !== "00000" ? pincode : ""].filter(Boolean).join(" ")]
    .filter(Boolean)
    .map(esc)
    .join("<br>");

  const itemRows = items.length
    ? items
        .map(
          (it) => `<tr>
        <td class="thumb-cell" width="68" valign="middle" style="width:68px;padding:8px 0;border-bottom:1px solid #ECE7DF;">
          ${itemImage(it.image, it.name)}
        </td>
        <td valign="middle" style="padding:8px 0 8px 12px;border-bottom:1px solid #ECE7DF;">
          <p class="item-name" style="margin:0;font-size:14px;line-height:19px;font-weight:600;letter-spacing:0.5px;color:#1C1C1E;">${esc(it.name)}</p>
          <p style="margin:1px 0 0 0;font-size:11px;line-height:16px;color:#8E8981;">AED ${money(it.price)} each</p>
        </td>
        <td class="qty-cell" width="56" align="center" valign="middle" style="width:56px;padding:8px 0;border-bottom:1px solid #ECE7DF;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F1E3D8" style="background-color:#F1E3D8;border-radius:12px;padding:2px 10px;font-size:12px;line-height:18px;font-weight:600;color:#B5663C;">&times;${it.qty}</td></tr></table>
        </td>
        <td class="total-cell" width="100" align="right" valign="middle" style="width:100px;padding:8px 0;border-bottom:1px solid #ECE7DF;font-size:13px;line-height:18px;font-weight:600;color:#1C1C1E;white-space:nowrap;">AED ${money(it.price * it.qty)}</td>
      </tr>`
        )
        .join("\n      ")
    : `<tr><td colspan="4" style="padding:8px 0;border-bottom:1px solid #ECE7DF;font-size:12px;color:#8E8981;">No item details available</td></tr>`;

  const actions = [
    intl.length >= 8
      ? `<td width="34%" align="center" bgcolor="#1FA855" style="background-color:#1FA855;border-radius:6px;"><a href="https://wa.me/${intl}" target="_blank" style="display:block;padding:9px 6px;font-size:12px;line-height:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">WhatsApp</a></td>`
      : "",
    phone
      ? `<td width="20%" align="center" style="border:1px solid #D9D3C9;border-radius:6px;"><a href="${esc(telHref(phone))}" style="display:block;padding:8px 6px;font-size:12px;line-height:16px;font-weight:600;color:#1C1C1E;text-decoration:none;">Call</a></td>`
      : "",
    `<td align="center" bgcolor="#1C1C1E" style="background-color:#1C1C1E;border-radius:6px;"><a href="${esc(ADMIN_ORDERS_URL)}" target="_blank" style="display:block;padding:9px 6px;font-size:12px;line-height:16px;font-weight:600;color:#F4F0E9;text-decoration:none;">Open Order &rarr;</a></td>`,
  ].filter(Boolean);

  const inner = `
  <tr><td class="px" bgcolor="#1C1C1E" style="background-color:#1C1C1E;border-radius:12px 12px 0 0;padding:14px 22px 0 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="font-size:16px;line-height:20px;color:#F4F0E9;">${brand}</td>
      <td align="right" valign="middle">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#1FA855" style="background-color:#1FA855;border-radius:4px;padding:3px 10px;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#FFFFFF;">&#9679;&nbsp; New Order</td>
        </tr></table>
      </td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr><td height="1" bgcolor="#3A3A3D" style="height:1px;line-height:1px;font-size:1px;background-color:#3A3A3D;">&nbsp;</td></tr></table>
  </td></tr>
  <tr><td class="px" bgcolor="#1C1C1E" style="background-color:#1C1C1E;padding:16px 22px 18px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="stack" valign="bottom">
        <p style="margin:0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#B5663C;">Order #${esc(shortId)} &nbsp;&middot;&nbsp; ${count} ${count === 1 ? "item" : "items"}</p>
        <p class="amt" style="margin:4px 0 0 0;font-size:34px;line-height:40px;font-weight:600;color:#F4F0E9;">AED ${money(total)}</p>
        <p style="margin:2px 0 0 0;font-size:11px;line-height:16px;color:#8E8981;">${esc(gstTime(order?.createdAt))}</p>
      </td>
      <td class="stack stack-gap" align="right" valign="bottom">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="${paid ? "#1FA855" : "#C98A1A"}" style="background-color:${paid ? "#1FA855" : "#C98A1A"};border-radius:4px;padding:3px 9px;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;">${paid ? "Paid" : "Payment pending"}</td>
        </tr></table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:5px;"><tr>
          <td style="border:1px solid #B5663C;border-radius:4px;padding:2px 9px;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#E39A70;">${esc(text(order?.status) || "PENDING")}</td>
        </tr></table>
        <p style="margin:5px 0 0 0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#BDB8AF;">${esc(methodLabel)}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td height="4" bgcolor="#B5663C" style="height:4px;line-height:4px;font-size:1px;background-color:#B5663C;">&nbsp;</td></tr>
  <tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:14px 22px 4px 22px;">
    <p style="margin:0 0 4px 0;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#8E8981;">Items Ordered</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${itemRows}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;font-size:11px;line-height:17px;color:#8E8981;">
      <tr><td>Subtotal</td><td align="right" style="color:#1C1C1E;">AED ${money(subtotal)}</td></tr>
      <tr><td>Shipping</td><td align="right" style="color:#1C1C1E;">${shipping > 0 ? `AED ${money(shipping)}` : "Free"}</td></tr>${
        discount > 0
          ? `
      <tr><td>Discount${order?.couponCode ? ` (${esc(order.couponCode)})` : ""}</td><td align="right" style="color:#1A7F43;">&minus;AED ${money(discount)}</td></tr>`
          : ""
      }
      <tr><td>VAT 5% (included)</td><td align="right" style="color:#1C1C1E;">AED ${money(vat)}</td></tr>
      <tr><td style="padding-top:4px;font-size:12px;font-weight:600;color:#1C1C1E;">Total</td><td align="right" style="padding-top:4px;font-size:14px;font-weight:600;color:#1C1C1E;">AED ${money(total)}</td></tr>
    </table>
  </td></tr>
  <tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 22px 0 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="stack flush" width="50%" valign="top" style="padding-right:4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F7F4EF" style="background-color:#F7F4EF;border-radius:8px;padding:10px 12px;">
          <p style="margin:0;font-size:9px;line-height:13px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#A39E95;">Customer</p>
          <p style="margin:3px 0 0 0;font-size:14px;line-height:19px;font-weight:600;color:#1C1C1E;">${esc(customerName)}</p>
          <p style="margin:2px 0 0 0;font-size:11px;line-height:16px;color:#55524D;">${[
            phone ? `<a href="${esc(telHref(phone))}" style="color:#55524D;text-decoration:none;">${esc(phone)}</a>` : "",
            email ? `<a href="mailto:${esc(email)}" style="color:#55524D;text-decoration:none;">${esc(email)}</a>` : "",
          ]
            .filter(Boolean)
            .join("<br>") || DASH}</p>
        </td></tr></table>
      </td>
      <td class="stack flush stack-gap" width="50%" valign="top" style="padding-left:4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#F7F4EF" style="background-color:#F7F4EF;border-radius:8px;padding:10px 12px;">
          <p style="margin:0;font-size:9px;line-height:13px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#A39E95;">Deliver to</p>
          <p style="margin:3px 0 0 0;font-size:12px;line-height:17px;color:#1C1C1E;">${addressHtml || DASH}</p>
        </td></tr></table>
      </td>
    </tr></table>
  </td></tr>
  <tr><td class="px" bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:12px 22px 16px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${actions.join(`<td width="6" style="width:6px;font-size:1px;">&nbsp;</td>`)}
    </tr></table>
  </td></tr>
  <tr><td class="px" bgcolor="#F7F4EF" style="background-color:#F7F4EF;border-radius:0 0 12px 12px;padding:10px 22px 12px 22px;">
    ${orderTracking(order, ip)}
    <p style="margin:8px 0 0 0;font-size:10px;line-height:15px;color:#A39E95;">System ID: ${esc(id)}</p>
  </td></tr>
`;
  return shell(inner, "Automated order notification");
}
