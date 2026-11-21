import { Router } from "express";
import prisma from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { requireAdminOrApiKey, requireAuthOrApiKey } from "../middleware/auth.js";
import {
  getSessionStatus,
  getSessionQR,
  startSession,
  stopSession,
  sendWhatsappMessage,
  normalizePhoneNumber,
  cancelBatch
} from "../lib/whatsappGateway.js";
import { MIN_GAP_MS, spacedSendTimes } from "../lib/broadcastDispatch.js";
import { WA_PHONE_KEY } from "../lib/whatsappLead.js";
import { sanitizeNotifyButtons } from "../lib/whatsappNotify.js";

const router = Router();

// Protect all routes with auth/api-key and admin role
router.use(requireAuthOrApiKey);
router.use(requireAdminOrApiKey);

// =========================================================================
// 1. GATEWAY CONTROLS
// =========================================================================

// Check gateway connection status
router.get("/gateway/status", async (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  try {
    const status = await getSessionStatus(sessionId);
    res.json({ success: true, status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Failed to query status" });
  }
});

// Fetch authentication QR Code
router.get("/gateway/qr", async (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  try {
    const qrData = await getSessionQR(sessionId);
    if (!qrData) {
      return res.status(404).json({ success: false, error: "QR code not available yet. Make sure session is starting." });
    }
    res.json({ success: true, qr: qrData.qr });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start a WhatsApp gateway session
router.post("/gateway/session/start", async (req, res) => {
  const { sessionId } = req.body;
  const finalSessionId = sessionId || "default";
  try {
    const ok = await startSession(finalSessionId);
    if (ok) {
      res.json({ success: true, message: `Session ${finalSessionId} start requested successfully` });
    } else {
      res.status(400).json({ success: false, error: "Failed to initialize start call on gateway" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop a WhatsApp gateway session
router.post("/gateway/session/stop", async (req, res) => {
  const { sessionId } = req.body;
  const finalSessionId = sessionId || "default";
  try {
    const ok = await stopSession(finalSessionId);
    if (ok) {
      res.json({ success: true, message: `Session ${finalSessionId} disconnect requested` });
    } else {
      res.status(400).json({ success: false, error: "Failed to request session stop" });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send a test message
router.post("/gateway/test-send", async (req, res) => {
  const { phone, text, sessionId } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ success: false, error: "Phone number and text body are required" });
  }
  
  try {
    const success = await sendWhatsappMessage(sessionId || "default", phone, text);
    if (success) {
      res.json({ success: true, message: "Test message sent successfully" });
    } else {
      res.status(400).json({ success: false, error: "Gateway rejected test message. Check session state." });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =========================================================================
// 2. TEMPLATE CONTROLS
// =========================================================================

// List templates
router.get("/templates", async (req, res) => {
  try {
    const templates = await prisma.whatsappTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create template
router.post("/templates", async (req, res) => {
  const { name, body, variables, type, mediaUrl } = req.body;
  if (!name || !body) {
    return res.status(400).json({ success: false, error: "Name and message body are required" });
  }
  const extra = interactiveFields(req.body, type);
  if ("error" in extra) return res.status(400).json({ success: false, error: extra.error });

  try {
    const template = await prisma.whatsappTemplate.create({
      data: {
        name,
        body,
        variables: variables || [],
        type: type || "TEXT",
        mediaUrl: mediaUrl || null,
        ...templateButtonData(extra),
      },
    });
    res.status(201).json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update template
router.put("/templates/:id", async (req, res) => {
  const { id } = req.params;
  const { name, body, variables, type, mediaUrl } = req.body;
  const extra = interactiveFields(req.body, type);
  if ("error" in extra) return res.status(400).json({ success: false, error: extra.error });

  try {
    const template = await prisma.whatsappTemplate.update({
      where: { id },
      data: {
        name,
        body,
        variables: variables || [],
        type: type || "TEXT",
        mediaUrl: mediaUrl || null,
        ...templateButtonData(extra),
      },
    });
    res.json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete template
router.delete("/templates/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.whatsappTemplate.delete({
      where: { id },
    });
    res.json({ success: true, message: "Template deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =========================================================================
// 3. CAMPAIGN CONTROLS
// =========================================================================

// List campaigns
router.get("/campaigns", async (req, res) => {
  try {
    const campaigns = await prisma.whatsappCampaign.findMany({
      include: {
        template: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: campaigns });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get campaign detail
router.get("/campaigns/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await prisma.whatsappCampaign.findUnique({
      where: { id },
      include: {
        template: true,
        recipients: {
          orderBy: [{ sendAt: "asc" }, { phone: "asc" }]
        }
      },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaign not found" });
    }

    res.json({ success: true, data: campaign });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create a campaign. Nothing is sent here: the dispatcher (Lambda broadcastTick every minute, or the
// server's scheduler loop) sends each recipient at its sendAt time.
// recipients: [{ phone?, leadId?, name?, variables?, sendAt? }]
//  - leadId: phone and name are taken from the CRM lead (its WhatsApp number first).
//  - sendAt: ISO time for that message. Times must be in order and at least MIN_GAP_MS apart. Recipients
//    without one are spaced from scheduledAt (or now) by delaySeconds / batchSize / batchDelaySeconds.
router.post("/campaigns", async (req, res) => {
  const { name, templateId, customBody, scheduledAt, recipients, sessionId, deviceId, delaySeconds, batchSize, batchDelaySeconds, source, timing } = req.body;
  const extra = interactiveFields(req.body);
  if ("error" in extra) return res.status(400).json({ success: false, error: extra.error });

  if (!name || (!templateId && !customBody)) {
    return res.status(400).json({ success: false, error: "Campaign name and message content (template or custom text) are required" });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ success: false, error: "A list of recipients is required" });
  }
  if (recipients.length > 5000) {
    return res.status(400).json({ success: false, error: "At most 5000 recipients per broadcast" });
  }

  try {
    const template = templateId ? await prisma.whatsappTemplate.findUnique({ where: { id: String(templateId) } }) : null;
    if (templateId && !template) {
      return res.status(400).json({ success: false, error: "Template not found" });
    }
    // Buttons: the ones sent with the campaign, else the template's (copied, so editing the template later
    // does not change a scheduled broadcast). A media template cannot also have buttons.
    const fromTemplate = Array.isArray(template?.buttons) && (template!.buttons as any[]).length ? (template!.buttons as ButtonSpec[]) : null;
    const buttons = extra.buttons !== undefined ? extra.buttons : fromTemplate;
    const footer = extra.buttons !== undefined ? extra.footer ?? null : buttons ? template?.footer ?? null : null;
    if (buttons && template && template.type !== "TEXT" && template.mediaUrl) {
      return res.status(400).json({ success: false, error: "A template with an image, video or document cannot also have buttons" });
    }

    // Resolve lead recipients to their phone and name.
    const leadIds = [...new Set(recipients.map((r: any) => r?.leadId).filter(Boolean).map(String))];
    const leads = leadIds.length
      ? await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true, phone: true, dynamicFields: true } })
      : [];
    const leadById = new Map(leads.map((l) => [l.id, l]));

    const rows: { phone: string; name: string | null; variables: any; leadId: string | null; sendAt: Date | null }[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const r of recipients) {
      const lead = r?.leadId ? leadById.get(String(r.leadId)) : undefined;
      if (r?.leadId && !lead) { skipped.push(`lead ${r.leadId} not found`); continue; }
      const raw = lead ? (lead.dynamicFields as any)?.[WA_PHONE_KEY] || lead.phone : r?.phone;
      const phone = raw ? normalizePhoneNumber(String(raw), false) : "";
      if (phone.length < 8) { skipped.push(`${lead?.name || r?.name || "recipient"}: no valid phone`); continue; }
      if (seen.has(phone)) { skipped.push(`+${phone}: duplicate`); continue; }
      seen.add(phone);
      let sendAt: Date | null = null;
      if (r?.sendAt) {
        sendAt = new Date(r.sendAt);
        if (isNaN(sendAt.getTime())) return res.status(400).json({ success: false, error: `Invalid sendAt for +${phone}` });
      }
      rows.push({ phone, name: (r?.name || lead?.name || null) && String(r?.name || lead?.name).trim(), variables: r?.variables || {}, leadId: lead?.id || null, sendAt });
    }
    if (!rows.length) {
      return res.status(400).json({ success: false, error: `No valid recipients (${skipped.slice(0, 3).join("; ")})` });
    }

    // Times: given ones must be in order and spaced out; missing ones are spaced from the start time.
    const given = rows.filter((r) => r.sendAt);
    if (given.length && given.length !== rows.length) {
      return res.status(400).json({ success: false, error: "Give sendAt for every recipient or for none" });
    }
    const now = Date.now();
    if (given.length) {
      for (let i = 0; i < rows.length; i++) {
        const t = rows[i].sendAt!.getTime();
        if (t < now - 10 * 60 * 1000) return res.status(400).json({ success: false, error: "Send times are in the past. Rebuild the schedule and try again." });
        if (i > 0 && t - rows[i - 1].sendAt!.getTime() < MIN_GAP_MS) {
          return res.status(400).json({ success: false, error: `Messages must be in time order and at least ${MIN_GAP_MS / 1000}s apart (recipient ${i + 1})` });
        }
      }
    } else {
      const start = scheduledAt ? new Date(scheduledAt) : new Date();
      if (isNaN(start.getTime())) return res.status(400).json({ success: false, error: "Invalid scheduledAt" });
      const times = spacedSendTimes(rows.length, new Date(Math.max(start.getTime(), now)), Number(delaySeconds ?? 5), Number(batchSize ?? 10), Number(batchDelaySeconds ?? 30));
      rows.forEach((r, i) => (r.sendAt = times[i]));
    }

    const campaign = await prisma.whatsappCampaign.create({
      data: {
        name: String(name).slice(0, 200),
        sessionId: sessionId || "default",
        deviceId: deviceId || "WellnessLab",
        templateId: templateId || null,
        customBody: customBody || null,
        ...(buttons ? { buttons, footer } : {}),
        status: "SCHEDULED",
        scheduledAt: rows[0].sendAt,
        totalCount: rows.length,
        delaySeconds: delaySeconds ? Number(delaySeconds) : 5.0,
        batchSize: batchSize ? Number(batchSize) : 10,
        batchDelaySeconds: batchDelaySeconds ? Number(batchDelaySeconds) : 30.0,
        source: source === "marketing" ? "marketing" : "crm",
        timing: timing && typeof timing === "object" ? timing : undefined,
        recipients: {
          create: rows.map((r) => ({ phone: r.phone, name: r.name, variables: r.variables, leadId: r.leadId, sendAt: r.sendAt, status: "PENDING" })),
        },
      },
    });

    res.status(201).json({
      success: true,
      data: { ...campaign, firstSendAt: rows[0].sendAt, lastSendAt: rows[rows.length - 1].sendAt, skipped },
    });
  } catch (error: any) {
    console.error("Error creating campaign:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel scheduled or sending campaign
router.post("/campaigns/:id/cancel", async (req, res) => {
  const { id } = req.params;
  try {
    const campaign = await prisma.whatsappCampaign.findUnique({
      where: { id }
    });

    if (!campaign) {
      return res.status(404).json({ success: false, error: "Campaign not found" });
    }

    if (campaign.status === "COMPLETED" || campaign.status === "FAILED") {
      return res.status(400).json({ success: false, error: "Cannot cancel a completed campaign" });
    }

    // If it's an active bulk campaign on the gateway, request cancellation
    if (campaign.batchId && campaign.status === "SENDING") {
      try {
        await cancelBatch(campaign.sessionId, campaign.batchId);
        console.log(`Cancelled bulk batch ${campaign.batchId} on gateway`);
      } catch (gateErr) {
        console.error(`Failed to cancel batch ${campaign.batchId} on gateway:`, gateErr);
      }
    }

    await prisma.whatsappCampaign.update({
      where: { id },
      data: { status: "CANCELLED" }
    });

    // Update remaining pending recipients to FAILED with cancelled notice
    await prisma.whatsappCampaignRecipient.updateMany({
      where: { campaignId: id, status: "PENDING" },
      data: { status: "FAILED", error: "Campaign was cancelled by administrator" }
    });

    res.json({ success: true, message: "Campaign cancelled successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a campaign
router.delete("/campaigns/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.whatsappCampaign.delete({
      where: { id },
    });
    res.json({ success: true, message: "Campaign deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Interactive message fields from a request: buttons [{ type: reply|url|call|copy, label, value }] (max 3,
// values may use {{name}} {{phone}} {{email}} {{city}} {{passport}}) and an optional footer.
// Absent buttons -> nothing to set; [] -> clears them.
type ButtonSpec = { type: string; label: string; value: string };
function interactiveFields(body: any, type?: string): { buttons?: ButtonSpec[] | null; footer?: string | null } | { error: string } {
  if (body?.buttons === undefined) return {};
  const buttons = sanitizeNotifyButtons(body.buttons) || [];
  if (buttons.length > 3) return { error: "At most 3 buttons" };
  if (buttons.length && type && type !== "TEXT") return { error: "Buttons work only on text templates (not with an image, video or document)" };
  const footer = String(body?.footer || "").trim().slice(0, 200) || null;
  return buttons.length ? { buttons, footer } : { buttons: null, footer: null };
}
// Prisma data for a template's buttons/footer (unchanged when the request did not send buttons).
const templateButtonData = (x: { buttons?: ButtonSpec[] | null; footer?: string | null }) =>
  x.buttons === undefined ? {} : { buttons: x.buttons ?? Prisma.DbNull, footer: x.footer ?? null };

export default router;
