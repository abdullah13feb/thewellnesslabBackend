import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAdminOrApiKey, requireAuthOrApiKey } from "../middleware/auth.js";
import { sendLeadNotificationEmail } from "../lib/email.js";
import { sendLeadNotificationWhatsapp } from "../lib/whatsappNotify.js";
import { sanitizeNotifyButtons, specsToButtons } from "../lib/whatsappNotify.js";
import { normalizeDeviceId, sendWhatsappInteractive, sendWhatsappMessage } from "../lib/whatsappGateway.js";
import { phoneIntl } from "../lib/alertEmails.js";
import { QUIZ_FIELDS, attachQuizPurchases, buildQuizFields } from "../lib/quizLead.js";
import { ipFields } from "../lib/ipLocation.js";
import { trackingFields } from "../lib/leadTracking.js";
import { sendWebsiteLead } from "../lib/metaLeads.js";
import { WA_PHONE_KEY } from "../lib/whatsappLead.js";
import { getCtwaAds } from "../lib/ctwaAds.js";
import {
  PASSPORT_GOALS,
  PASSPORT_OFFER,
  PASSPORT_SOURCE,
  PASSPORT_STATIONS,
  PASSPORT_VALID_UNTIL,
  PASSPORT_VALID_UNTIL_LABEL,
  PassportGoal,
  isPassportGoal,
  newPassportCode,
  panelForGoal,
  passportCodeUsed,
  passportCouponDescription,
} from "../lib/passport.js";
import { ctwaBackendService } from "../services/ctwaService.js";

const router = Router();

// --- Notification Config Routes ---

