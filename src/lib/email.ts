import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import prisma from './prisma.js';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOrderConfirmationEmail = async (order: any) => {
  const email = order.guestEmail || order.userEmail; // Assuming we have one of these
  if (!email) {
    console.error('No email address found for order confirmation');
    return;
  }

  if (!order.items) {
    console.error('No items found in order for email confirmation');
    return;
  }

  const mailOptions = {
    from: `"the wellness lab" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Order Confirmation - #${order.id.slice(-6).toUpperCase()}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #e5e5e5; -webkit-font-smoothing: antialiased; }
          .wrapper { padding: 40px 20px; background-color: #e5e5e5; width: 100%; box-sizing: border-box; }
          .main { background-color: #ffffff; margin: 0 auto; width: 100%; max-width: 500px; padding: 40px; box-sizing: border-box; }
          .brand-logo { font-size: 26px; font-weight: 800; color: #111; letter-spacing: -1px; margin-bottom: 30px; }
          .greeting { font-size: 14px; color: #444; margin: 0 0 8px; }
          .greeting strong { font-size: 18px; color: #111; font-weight: 600; display: block; margin-top: 6px; }
          .divider { border-top: 1px solid #eaeaea; margin: 24px 0; }
          .dotted-divider { border-top: 1px dashed #cccccc; margin: 24px 0; }
          .items-list { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
          .item-row td { padding: 8px 0; font-size: 14px; color: #333; }
          .total-paid { font-size: 16px; font-weight: 700; color: #111; margin: 24px 0; }
          .disclaimer { font-size: 10px; color: #888; text-align: center; line-height: 1.5; margin: 30px 0; padding: 0 10px; }
          .footer { text-align: center; font-size: 10px; color: #999; line-height: 1.6; }
          .footer strong { color: #555; }
          @media screen and (max-width: 500px) {
            .wrapper { padding: 0; }
            .main { padding: 30px 20px; border: none; }
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="main">
            <div class="brand-logo">THE<span style="color: #e63946; font-weight: 800;">WELLNESS</span>LAB</div>
            
            <div class="greeting">
              Hi ${order.guestName ? order.guestName.split(' ')[0] : 'Customer'},
              <strong>Thank you for ordering from THE<span style="color: #e63946; font-weight: 800;">WELLNESS</span>LAB</strong>
            </div>

            <div class="divider"></div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 15px 0;">
              <tr>
                <td style="font-size: 12px; font-weight: 600; color: #555; text-transform: uppercase;">
                  ORDER ID: ${order.id.slice(-10).toUpperCase()}
                </td>
                <td align="right" style="font-size: 12px; font-weight: 600; color: #219653;">
                  <table cellpadding="0" cellspacing="0" border="0" align="right">
                    <tr>
                      <td style="width:14px; height:14px; background-color:#219653; color:#fff; border-radius:50%; text-align:center; vertical-align:middle; font-size:9px;">✓</td>
                      <td style="padding-left: 5px; color:#219653;">Order Confirmed</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <div class="dotted-divider"></div>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
              <tr>
                <td width="55" valign="top">
                  <div style="width: 40px; height: 40px; background-color: #e63946; color: #fff; text-align: center; border-radius: 4px; font-weight: 700; font-size: 14px; letter-spacing: 1px;">
                    <table width="100%" height="100%" cellpadding="0" cellspacing="0">
                      <tr><td align="center" valign="middle">TWL</td></tr>
                    </table>
                  </div>
                </td>
                <td valign="middle">
                  <h3 style="margin: 0 0 4px; font-size: 15px; color: #111; font-weight: 800; text-transform: uppercase;">THE<span style="color: #e63946; font-weight: 800;">WELLNESS</span>LAB</h3>
                  <p style="margin: 0; font-size: 11px; color: #666; line-height: 1.4;">
                    Dubai, United Arab Emirates<br>
                    <a href="mailto:support@thewellnesslab.ae" style="color: #666; text-decoration: none;">support@thewellnesslab.ae</a>
                  </p>
                </td>
              </tr>
            </table>

            <div class="dotted-divider"></div>

            <table class="items-list" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 5px;">
              ${order.items.map((item: any) => `
                <tr class="item-row">
                  <td width="55" valign="top" style="padding: 12px 12px 12px 0;">
                    ${item.product && item.product.image ? `<img src="${item.product.image}" alt="${item.product.name}" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #eaeaea;">` : `<div style="width: 48px; height: 48px; background-color: #f0f0f0; border-radius: 6px; display: inline-block;"></div>`}
                  </td>
                  <td valign="middle" style="padding: 12px 0;">
                    <div style="font-weight: 600; color: #111; font-size: 14px; margin-bottom: 4px; line-height: 1.3;">${item.product ? item.product.name : 'Product'}</div>
                    <div style="color: #666; font-size: 12px;">Qty: ${item.quantity} <span style="margin: 0 4px; color: #ccc;">•</span> AED ${(item.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each</div>
                  </td>
                  <td align="right" valign="middle" style="padding: 12px 0; font-weight: 600; color: #111; font-size: 14px;">
                    AED ${(item.price * item.quantity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              `).join('')}
            </table>
            
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 14px; color: #333; margin: 15px 0 5px;">
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px;">Subtotal</td>
                <td align="right" style="padding: 6px 0; font-weight: 500; font-size: 13px;">AED ${(order.subtotal || order.totalPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ${order.shippingCharge > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 13px;">Shipping Charge</td>
                <td align="right" style="padding: 6px 0; font-weight: 500; font-size: 13px;">AED ${order.shippingCharge.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ` : ''}
              ${order.discount > 0 ? `
              <tr>
                <td style="padding: 6px 0; color: #16a34a; font-size: 13px;">Discount ${order.couponCode ? '(' + order.couponCode + ')' : ''}</td>
                <td align="right" style="padding: 6px 0; font-weight: 500; color: #16a34a; font-size: 13px;">-AED ${order.discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
              ` : ''}
            </table>

            <div class="total-paid">
              Total amount - AED ${(order.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>

            <div class="disclaimer">
              thewellnesslab employees or representatives will NEVER ask you for your personal information i.e. your bank account details, passwords, PIN, CVV, OTP etc. For your own safety, DO NOT share these details with anyone over phone, SMS or email.
            </div>

            <!-- Quiz Banner Section -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6; color: #111111; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e5e7eb;">
              <tr>
                <td style="padding: 24px;">
                  <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 800; text-transform: uppercase;">For your second order</h4>
                  <p style="margin: 0; font-size: 12px; color: #4b5563;">Take a quick quiz on what suits your needs.</p>
                </td>
                <td align="right" style="padding: 24px;">
                  <a href="https://thewellnesslab.ae/quiz" style="background-color: #111111; color: #ffffff; padding: 12px 18px; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; display: inline-block;">Find Your Panel</a>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #6d28d9; color: white; border-radius: 8px; margin-bottom: 30px;">
              <tr>
                <td style="padding: 25px 24px;">
                  <h4 style="margin: 0 0 6px; font-size: 15px; font-weight: 800; font-style: italic; text-transform: uppercase;">Discover Wellness</h4>
                  <p style="margin: 0; font-size: 11px; opacity: 0.9;">Explore our latest premium collections.</p>
                </td>
                <td align="right" style="padding: 25px 24px;">
                  <a href="https://thewellnesslab.ae" style="background-color: #fff; color: #6d28d9; padding: 10px 16px; border-radius: 4px; font-size: 11px; font-weight: 700; text-decoration: none; display: inline-block;">SHOP NOW</a>
                </td>
              </tr>
            </table>

            <div class="footer">
              © ${new Date().getFullYear()} - <strong>thewellnesslab</strong>. All rights reserved.
            United Arab Emirates
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Order confirmation email sent to:', email);
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
  }
};

export const sendLeadNotificationEmail = async (lead: any) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "lead_notification_config" },
    });

    if (!setting || !setting.value) {
      console.log("No lead notification configuration found.");
      return;
    }

    let config: { enabled: boolean; recipientEmails: string; emailSubject?: string } = { enabled: false, recipientEmails: "", emailSubject: "" };
    try {
      config = JSON.parse(setting.value);
    } catch (e) {
      console.error("Failed to parse lead_notification_config setting:", e);
      return;
    }

    if (!config.enabled || !config.recipientEmails) {
      console.log("Lead email notifications are disabled or no recipient emails specified.");
      return;
    }

    const recipients = config.recipientEmails
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes("@"));

    if (recipients.length === 0) {
      console.log("No valid email recipients found in lead notification config.");
      return;
    }

    const defaultSubject = `🚨 New Lead Received: ${lead.name || "Form Submission"} (${lead.source || "Website"})`;
    const finalSubject = config.emailSubject && config.emailSubject.trim() !== ""
      ? config.emailSubject
          .replace(/{{name}}/g, lead.name || "Form Submission")
          .replace(/{{source}}/g, lead.source || "Website")
          .replace(/{{email}}/g, lead.email || "")
          .replace(/{{phone}}/g, lead.phone || "")
          .replace(/{{city}}/g, lead.city || "")
      : defaultSubject;

    // Format dynamic fields into clean HTML table rows if present
    let dynamicFieldsHtml = "";
    if (lead.dynamicFields && typeof lead.dynamicFields === "object" && Object.keys(lead.dynamicFields).length > 0) {
      const rows = Object.entries(lead.dynamicFields)
        .map(
          ([key, val]) => `
          <tr>
            <td style="padding: 8px 12px; font-weight: 600; color: #4b5563; border-bottom: 1px solid #f3f4f6; width: 40%; font-size: 13px;">${key}</td>
            <td style="padding: 8px 12px; color: #111827; border-bottom: 1px solid #f3f4f6; font-size: 13px;">${String(val)}</td>
          </tr>
        `
        )
        .join("");

      dynamicFieldsHtml = `
        <div style="margin-top: 24px;">
          <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Additional Form Details / Answers</div>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background-color: #f9fafb; border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb;">
            ${rows}
          </table>
        </div>
      `;
    }

    const mailOptions = {
      from: `"THE WELLNESS LAB Notifications" <${process.env.EMAIL_USER}>`,
      to: recipients.join(", "),
      subject: finalSubject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f3f4f6; -webkit-font-smoothing: antialiased; }
            .wrapper { padding: 30px 15px; background-color: #f3f4f6; width: 100%; box-sizing: border-box; }
            .main { background-color: #ffffff; margin: 0 auto; width: 100%; max-width: 560px; padding: 32px; border-radius: 12px; box-sizing: border-box; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .brand-logo { font-size: 22px; font-weight: 800; color: #111; letter-spacing: -0.5px; margin-bottom: 20px; }
            .header-badge { display: inline-block; background-color: #dc2626; color: #ffffff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
            .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 16px; }
            .info-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            .info-table td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
            .info-label { font-weight: 600; color: #4b5563; width: 35%; }
            .info-val { color: #111827; font-weight: 500; }
            .footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 28px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="main">
              <div class="brand-logo">THE<span style="color: #e63946; font-weight: 800;">WELLNESS</span>LAB</div>
              <div class="header-badge">Instant Lead Alert</div>
              <h2 class="title">New Lead Submission</h2>
              <p style="font-size: 14px; color: #4b5563; margin-top: 0;">A new lead has submitted their details via the <strong>${lead.source || "Website"}</strong> form.</p>
              
              <table class="info-table">
                <tr>
                  <td class="info-label">Full Name</td>
                  <td class="info-val">${lead.name || "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Email</td>
                  <td class="info-val">${lead.email ? `<a href="mailto:${lead.email}" style="color: #2563eb; text-decoration: none;">${lead.email}</a>` : "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Phone</td>
                  <td class="info-val">${lead.phone ? `<a href="tel:${lead.phone}" style="color: #2563eb; text-decoration: none;">${lead.phone}</a>` : "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">City / Location</td>
                  <td class="info-val">${lead.city || "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Company</td>
                  <td class="info-val">${lead.company || "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Job Title</td>
                  <td class="info-val">${lead.jobTitle || "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Lead Source</td>
                  <td class="info-val"><span style="background-color: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">${lead.source || "Website"}</span></td>
                </tr>
                <tr>
                  <td class="info-label">Status</td>
                  <td class="info-val">${lead.status || "NEW"}</td>
                </tr>
                <tr>
                  <td class="info-label">Received At</td>
                  <td class="info-val">${new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })} (GST)</td>
                </tr>
              </table>

              ${dynamicFieldsHtml}

              <div style="margin-top: 28px; text-align: center;">
                <a href="https://thewellnesslab.ae/admin/leads" style="background-color: #111827; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">View in Admin Portal →</a>
              </div>

              <div class="footer">
                Automated Lead Notification System — THE WELLNESS LAB<br>
                This notification was sent based on your Lead Notification settings.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Lead notification email successfully sent to: ${recipients.join(", ")}`);
  } catch (error) {
    console.error("Error sending lead notification email:", error);
  }
};

export const sendOrderNotificationEmail = async (order: any) => {
  try {
    let setting = await prisma.setting.findUnique({
      where: { key: "order_notification_config" },
    });

    if (!setting || !setting.value) {
      // Fallback to lead_notification_config if order_notification_config is not configured yet
      setting = await prisma.setting.findUnique({
        where: { key: "lead_notification_config" },
      });
    }

    if (!setting || !setting.value) {
      console.log("No order or lead notification configuration found.");
      return;
    }

    let config: { enabled: boolean; recipientEmails: string; emailSubject?: string } = { enabled: false, recipientEmails: "", emailSubject: "" };
    try {
      config = JSON.parse(setting.value);
    } catch (e) {
      console.error("Failed to parse notification config for order:", e);
      return;
    }

    if (!config.enabled || !config.recipientEmails) {
      console.log("Order email notifications are disabled or no recipient emails specified.");
      return;
    }

    const recipients = config.recipientEmails
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes("@"));

    if (recipients.length === 0) {
      console.log("No valid email recipients found in order notification config.");
      return;
    }

    const shortId = (order.id || "").slice(-6).toUpperCase();
    const customerName = order.guestName || (order.user ? order.user.name : "Customer");
    const customerEmail = order.guestEmail || order.userEmail || (order.user ? order.user.email : "N/A");
    const customerPhone = order.guestPhone || (order.user ? order.user.phone : "N/A");
    const totalPriceFormatted = `AED ${(order.totalPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const defaultSubject = `🚨 New Order Received: #${shortId} (${customerName} - ${totalPriceFormatted})`;
    const finalSubject = config.emailSubject && config.emailSubject.trim() !== ""
      ? config.emailSubject
          .replace(/{{orderId}}/g, shortId)
          .replace(/{{customerName}}/g, customerName)
          .replace(/{{totalPrice}}/g, totalPriceFormatted)
          .replace(/{{email}}/g, customerEmail)
          .replace(/{{phone}}/g, customerPhone)
          .replace(/{{paymentMethod}}/g, (order.paymentMethod || "cod").toUpperCase())
      : defaultSubject;

    // Items list HTML
    const itemsHtml = order.items && Array.isArray(order.items)
      ? order.items.map((item: any) => `
          <tr>
            <td style="padding: 8px 12px; font-weight: 600; color: #111827; border-bottom: 1px solid #f3f4f6; font-size: 13px;">
              ${item.product?.name || 'Product'}
            </td>
            <td style="padding: 8px 12px; color: #4b5563; border-bottom: 1px solid #f3f4f6; font-size: 13px; text-align: center;">
              x${item.quantity}
            </td>
            <td style="padding: 8px 12px; color: #111827; border-bottom: 1px solid #f3f4f6; font-size: 13px; text-align: right; font-weight: 600;">
              AED ${((item.price || 0) * (item.quantity || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" style="padding: 8px 12px; color: #6b7280; font-size: 13px;">No item details available</td></tr>';

    const mailOptions = {
      from: `"THE WELLNESS LAB Notifications" <${process.env.EMAIL_USER}>`,
      to: recipients.join(", "),
      subject: finalSubject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f3f4f6; -webkit-font-smoothing: antialiased; }
            .wrapper { padding: 30px 15px; background-color: #f3f4f6; width: 100%; box-sizing: border-box; }
            .main { background-color: #ffffff; margin: 0 auto; width: 100%; max-width: 560px; padding: 32px; border-radius: 12px; box-sizing: border-box; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .brand-logo { font-size: 22px; font-weight: 800; color: #111; letter-spacing: -0.5px; margin-bottom: 20px; }
            .header-badge { display: inline-block; background-color: #059669; color: #ffffff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
            .title { font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 16px; }
            .info-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            .info-table td { padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
            .info-label { font-weight: 600; color: #4b5563; width: 35%; }
            .info-val { color: #111827; font-weight: 500; }
            .footer { text-align: center; font-size: 11px; color: #9ca3af; margin-top: 28px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="wrapper">
            <div class="main">
              <div class="brand-logo">THE<span style="color: #e63946; font-weight: 800;">WELLNESS</span>LAB</div>
              <div class="header-badge">Instant Order Alert</div>
              <h2 class="title">New Order Received (#${shortId})</h2>
              <p style="font-size: 14px; color: #4b5563; margin-top: 0;">A new order has been placed on the website.</p>
              
              <table class="info-table">
                <tr>
                  <td class="info-label">Order ID</td>
                  <td class="info-val"><strong>#${shortId}</strong> (${order.id})</td>
                </tr>
                <tr>
                  <td class="info-label">Customer Name</td>
                  <td class="info-val">${customerName}</td>
                </tr>
                <tr>
                  <td class="info-label">Email</td>
                  <td class="info-val">${customerEmail !== "N/A" ? `<a href="mailto:${customerEmail}" style="color: #2563eb; text-decoration: none;">${customerEmail}</a>` : "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Phone</td>
                  <td class="info-val">${customerPhone !== "N/A" ? `<a href="tel:${customerPhone}" style="color: #2563eb; text-decoration: none;">${customerPhone}</a>` : "N/A"}</td>
                </tr>
                <tr>
                  <td class="info-label">Delivery Address</td>
                  <td class="info-val">${order.address || "N/A"}${order.city ? `, ${order.city}` : ""}${order.pincode ? `, ${order.pincode}` : ""}</td>
                </tr>
                <tr>
                  <td class="info-label">Payment Method</td>
                  <td class="info-val"><span style="background-color: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">${order.paymentMethod || "COD"}</span></td>
                </tr>
                <tr>
                  <td class="info-label">Payment Status</td>
                  <td class="info-val">${order.paymentStatus === 'paid' ? '<span style="color: #16a34a; font-weight: 700;">PAID</span>' : '<span style="color: #d97706; font-weight: 600;">PENDING</span>'}</td>
                </tr>
                <tr>
                  <td class="info-label">Order Status</td>
                  <td class="info-val"><strong>${order.status || "PENDING"}</strong></td>
                </tr>
                <tr>
                  <td class="info-label">Total Amount</td>
                  <td class="info-val" style="font-size: 16px; font-weight: 800; color: #111827;">${totalPriceFormatted}</td>
                </tr>
                <tr>
                  <td class="info-label">Placed At</td>
                  <td class="info-val">${new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" })} (GST)</td>
                </tr>
              </table>

              <div style="margin-top: 24px;">
                <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Order Items</div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; background-color: #f9fafb; border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb;">
                  <thead>
                    <tr style="background-color: #f3f4f6;">
                      <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #4b5563;">Item</th>
                      <th style="padding: 8px 12px; text-align: center; font-size: 12px; color: #4b5563;">Qty</th>
                      <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #4b5563;">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHtml}
                  </tbody>
                </table>
              </div>

              <div style="margin-top: 28px; text-align: center;">
                <a href="https://thewellnesslab.ae/admin/orders" style="background-color: #111827; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 13px; font-weight: 600; display: inline-block;">View Order in Admin Portal →</a>
              </div>

              <div class="footer">
                Automated Order Notification System — THE WELLNESS LAB<br>
                This notification was sent based on your Order Notification settings.
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Order notification email successfully sent to: ${recipients.join(", ")}`);
  } catch (error) {
    console.error("Error sending order notification email:", error);
  }
};

