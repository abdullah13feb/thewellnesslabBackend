// Customer order confirmation email (design: TWL_OrderConfirmation_Handoff, template.html).
// Tables and inline styles are deliberate so it renders in Gmail and Outlook: don't convert to divs,
// flexbox or external CSS. The <head> holds the mobile styles and fonts. The icons are public files in S3
// (EMAIL_ASSETS_URL).

import { esc, money, orderRef } from "./alertEmails.js";

const EMAIL_ASSETS_URL = (
  process.env.EMAIL_ASSETS_URL || "https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/email-assets"
).replace(/\/+$/, "");
const STOREFRONT_URL = (process.env.STOREFRONT_URL || "https://thewellnesslab.ae").replace(/\/+$/, "");

export function customerFirstName(order: any): string {
  const name = String(order?.guestName || order?.user?.name || "").trim();
  return name.split(/\s+/)[0] || "";
}

// "8 Nov 2026" in Dubai time.
function orderDate(when: unknown): string {
  const d = when ? new Date(when as any) : new Date();
  const date = isNaN(d.getTime()) ? new Date() : d;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric" }).format(date);
}

// Email clients need an absolute https URL.
function absoluteImage(src: unknown): string {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:/i, "https:");
  if (s.startsWith("//")) return `https:${s}`;
  return `${STOREFRONT_URL}/${s.replace(/^\/+/, "")}`;
}

export function orderConfirmationSubject(order: any): string {
  const firstName = customerFirstName(order).replace(/[\r\n]/g, "");
  return firstName ? `Thank you, ${firstName}. Your order is confirmed` : "Thank you. Your order is confirmed";
}

