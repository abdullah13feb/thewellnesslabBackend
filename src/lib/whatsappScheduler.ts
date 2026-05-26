import prisma from "./prisma.js";
import {
  sendWhatsappMessage,
  sendWhatsappMediaMessage,
  sendWhatsappBulk,
  getBatchStatus,
  cancelBatch,
  normalizePhoneNumber
} from "./whatsappGateway.js";

let schedulerInterval: NodeJS.Timeout | null = null;

export function startWhatsappScheduler() {
  if (schedulerInterval) {
    console.log("⏰ WhatsApp Broadcast Scheduler already running.");
    return;
  }

  console.log("⏰ WhatsApp Broadcast Scheduler initialized.");

  // Check every 15 seconds for scheduled promotions and active bulk statuses
  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
      
      // 1. Process scheduled campaigns
      const dueCampaigns = await prisma.whatsappCampaign.findMany({
        where: {
          status: "SCHEDULED",
          scheduledAt: { lte: now },
        },
      });

      for (const campaign of dueCampaigns) {
        // Mark as SENDING immediately to prevent duplicate runs
        await prisma.whatsappCampaign.update({
          where: { id: campaign.id },
          data: { status: "SENDING" },
        });

        console.log(`🚀 Starting campaign execution for: ${campaign.name} (${campaign.id})`);
        
        // Execute background dispatch without blocking the scheduler loop
        void processCampaign(campaign.id);
      }

      // 2. Poll progress for active bulk campaigns
      await pollActiveCampaigns();

    } catch (error) {
      console.error("❌ Error in WhatsApp Scheduler loop:", error);
    }
  }, 15000);
}

export function stopWhatsappScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("⏰ WhatsApp Broadcast Scheduler stopped.");
  }
}

/**
 * Background worker that queries active campaigns and polls progress from the gateway
 */
async function pollActiveCampaigns() {
  try {
    const activeCampaigns = await prisma.whatsappCampaign.findMany({
      where: {
        status: "SENDING",
        batchId: { not: null },
      },
    });

    for (const campaign of activeCampaigns) {
      const response = await getBatchStatus(campaign.sessionId, campaign.batchId!);
      if (!response || !response.success || !response.data) {
        console.error(`⚠️ Could not fetch batch status for campaign ${campaign.id}`);
        continue;
      }

      const batch = response.data;
      const progress = batch.progress || { total: campaign.totalCount, processed: 0, remaining: campaign.totalCount };
      
      console.log(`📊 Campaign "${campaign.name}" bulk progress: ${progress.processed}/${progress.total} (Status: ${batch.status})`);

      if (batch.status === "completed") {
        // Complete the campaign in our DB
        await prisma.whatsappCampaign.update({
          where: { id: campaign.id },
          data: {
            status: "COMPLETED",
            successCount: progress.total,
            failCount: 0,
          },
        });

        // Mark all remaining pending recipients as SENT
        await prisma.whatsappCampaignRecipient.updateMany({
          where: { campaignId: campaign.id, status: "PENDING" },
          data: { status: "SENT", sentAt: new Date() },
        });

        console.log(`✅ Bulk campaign ${campaign.id} completed successfully.`);
      } else if (batch.status === "cancelled" || batch.status === "failed") {
        const finalStatus = batch.status === "cancelled" ? "CANCELLED" : "FAILED";
        
        await prisma.whatsappCampaign.update({
          where: { id: campaign.id },
          data: {
            status: finalStatus,
            successCount: progress.processed,
            failCount: progress.total - progress.processed,
          },
        });

        // Update remaining pending recipients to FAILED
        await prisma.whatsappCampaignRecipient.updateMany({
          where: { campaignId: campaign.id, status: "PENDING" },
          data: {
            status: "FAILED",
            error: `Bulk campaign batch execution was ${batch.status} on the gateway`,
          },
        });

        console.log(`⚠️ Bulk campaign ${campaign.id} execution ended with status: ${finalStatus}`);
      } else {
        // Still processing, update successCount and failCount live
        await prisma.whatsappCampaign.update({
          where: { id: campaign.id },
          data: {
            successCount: progress.processed,
            failCount: progress.total - progress.processed - (progress.remaining || 0),
          },
        });
      }
    }
  } catch (error) {
    console.error("❌ Error polling active campaigns:", error);
  }
}