// Get lead email notification configuration
router.get("/notification-config", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: "lead_notification_config" },
    });

    let config = { enabled: false, recipientEmails: "", emailSubject: "" };
    if (setting?.value) {
      try {
        config = JSON.parse(setting.value);
      } catch (e) {
        console.error("Error parsing lead notification config:", e);
      }
    }

    res.json({ success: true, data: config });
  } catch (error) {
    console.error("Error fetching notification config:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update lead email notification configuration
router.post("/notification-config", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { enabled, recipientEmails, emailSubject, whatsappEnabled, whatsappNumbers, whatsappDeviceId, whatsappMessage, whatsappCallButton, whatsappLinkButton, whatsappButtons } = req.body;
    const configValue = JSON.stringify({
      enabled: Boolean(enabled),
      recipientEmails: String(recipientEmails || "").trim(),
      emailSubject: String(emailSubject || "").trim(),
      whatsappEnabled: Boolean(whatsappEnabled),
      whatsappNumbers: String(whatsappNumbers || "").trim(),
      whatsappDeviceId: String(whatsappDeviceId || "Wellnesslab").trim(),
      whatsappMessage: String(whatsappMessage || "").trim(),
      whatsappCallButton: whatsappCallButton !== false,
      whatsappLinkButton: whatsappLinkButton !== false,
      whatsappButtons: sanitizeNotifyButtons(whatsappButtons),
    });

    const setting = await prisma.setting.upsert({
      where: { key: "lead_notification_config" },
      update: { value: configValue },
      create: { key: "lead_notification_config", value: configValue },
    });

    res.json({ success: true, data: JSON.parse(setting.value) });
  } catch (error) {
    console.error("Error updating notification config:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// --- Status Management Routes ---

// Get all lead statuses
router.get("/statuses", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const statuses = await prisma.leadStatus.findMany({
      orderBy: { order: "asc" },
    });
    res.json({ success: true, data: statuses });
  } catch (error) {
    console.error("Error fetching statuses:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Create a new status
router.post("/statuses", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { label, value, color, order } = req.body;
    if (!label || !value) {
      return res.status(400).json({ success: false, error: "Label and value are required" });
    }
    const status = await prisma.leadStatus.create({
      data: { label, value, color, order: order || 0 },
    });
    res.status(201).json({ success: true, data: status });
  } catch (error) {
    console.error("Error creating status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update a status
router.patch("/statuses/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, value, color, order } = req.body;
    const status = await prisma.leadStatus.update({
      where: { id },
      data: { label, value, color, order },
    });
    res.json({ success: true, data: status });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete a status
router.delete("/statuses/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.leadStatus.delete({
      where: { id },
    });
    res.json({ success: true, message: "Status deleted successfully" });
  } catch (error) {
    console.error("Error deleting status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// --- Lead Management Routes ---

// Create a lead publicly (e.g., from Quiz)
router.post("/public", async (req, res) => {
  try {
    const { name, phone, email, source, city, quiz, utmCampaign, meta } = req.body;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

    if (!str(name, 120)) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }

    const extraFields = { ...(buildQuizFields(quiz) || {}), ...(await ipFields(req)), ...trackingFields(req, utmCampaign) };

    const lead = await prisma.lead.create({
      data: {
        name: str(name, 120)!,
        phone: str(phone, 40),
        email: str(email, 200),
        source: str(source, 60) || "Quiz",
        city: str(city, 120),
        status: "NEW",
        ...(Object.keys(extraFields).length ? { dynamicFields: extraFields } : {}),
      },
    });

    // Send email notification safely (awaited for AWS Lambda serverless execution)
    try {
      await sendLeadNotificationEmail(lead);
    } catch (err) {
      console.error("Failed to send lead notification email for public lead:", err);
    }
    await sendLeadNotificationWhatsapp(lead);

    // Server copy of the browser pixel Lead (same event id, so Meta counts it once). Quiz test pages are skipped.
    if (!quiz?.test) {
      const m = meta && typeof meta === "object" ? meta : {};
      await sendWebsiteLead(req, lead, {
        eventId: m.eventId || quiz?.event_id,
        fbp: m.fbp,
        fbc: m.fbc,
        page: m.page || quiz?.page,
      });
    }

    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error("Error creating public lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Recovery Passport quiz (/recovery-passport): saves the lead with source "quiz map" and gives the person
// their own single-use coupon for the panel the quiz recommended. The same person (email or phone) taking
// the quiz again keeps their code, moved to their latest result, so a retake never makes a second coupon.
router.post("/passport", async (req, res) => {
  try {
    const { name, phone, email, gender, goal, station, test, page, utmCampaign, meta } = req.body || {};
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

    const fullName = str(name, 120);
    const phoneClean = str(phone, 40).replace(/[^\d+]/g, "");
    const phoneDigits = phoneClean.replace(/\D/g, "");
    const emailClean = str(email, 200).toLowerCase();
    const genderLabel = ({ f: "Female", m: "Male" } as Record<string, string>)[String(gender)] || "";

    const errors: Record<string, string> = {};
    if (fullName.length < 2) errors.name = "Please enter your name.";
    if (phoneDigits.length < 10 || phoneDigits.length > 15) errors.phone = "Please enter a valid WhatsApp number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailClean)) errors.email = "Please enter a valid email.";
    if (!genderLabel) errors.gender = "Please choose one.";
    if (!isPassportGoal(goal)) errors.goal = "Please choose a goal.";
    if (Object.keys(errors).length) {
      return res.status(400).json({ success: false, error: "Please check your details.", fields: errors });
    }

    const g = goal as PassportGoal;
    const panel = panelForGoal(g);
    const persona = PASSPORT_GOALS[g].persona;
    const isTest = test === true;
    const now = new Date();

    const fields: Record<string, string> = {
      "Passport Code": "",
      "Quiz Goal": g.charAt(0).toUpperCase() + g.slice(1),
      "Quiz Persona": persona,
      [QUIZ_FIELDS.suggested]: panel.name,
      "Recommended Panel": `${panel.name} ${panel.size}`,
      "Station": PASSPORT_STATIONS[String(station)] || "",
      "Gender": genderLabel,
      "Offer": `AED ${PASSPORT_OFFER.toLocaleString("en-US")} off ${panel.name}, plus a free REX MINI`,
      "Offer Valid Until": PASSPORT_VALID_UNTIL_LABEL,
      "Quiz Status": "Completed",
      "Quiz Completed At": now.toISOString(),
      ...(str(page, 500) ? { [QUIZ_FIELDS.page]: str(page, 500) } : {}),
      ...(isTest ? { "Test Submission": "Yes (staging)" } : {}),
    };

    // A retake by the same person keeps their code (unless they've already used it).
    const previous = await prisma.lead.findMany({
      where: { source: PASSPORT_SOURCE, OR: [{ email: emailClean }, { phone: phoneClean }] },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    let code = "";
    let leadId = "";
    for (const p of previous) {
      const c = String((p.dynamicFields as any)?.["Passport Code"] || "");
      if (c && !(await passportCodeUsed(c)) && (await prisma.coupon.findUnique({ where: { code: c } }))) {
        code = c;
        leadId = p.id;
        break;
      }
    }

    const extra = { ...(await ipFields(req)), ...trackingFields(req, utmCampaign) };
    let lead;
    if (code) {
      fields["Passport Code"] = code;
      const prev = previous.find((p) => p.id === leadId)!;
      const prevFields = (prev.dynamicFields && typeof prev.dynamicFields === "object" ? prev.dynamicFields : {}) as Record<string, unknown>;
      [, lead] = await prisma.$transaction([
        prisma.coupon.update({
          where: { code },
          data: {
            applicableProducts: [panel.slug],
            description: passportCouponDescription(panel.name),
            isActive: true,
          },
        }),
        prisma.lead.update({
          where: { id: leadId },
          data: {
            name: fullName,
            phone: phoneClean,
            email: emailClean,
            dynamicFields: { ...prevFields, ...extra, ...fields, "Quiz Retakes": String(Number(prevFields["Quiz Retakes"] || 0) + 1) },
          },
        }),
      ]);
    } else {
      code = await newPassportCode();
      fields["Passport Code"] = code;
      [, lead] = await prisma.$transaction([
        prisma.coupon.create({
          data: {
            code,
            discount: PASSPORT_OFFER,
            type: "FIXED",
            description: passportCouponDescription(panel.name),
            expiry: PASSPORT_VALID_UNTIL,
            minPurchase: 0,
            applicableProducts: [panel.slug],
          },
        }),
        prisma.lead.create({
          data: {
            name: fullName,
            phone: phoneClean,
            email: emailClean,
            source: PASSPORT_SOURCE,
            status: "NEW",
            dynamicFields: { ...extra, ...fields },
          },
        }),
      ]);

      // Notify the team only for a new person, not for a retake.
      try {
        await sendLeadNotificationEmail(lead);
      } catch (err) {
        console.error("Failed to send lead notification email for passport lead:", err);
      }
      await sendLeadNotificationWhatsapp(lead);
      if (!isTest) {
        const m = meta && typeof meta === "object" ? meta : {};
        await sendWebsiteLead(req, lead, { eventId: m.eventId, fbp: m.fbp, fbc: m.fbc, page: m.page || str(page, 500) });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        code,
        leadId: lead.id,
        panel: { slug: panel.slug, name: panel.name, size: panel.size },
        persona,
        offer: PASSPORT_OFFER,
        validUntil: PASSPORT_VALID_UNTIL.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error creating passport lead:", error);
    res.status(500).json({ success: false, error: "We couldn't save your passport. Please try again." });
  }
});

// Create a lead - Protected by API key (X-API-KEY) or Admin
router.post("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { name, phone, email, source, status, company, jobTitle, city, dynamicFields } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }

    const lead = await prisma.lead.create({
      data: {
        name,
        phone,
        email,
        source,
        status: status || "NEW",
        company,
        jobTitle,
        city,
        dynamicFields: dynamicFields || {},
      },
    });

    // Send email notification safely (awaited for AWS Lambda serverless execution)
    try {
      await sendLeadNotificationEmail(lead);
    } catch (err) {
      console.error("Failed to send lead notification email for admin lead:", err);
    }
    await sendLeadNotificationWhatsapp(lead);

    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get all leads - Protected by Admin
router.get("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { phone, email } = req.query;
    const where: any = {};
    
    if (phone) {
      where.phone = phone as string;
    }
    if (email) {
      where.email = email as string;
    }
    // Live polling: only leads created or changed after this time.
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    if (since && !isNaN(since.getTime())) {
      where.updatedAt = { gt: since };
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    let data: any[] = leads;
    try {
      data = await attachQuizPurchases(leads);
    } catch (err) {
      console.error("Failed to match quiz leads to orders:", err);
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Meta ad details (name, campaign, ad set, status, text, banner) for Click-to-WhatsApp ad ids: ?ids=1,2&refresh=1
router.get("/ctwa-ads", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const ids = String(req.query.ids || "").split(",").filter(Boolean).slice(0, 100);
    const data = await getCtwaAds(ids, { refresh: req.query.refresh === "1" });
    res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching CTWA ads:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// WhatsApp conversation of a WhatsApp lead (newest last). Empty for website leads.
router.get("/:id/messages", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead not found" });
    }
    const phone = (lead.dynamicFields as any)?.[WA_PHONE_KEY];
    if (!phone) {
      return res.json({ success: true, data: [] });
    }
    const take = Math.min(Number(req.query.limit) || 100, 500);
    const [messages, contact] = await Promise.all([
      prisma.wellnessLabMessageLog.findMany({
        where: { phoneNumber: String(phone) },
        orderBy: { createdAt: "desc" },
        take,
        select: { id: true, direction: true, messageContent: true, mediaUrl: true, mediaType: true, status: true, createdAt: true },
      }),
      prisma.wellnessLabContact.findUnique({
        where: { phoneNumber: String(phone) },
        select: { customerName: true, leadStatus: true, tags: true, notes: true, dealValue: true, adId: true, ctwaClickedAt: true },
      }),
    ]);
    res.json({ success: true, data: messages.reverse(), contact });
  } catch (error) {
    console.error("Error fetching lead messages:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Send a WhatsApp follow-up to a lead from the Wellness Lab device. With buttons it goes as an interactive
// message (tappable buttons); if that fails, or without buttons, as a normal text message. {{name}}, {{phone}},
// {{email}} and {{city}} in the message or button values are filled from the lead. Logged in the chat history.
router.post("/:id/send-message", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });

    const waPhone = (lead.dynamicFields as any)?.[WA_PHONE_KEY];
    const to = phoneIntl(waPhone || lead.phone);
    if (to.length < 8) return res.status(400).json({ success: false, error: "This lead has no valid phone number" });

    const values: Record<string, string> = {
      name: String(lead.name || "").trim(),
      phone: `+${to}`,
      email: String(lead.email || ""),
      city: String(lead.city || ""),
    };
    const fill = (s: string) => s.replace(/{{\s*(\w+)\s*}}/g, (m, k) => (k in values ? values[k] : m));
    const message = fill(String(req.body?.message || "")).trim();
    if (!message) return res.status(400).json({ success: false, error: "Message is required" });
    if (Buffer.byteLength(message, "utf8") > 4096) return res.status(400).json({ success: false, error: "Message is too long (max 4096 bytes)" });
    const footer = String(req.body?.footer || "").trim() || undefined;
    const buttons = specsToButtons(sanitizeNotifyButtons(req.body?.buttons) || [], values);

    let sentAs: "interactive" | "text" = "text";
    let result: { success: boolean; error?: string } = { success: false };
    let interactiveError: string | undefined;
    if (buttons.length) {
      result = await sendWhatsappInteractive(to, message, buttons, undefined, footer);
      if (result.success) sentAs = "interactive";
      else interactiveError = result.error;
    }
    if (!result.success) result = await sendWhatsappMessage("default", to, footer ? `${message}\n\n${footer}` : message);

    const shown = sentAs === "interactive" ? `${message}${footer ? `\n\n${footer}` : ""}\n\n${buttons.map((b) => `[${b.params.display_text}]`).join(" ")}` : message;
    const log = await prisma.wellnessLabMessageLog.create({
      data: {
        timestamp: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }),
        phoneNumber: waPhone ? String(waPhone) : to,
        customerName: values.name || "WhatsApp Customer",
        direction: "Outgoing",
        messageContent: shown,
        status: result.success ? "Sent" : "Failed",
        deviceId: normalizeDeviceId(),
      },
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: `WhatsApp send failed: ${result.error || interactiveError || "unknown error"}` });
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { whatsappSent: true, whatsappSentAt: new Date() } });
    res.json({
      success: true,
      data: { sentAs, to, logId: log.id, ...(interactiveError ? { note: "Buttons could not be sent, so it went as a normal text message." } : {}) },
    });
  } catch (error) {
    console.error("Error sending lead message:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get lead by ID - Protected by Admin
router.get("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead not found" });
    }

    let data: any = lead;
    try {
      [data] = await attachQuizPurchases([lead]);
    } catch (err) {
      console.error("Failed to match quiz lead to orders:", err);
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error("Error fetching lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update lead status or details
router.patch("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, name, phone, email, source, company, jobTitle, city, whatsappSent, emailSent, whatsappSentAt, emailSentAt, notes, dealValue } = req.body;
    let { dynamicFields } = req.body;

    // notes / dealValue are merged into dynamicFields (the Lead table has no columns for them).
    if (notes !== undefined || dealValue !== undefined) {
      const current = await prisma.lead.findUnique({ where: { id }, select: { dynamicFields: true } });
      const merged: Record<string, any> = { ...((current?.dynamicFields as any) || {}), ...(dynamicFields || {}) };
      if (notes !== undefined) merged["Notes"] = String(notes ?? "").slice(0, 5000);
      if (dealValue !== undefined) {
        const v = Number(dealValue);
        if (v > 0) merged["Deal Value (AED)"] = v;
        else delete merged["Deal Value (AED)"];
      }
      dynamicFields = merged;
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        status,
        name,
        phone,
        email,
        source,
        company,
        jobTitle,
        city,
        dynamicFields,
        whatsappSent,
        emailSent,
        whatsappSentAt: whatsappSentAt ? new Date(whatsappSentAt) : undefined,
        emailSentAt: emailSentAt ? new Date(emailSentAt) : undefined,
      },
    });

    // WhatsApp lead: mirror status / name / deal value / notes onto the WhatsApp contact, which also sends
    // the Meta Purchase when the lead is Won with a deal value.
    const waPhone = (lead.dynamicFields as any)?.[WA_PHONE_KEY];
    if (waPhone && (status !== undefined || name !== undefined || dealValue !== undefined || notes !== undefined)) {
      await ctwaBackendService.updateWellnessContact(String(waPhone), {
        leadStatus: status,
        customerName: name,
        notes,
        dealValue: dealValue === undefined ? undefined : Number(dealValue) > 0 ? Number(dealValue) : null,
      });
    }

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete lead
router.delete("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.lead.delete({
      where: { id },
    });

    res.json({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