export function orderConfirmationHtml(order: any): string {
  const ref = orderRef(order);
  const firstName = customerFirstName(order);
  const items: { name: string; image: string; qty: number; unitPrice: number; lineTotal: number }[] = (order.items || []).map((i: any) => {
    const unitPrice = Number(i.price) || 0;
    const qty = Number(i.quantity) || 0;
    return {
      name: i.product?.name || "Product",
      image: absoluteImage(i.product?.image || i.product?.images?.[0]),
      qty,
      unitPrice,
      lineTotal: unitPrice * qty,
    };
  });
  const itemsTotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const subtotal = Number(order.subtotal) || itemsTotal;
  const shipping = Number(order.shippingCharge) || 0;
  const discount = Number(order.discount) || 0;
  const couponCode = order.couponCode || "";
  const total = Number(order.totalPrice) || 0;
  // Prices include 5% VAT.
  const vat = Math.round(((total * 5) / 105) * 100) / 100;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Your order is confirmed</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background-color:#F4F2EE;}
  a{text-decoration:none;}
  @media (max-width:480px){
    .px{padding-left:20px !important;padding-right:20px !important;}
    .h1{font-size:32px !important;line-height:36px !important;}
    .h1b{font-size:26px !important;line-height:30px !important;}
    .iname{font-size:15px !important;letter-spacing:0.5px !important;}
    .stack{display:block !important;width:100% !important;text-align:center !important;}
    .stack-gap{padding-top:12px !important;padding-left:0 !important;}
    .center-m{margin:0 auto !important;float:none !important;}
  }
  @media (max-width:340px){
    .tot{white-space:normal !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#F4F2EE;">

<!-- Inbox preview text -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#F4F2EE;">We're preparing your order now. Delivery in 48 to 72 hours, plus AED 500 off your next order.&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F2EE" style="background-color:#F4F2EE;">
<tr><td align="center" style="padding:16px 12px 22px 12px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;font-family:Montserrat,Helvetica,Arial,sans-serif;color:#1C1C1E;">

  <!-- ===== WORDMARK + SPECTRUM (9 wavelengths) ===== -->
  <tr><td align="center" style="padding:0 0 18px 0;">
    <a href="https://thewellnesslab.ae" target="_blank" style="text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:18px;line-height:22px;font-weight:800;letter-spacing:-0.4px;color:#1C1C1E;">THE<span style="color:#C0172C;">WELLNESS</span>LAB</a>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>
      <td width="12" height="3" bgcolor="#3D7BF0" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#3D7BF0;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#F26B2A" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#F26B2A;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#EC4A2C" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#EC4A2C;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#D62839" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#D62839;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#C41E3A" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#C41E3A;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#9C1B33" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#9C1B33;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#7E1729" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#7E1729;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#631322" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#631322;">&nbsp;</td>
      <td width="12" height="3" bgcolor="#3D1A1F" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#3D1A1F;">&nbsp;</td>
    </tr></table>
  </td></tr>

  <!-- ===== CARD ===== -->
  <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

      <!-- Hero -->
      <tr><td class="px" align="center" style="padding:28px 40px 0 40px;">
        <img src="${EMAIL_ASSETS_URL}/badge.png" alt="Order confirmed" width="60" height="60" style="display:block;width:60px;height:60px;margin:0 auto;">
        <p style="margin:14px 0 0 0;font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#C0172C;">Order No. ${esc(ref)}</p>
        <p class="h1" style="margin:8px 0 0 0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:40px;line-height:44px;font-weight:500;color:#1C1C1E;">${firstName ? `Thank you, ${esc(firstName)}.` : "Thank you."}</p>
        <p class="h1b" style="margin:0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:32px;line-height:38px;font-weight:500;font-style:italic;color:#C0172C;">Your order is confirmed.</p>
        <p style="margin:12px auto 0 auto;max-width:440px;font-size:14px;line-height:22px;color:#5E5A55;">Our team is preparing it now. We'll email you the moment it ships, and it should reach you within <span style="white-space:nowrap;color:#1C1C1E;font-weight:600;">48 to 72 hours</span>.</p>
      </td></tr>

      <!-- Tracker -->
      <tr><td class="px" style="padding:20px 40px 0 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="38" valign="middle" style="width:38px;"><img src="${EMAIL_ASSETS_URL}/t1.png" alt="" width="38" height="38" style="display:block;width:38px;height:38px;"></td>
          <td valign="middle" style="padding:0 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="50%" height="2" bgcolor="#C0172C" style="height:2px;font-size:1px;line-height:2px;background-color:#C0172C;">&nbsp;</td>
            <td width="50%" height="2" bgcolor="#ECE6E0" style="height:2px;font-size:1px;line-height:2px;background-color:#ECE6E0;">&nbsp;</td>
          </tr></table></td>
          <td width="38" valign="middle" style="width:38px;"><img src="${EMAIL_ASSETS_URL}/t2.png" alt="" width="38" height="38" style="display:block;width:38px;height:38px;"></td>
          <td valign="middle" style="padding:0 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td height="2" bgcolor="#ECE6E0" style="height:2px;font-size:1px;line-height:2px;background-color:#ECE6E0;">&nbsp;</td>
          </tr></table></td>
          <td width="38" valign="middle" style="width:38px;"><img src="${EMAIL_ASSETS_URL}/t3.png" alt="" width="38" height="38" style="display:block;width:38px;height:38px;"></td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr>
          <td width="33%" align="left" valign="top" style="font-size:11px;line-height:15px;"><span style="font-weight:700;color:#1C1C1E;">Confirmed</span><br><span style="color:#9A958E;">Today</span></td>
          <td width="34%" align="center" valign="top" style="font-size:11px;line-height:15px;"><span style="font-weight:600;color:#6E6A64;">Dispatched</span><br><span style="color:#9A958E;">We'll email you</span></td>
          <td width="33%" align="right" valign="top" style="font-size:11px;line-height:15px;"><span style="font-weight:600;color:#6E6A64;">Delivered</span><br><span style="color:#9A958E;">48 to 72 hrs</span></td>
        </tr></table>
      </td></tr>

      <!-- Order summary -->
      <tr><td class="px" style="padding:22px 40px 0 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FAF8F5" style="background-color:#FAF8F5;border-radius:14px;">
          <tr><td style="padding:16px 18px 4px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="bottom" style="font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:22px;line-height:26px;font-weight:500;color:#1C1C1E;">Your order</td>
              <td align="right" valign="bottom" style="font-size:11px;line-height:16px;color:#9A958E;">${esc(orderDate(order.createdAt))}</td>
            </tr></table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
              ${items.map((it) => `
              <tr>
                <td width="56" valign="middle" style="width:56px;padding:8px 0;border-top:1px solid #EEE9E3;">
                  ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.name)}" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:10px;border:1px solid #EEE9E3;background-color:#FFFFFF;">` : `<table role="presentation" width="56" cellpadding="0" cellspacing="0" border="0"><tr><td width="56" height="56" bgcolor="#FFFFFF" style="width:56px;height:56px;border-radius:10px;border:1px solid #EEE9E3;background-color:#FFFFFF;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`}
                </td>
                <td valign="middle" style="padding:8px 0 8px 14px;border-top:1px solid #EEE9E3;">
                  <p class="iname" style="margin:0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:18px;line-height:21px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#1C1C1E;">${esc(it.name)}</p>
                  <p style="margin:2px 0 0 0;font-size:11px;line-height:16px;color:#9A958E;">Qty ${esc(it.qty)} &middot; AED ${money(it.unitPrice)}</p>
                </td>
                <td align="right" valign="middle" style="padding:8px 0;border-top:1px solid #EEE9E3;font-size:13px;line-height:18px;font-weight:600;color:#1C1C1E;white-space:nowrap;">AED ${money(it.lineTotal)}</td>
              </tr>`).join("")}
            </table>
          </td></tr>
          <tr><td style="padding:0 18px 16px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #EEE9E3;font-size:12px;line-height:18px;color:#8A857E;">
              <tr><td style="padding:10px 0 1px 0;">Subtotal</td><td align="right" style="padding:10px 0 1px 0;color:#1C1C1E;">AED ${money(subtotal)}</td></tr>
              <tr><td style="padding:1px 0;">Delivery</td><td align="right" style="padding:1px 0;${shipping > 0 ? "color:#1C1C1E;" : "color:#1A7F43;font-weight:600;"}">${shipping > 0 ? `AED ${money(shipping)}` : "Free"}</td></tr>${discount > 0 ? `
              <tr><td style="padding:1px 0;">Discount${couponCode ? ` (${esc(couponCode)})` : ""}</td><td align="right" style="padding:1px 0;color:#1A7F43;font-weight:600;">&minus;AED ${money(discount)}</td></tr>` : ""}
              <tr><td style="padding:1px 0 10px 0;">VAT 5% (included)</td><td align="right" style="padding:1px 0 10px 0;color:#1C1C1E;">AED ${money(vat)}</td></tr>
              <tr>
                <td style="padding:10px 0 0 0;border-top:1px solid #1C1C1E;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1C1C1E;">Total</td>
                <td class="tot" align="right" style="padding:10px 0 0 0;border-top:1px solid #1C1C1E;font-size:18px;line-height:22px;font-weight:700;color:#1C1C1E;white-space:nowrap;">AED ${money(total)}</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Help -->
      <tr><td class="px" style="padding:16px 40px 22px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="stack" valign="middle" style="font-size:13px;line-height:18px;color:#5E5A55;"><span style="font-weight:600;color:#1C1C1E;">Questions?</span> We reply fast.</td>
          <td class="stack stack-gap" align="right" valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="margin:0 auto;"><tr>
              <td style="border:1px solid #E6DFD8;border-radius:20px;"><a href="https://wa.me/971585865195?text=Hi%2C%20my%20order%20is%20${encodeURIComponent(ref)}" target="_blank" style="display:block;padding:7px 12px;font-size:12px;line-height:16px;font-weight:600;color:#1C1C1E;text-decoration:none;white-space:nowrap;"><img src="${EMAIL_ASSETS_URL}/iwa.png" alt="" width="16" height="16" style="display:inline-block;width:16px;height:16px;vertical-align:-3px;border:0;">&nbsp; WhatsApp</a></td>
              <td width="6" style="width:6px;font-size:1px;">&nbsp;</td>
              <td style="border:1px solid #E6DFD8;border-radius:20px;"><a href="tel:+971585865195" style="display:block;padding:7px 12px;font-size:12px;line-height:16px;font-weight:600;color:#1C1C1E;text-decoration:none;white-space:nowrap;"><img src="${EMAIL_ASSETS_URL}/icall.png" alt="" width="16" height="16" style="display:inline-block;width:16px;height:16px;vertical-align:-3px;border:0;">&nbsp; Call</a></td>
              <td width="6" style="width:6px;font-size:1px;">&nbsp;</td>
              <td style="border:1px solid #E6DFD8;border-radius:20px;"><a href="mailto:support@thewellnesslab.ae" style="display:block;padding:7px 12px;font-size:12px;line-height:16px;font-weight:600;color:#1C1C1E;text-decoration:none;white-space:nowrap;"><img src="${EMAIL_ASSETS_URL}/imail.png" alt="" width="16" height="16" style="display:inline-block;width:16px;height:16px;vertical-align:-3px;border:0;">&nbsp; Email</a></td>
            </tr></table>
          </td>
        </tr></table>
      </td></tr>

    </table>
  </td></tr>

  <!-- ===== COUPON: next order ===== -->
  <tr><td style="padding:12px 0 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1C1C1E" style="background-color:#1C1C1E;border-radius:18px;">
      <tr><td class="px" style="padding:20px 26px 20px 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="stack" valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="center-m"><tr><td width="12" height="3" bgcolor="#3D7BF0" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#3D7BF0;">&nbsp;</td><td width="12" height="3" bgcolor="#F26B2A" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#F26B2A;">&nbsp;</td><td width="12" height="3" bgcolor="#EC4A2C" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#EC4A2C;">&nbsp;</td><td width="12" height="3" bgcolor="#D62839" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#D62839;">&nbsp;</td><td width="12" height="3" bgcolor="#C41E3A" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#C41E3A;">&nbsp;</td><td width="12" height="3" bgcolor="#9C1B33" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#9C1B33;">&nbsp;</td><td width="12" height="3" bgcolor="#7E1729" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#7E1729;">&nbsp;</td><td width="12" height="3" bgcolor="#631322" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#631322;">&nbsp;</td><td width="12" height="3" bgcolor="#3D1A1F" style="width:12px;height:3px;font-size:1px;line-height:3px;background-color:#3D1A1F;">&nbsp;</td></tr></table>
            <p style="margin:10px 0 0 0;font-size:10px;line-height:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#E0505F;">A thank you for next time</p>
            <p style="margin:4px 0 0 0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:32px;line-height:34px;font-weight:500;color:#FFFFFF;">AED 500 off</p>
            <p style="margin:0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:20px;line-height:24px;font-weight:500;font-style:italic;color:#F4D6D9;">your next order, on us.</p>
          </td>
          <td class="stack stack-gap" align="right" valign="middle" style="padding-left:16px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" class="center-m" style="margin:0 auto;"><tr>
              <td align="center" style="border:1.5px dashed #8A8580;border-radius:10px;padding:10px 16px;">
                <p style="margin:0;font-size:9px;line-height:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#9A958E;">Use code</p>
                <p style="margin:3px 0 0 0;font-family:'Courier New',Courier,monospace;font-size:16px;line-height:20px;font-weight:700;letter-spacing:1.5px;color:#FFFFFF;white-space:nowrap;">REDALLOVERAGAIN</p>
              </td>
            </tr></table>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- ===== FOOTER ===== -->
  <tr><td align="center" style="padding:20px 20px 0 20px;">
    <p style="margin:0;font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-size:18px;line-height:22px;font-style:italic;color:#1C1C1E;">Recovery done right.</p>
    <p style="margin:8px 0 0 0;font-size:11px;line-height:16px;">
      <a href="https://thewellnesslab.ae" target="_blank" style="color:#6E6A64;text-decoration:none;">Shop</a>
      <span style="color:#C9C3BB;">&nbsp;&middot;&nbsp;</span>
      <a href="https://thewellnesslab.ae/quiz" target="_blank" style="color:#6E6A64;text-decoration:none;">Find your panel</a>
    </p>
    <p style="margin:10px 0 0 0;font-size:10px;line-height:15px;color:#A39E96;">We'll never ask for your bank details, PIN, CVV or OTP by phone, SMS or email.<br>&copy; 2026 The Wellness Lab &middot; Dubai, UAE</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}
