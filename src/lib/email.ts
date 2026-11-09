import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import prisma from './prisma.js';
import { suggestedProductOf } from './quizLead.js';
import { leadAlertHtml, orderAlertHtml, orderRef } from './alertEmails.js';
import { lookupIp } from './ipLocation.js';
import { orderConfirmationHtml, orderConfirmationSubject } from './orderConfirmationEmail.js';

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
    subject: orderConfirmationSubject(order),
    html: orderConfirmationHtml(order),
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

    const suggestedProduct = suggestedProductOf(lead);
    const defaultSubject = `🚨 New Lead Received: ${lead.name || "Form Submission"} (${lead.source || "Website"})${suggestedProduct ? ` - Suggested: ${suggestedProduct}` : ""}`;
    const finalSubject = config.emailSubject && config.emailSubject.trim() !== ""
      ? config.emailSubject
          .replace(/{{name}}/g, lead.name || "Form Submission")
          .replace(/{{source}}/g, lead.source || "Website")
          .replace(/{{email}}/g, lead.email || "")
          .replace(/{{phone}}/g, lead.phone || "")
          .replace(/{{city}}/g, lead.city || "")
          .replace(/{{product}}/g, suggestedProduct)
      : defaultSubject;

    const mailOptions = {
      from: `"THE WELLNESS LAB Notifications" <${process.env.EMAIL_USER}>`,
      to: recipients.join(", "),
      subject: finalSubject,
      html: leadAlertHtml(lead),
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

    const shortId = orderRef(order);
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

    const mailOptions = {
      from: `"THE WELLNESS LAB Notifications" <${process.env.EMAIL_USER}>`,
      to: recipients.join(", "),
      subject: finalSubject,
      html: orderAlertHtml(order, order.clientIp ? await lookupIp(String(order.clientIp)) : {}),
    };

    await transporter.sendMail(mailOptions);
    console.log(`Order notification email successfully sent to: ${recipients.join(", ")}`);
  } catch (error) {
    console.error("Error sending order notification email:", error);
  }
};

