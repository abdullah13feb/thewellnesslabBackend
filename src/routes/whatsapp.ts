import { Router } from "express";
import prisma from "../lib/prisma.js";
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

  try {
    const template = await prisma.whatsappTemplate.create({
      data: {
        name,
        body,
        variables: variables || [],
        type: type || "TEXT",
        mediaUrl: mediaUrl || null,
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

  try {
    const template = await prisma.whatsappTemplate.update({
      where: { id },
      data: {
        name,
        body,
        variables: variables || [],
        type: type || "TEXT",
        mediaUrl: mediaUrl || null,
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
          orderBy: { phone: "asc" }
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

// Create and trigger campaign
router.post("/campaigns", async (req, res) => {
  const { name, templateId, customBody, scheduledAt, recipients, sessionId } = req.body;
  
  if (!name || (!templateId && !customBody)) {
    return res.status(400).json({ success: false, error: "Campaign name and message content (template or custom text) are required" });
  }

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ success: false, error: "A list of recipients is required" });
  }

  try {
    const isImmediate = !scheduledAt;
    const scheduleDate = scheduledAt ? new Date(scheduledAt) : new Date();
    
    // Save campaign in DB
    const campaign = await prisma.whatsappCampaign.create({
      data: {
        name,
        sessionId: sessionId || "default",
        templateId: templateId || null,
        customBody: customBody || null,
        status: isImmediate ? "SENDING" : "SCHEDULED",
        scheduledAt: scheduleDate,
        totalCount: recipients.length,
        recipients: {
          create: recipients.map((r: any) => ({
            phone: normalizePhoneNumber(r.phone, false),
            name: r.name || null,
            variables: r.variables || {},
            status: "PENDING",
          })),
        },
      },
    });

    // If it's an immediate broadcast, trigger processing asynchronously right now
    if (isImmediate) {
      // Dynamic import of scheduler to prevent circular dependency
      const { startWhatsappScheduler } = await import("../lib/whatsappScheduler.js");
      // Trigger background campaign runner
      const schedulerModule = await import("../lib/whatsappScheduler.js");
      // We will trigger the specific background campaign processor
      // Use internal function exposure if accessible or let the loop pick it up immediately
      // By setting the status to "SENDING" and letting our processCampaign function execute,
      // we can trigger the function:
      const processCampaignRef = (schedulerModule as any).processCampaign;
      if (typeof processCampaignRef === "function") {
        void processCampaignRef(campaign.id);
      } else {
        // Fallback: If not exported, set scheduled time 5 seconds ago, the loop will grab it in <= 15s.
        await prisma.whatsappCampaign.update({
          where: { id: campaign.id },
          data: { status: "SCHEDULED", scheduledAt: new Date(Date.now() - 5000) }
        });
      }
    }

    res.status(201).json({ success: true, data: campaign });
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

export default router;