/**
 * Background worker that dispatches messages to campaign recipients via native bulk API
 */
export async function processCampaign(campaignId: string) {
  try {
    const campaign = await prisma.whatsappCampaign.findUnique({
      where: { id: campaignId },
      include: {
        template: true,
        recipients: {
          where: { status: "PENDING" },
        },
      },
    });

    if (!campaign) {
      console.error(`Campaign not found: ${campaignId}`);
      return;
    }

    if (campaign.recipients.length === 0) {
      console.log(`No pending recipients for campaign: ${campaignId}`);
      await prisma.whatsappCampaign.update({
        where: { id: campaignId },
        data: { status: "COMPLETED" },
      });
      return;
    }

    console.log(`Preparing ${campaign.recipients.length} messages for bulk dispatch in campaign: ${campaign.name}`);

    const bulkMessages: Array<{
      chatId: string;
      type: "text" | "image" | "video" | "document";
      text: string;
      file?: string;
      filename?: string;
    }> = [];

    const hasMedia = campaign.template && campaign.template.type !== "TEXT" && campaign.template.mediaUrl;
    let type: "text" | "image" | "video" | "document" = "text";
    if (campaign.template) {
      if (campaign.template.type === "IMAGE") type = "image";
      else if (campaign.template.type === "VIDEO") type = "video";
      else if (campaign.template.type === "DOCUMENT") type = "document";
    }

    for (const recipient of campaign.recipients) {
      // Compile message contents
      let messageText = campaign.customBody || campaign.template?.body || "";
      
      // Parse custom variables (from CSV dynamic headers)
      const variablesMap = (recipient.variables as Record<string, string>) || {};
      
      // Inject standard parameters if not overridden
      if (recipient.name && !variablesMap["name"]) {
        variablesMap["name"] = recipient.name;
      }
      if (recipient.phone && !variablesMap["phone"]) {
        variablesMap["phone"] = recipient.phone;
      }

      // Replace placeholders: e.g., {{name}}, {{phone}}, {{company}}
      for (const [key, value] of Object.entries(variablesMap)) {
        const placeholderRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
        messageText = messageText.replace(placeholderRegex, value || "");
      }

      const formattedPhone = normalizePhoneNumber(recipient.phone);

      const msgPayload: any = {
        chatId: formattedPhone,
        type: type,
        text: messageText,
      };

      if (hasMedia) {
        msgPayload.file = campaign.template!.mediaUrl!;
        msgPayload.filename = campaign.template!.mediaUrl!.split("/").pop() || "file";
      }

      bulkMessages.push(msgPayload);
    }

    // Call native bulk sending endpoint on the gateway
    const result = await sendWhatsappBulk(campaign.sessionId, bulkMessages, campaign.id);

    if (result && result.success) {
      console.log(`✅ Bulk campaign ${campaignId} successfully enqueued on gateway. Batch ID: ${campaign.id}`);
      
      // Update campaign in DB with batchId
      await prisma.whatsappCampaign.update({
        where: { id: campaignId },
        data: {
          batchId: campaign.id,
          status: "SENDING"
        },
      });
    } else {
      throw new Error(result?.error?.message || "Gateway rejected bulk messaging payload");
    }

  } catch (error: any) {
    console.error(`❌ Global error in processCampaign for ${campaignId}:`, error);
    
    await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: { status: "FAILED" },
    });

    // Mark all pending recipients as FAILED
    await prisma.whatsappCampaignRecipient.updateMany({
      where: { campaignId, status: "PENDING" },
      data: {
        status: "FAILED",
        error: error.message || "Failed to initialize bulk campaign on gateway",
      },
    });
  }
}
