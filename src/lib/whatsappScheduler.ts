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

    console.log(`🚀 Starting sequential WhatsApp campaign delivery for: ${campaign.name}. Total: ${campaign.recipients.length}`);

    const hasMedia = campaign.template && campaign.template.type !== "TEXT" && campaign.template.mediaUrl;
    
    let successCount = 0;
    let failCount = 0;

    for (const recipient of campaign.recipients) {
      // 1. Check if campaign has been CANCELLED by the user
      const checkCampaign = await prisma.whatsappCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true }
      });

      if (checkCampaign?.status === "CANCELLED") {
        console.log(`🛑 Campaign ${campaignId} was cancelled by administrator. Halting sequential delivery.`);
        // Mark all remaining pending recipients as FAILED
        await prisma.whatsappCampaignRecipient.updateMany({
          where: { campaignId, status: "PENDING" },
          data: { status: "FAILED", error: "Campaign was cancelled by administrator" }
        });
        return;
      }

      // 2. Compile message body with variable substitutions
      let messageText = campaign.customBody || campaign.template?.body || "";
      const variablesMap = (recipient.variables as Record<string, string>) || {};
      
      if (recipient.name && !variablesMap["name"]) {
        variablesMap["name"] = recipient.name;
      }
      if (recipient.phone && !variablesMap["phone"]) {
        variablesMap["phone"] = recipient.phone;
      }

      for (const [key, value] of Object.entries(variablesMap)) {
        const placeholderRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
        messageText = messageText.replace(placeholderRegex, value || "");
      }

      // 3. Dispatch the message
      let success = false;
      try {
        if (hasMedia) {
          success = await sendWhatsappMediaMessage(
            campaign.sessionId,
            recipient.phone,
            messageText,
            campaign.template!.mediaUrl!,
            campaign.template!.type
          );
        } else {
          success = await sendWhatsappMessage(campaign.sessionId, recipient.phone, messageText);
        }
      } catch (sendErr: any) {
        console.error(`Error sending to ${recipient.phone}:`, sendErr);
        success = false;
      }

      // 4. Update Recipient and Campaign status live in the DB
      if (success) {
        successCount++;
        await prisma.whatsappCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "SENT", sentAt: new Date() }
        });
      } else {
        failCount++;
        await prisma.whatsappCampaignRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", error: "Gateway rejected message. Check session connection state." }
        });
      }

      await prisma.whatsappCampaign.update({
        where: { id: campaignId },
        data: {
          successCount,
          failCount,
        }
      });

      console.log(`✉️ Delivered to ${recipient.phone}: ${success ? "✅ SUCCESS" : "❌ FAILED"}. Progress: ${successCount + failCount}/${campaign.recipients.length}`);

      // 5. Anti-Ban Delay: Sleep for a random interval between 2,000ms and 5,000ms (2 to 5 seconds)
      const delay = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // 6. Complete campaign in DB
    await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETED" }
    });

    console.log(`✅ Campaign ${campaignId} completed. Successful: ${successCount}, Failed: ${failCount}`);

  } catch (error: any) {
    console.error(`❌ Global error in processCampaign for ${campaignId}:`, error);
    
    await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: { status: "FAILED" },
    });

    await prisma.whatsappCampaignRecipient.updateMany({
      where: { campaignId, status: "PENDING" },
      data: {
        status: "FAILED",
        error: error.message || "Failed to execute sequential campaign runner",
      },
    });
  }
}
