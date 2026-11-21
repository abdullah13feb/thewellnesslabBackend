import prisma from "./prisma.js";
import { getBatchStatus } from "./whatsappGateway.js";
import { dispatchDueRecipients } from "./broadcastDispatch.js";

let schedulerInterval: NodeJS.Timeout | null = null;

export function startWhatsappScheduler() {
  if (schedulerInterval) {
    console.log("⏰ WhatsApp Broadcast Scheduler already running.");
    return;
  }

  console.log("⏰ WhatsApp Broadcast Scheduler initialized.");

  // Every 15 seconds: send recipients that are due (each at its own sendAt time, same dispatcher as the
  // Lambda broadcastTick), and poll progress of gateway bulk batches. A run that is still sending is not overlapped.
  let running = false;
  schedulerInterval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await dispatchDueRecipients({ budgetMs: 14000 });
      await pollActiveCampaigns();
    } catch (error) {
      console.error("❌ Error in WhatsApp Scheduler loop:", error);
    } finally {
      running = false;
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
