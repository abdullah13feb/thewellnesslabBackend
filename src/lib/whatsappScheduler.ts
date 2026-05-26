import prisma from "./prisma.js";
import { sendWhatsappMessage } from "./whatsappGateway.js";

let schedulerInterval: NodeJS.Timeout | null = null;
const SEND_DELAY_MS = 2000; // 2 seconds between messages to prevent spam flags

export function startWhatsappScheduler() {
  if (schedulerInterval) {
    console.log("⏰ WhatsApp Broadcast Scheduler already running.");
    return;
  }

  console.log("⏰ WhatsApp Broadcast Scheduler initialized.");

  // Check every 15 seconds for scheduled promotions
  schedulerInterval = setInterval(async () => {
    try {
      const now = new Date();
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
 * Background worker that dispatches messages to campaign recipients sequentially
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

    if (campaign.status === "CANCELLED") {
      console.log(`Campaign ${campaignId} was already cancelled.`);
      return;
    }

    let successCount = campaign.successCount;
    let failCount = campaign.failCount;

    console.log(`Sending ${campaign.recipients.length} pending messages for campaign: ${campaign.name}`);

    for (const recipient of campaign.recipients) {
      // Check if campaign was cancelled during sending
      const currentCampaign = await prisma.whatsappCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });

      if (!currentCampaign || currentCampaign.status === "CANCELLED") {
        console.log(`⚠️ Campaign ${campaignId} cancelled during active processing.`);
        return;
      }

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

      try {
        const success = await sendWhatsappMessage(campaign.sessionId, recipient.phone, messageText);
        
        if (success) {
          await prisma.whatsappCampaignRecipient.update({
            where: { id: recipient.id },
            data: { status: "SENT", sentAt: new Date() },
          });
          successCount++;
        } else {
          throw new Error("OpenWA gateway rejected the message");
        }
      } catch (err: any) {
        console.error(`❌ Failed to send broadcast to ${recipient.phone}:`, err);
        await prisma.whatsappCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "FAILED",
            error: err.message || "Gateway communication error",
          },
        });
        failCount++;
      }

      // Update progress in the database after every send so user can see it live
      await prisma.whatsappCampaign.update({
        where: { id: campaignId },
        data: { successCount, failCount },
      });

      // Sequential delay to prevent getting flagged as spam by WhatsApp
      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    }

    // Determine final status
    const finalStatus = failCount === campaign.totalCount ? "FAILED" : "COMPLETED";
    await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: { status: finalStatus },
    });

    console.log(`✅ Campaign ${campaignId} finished execution. Success: ${successCount}, Failures: ${failCount}`);
  } catch (error) {
    console.error(`❌ Global error in processCampaign for ${campaignId}:`, error);
    await prisma.whatsappCampaign.update({
      where: { id: campaignId },
      data: { status: "FAILED" },
    });
  }
}
