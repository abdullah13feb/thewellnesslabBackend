import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { emailCampaignService } from './email-campaign.service.js';

const prisma = new PrismaClient();

export function startEmailScheduler() {
    console.log('Email scheduler started. Checking for scheduled campaigns every minute...');
    
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            
            // Find campaigns that are SCHEDULED and whose scheduledAt is in the past
            const dueCampaigns = await prisma.emailCampaign.findMany({
                where: {
                    status: 'SCHEDULED',
                    scheduledAt: {
                        lte: now
                    }
                }
            });

            for (const campaign of dueCampaigns) {
                console.log(`Processing scheduled campaign ${campaign.id} - ${campaign.subject}`);
                
                // Dispatch send campaign process asynchronously using round-robin service
                emailCampaignService.sendCampaign(campaign.id).catch(err => {
                    console.error(`Error sending scheduled campaign ${campaign.id}:`, err);
                });
            }

            // Find campaigns that are SENDING but not running in memory (stranded)
            const sendingCampaigns = await prisma.emailCampaign.findMany({
                where: {
                    status: 'SENDING'
                }
            });

            for (const campaign of sendingCampaigns) {
                if (!emailCampaignService.isCampaignRunning(campaign.id)) {
                    console.log(`Auto-recovering stranded SENDING campaign ${campaign.id} - ${campaign.subject}`);
                    emailCampaignService.sendCampaign(campaign.id).catch(err => {
                        console.error(`Error recovering campaign ${campaign.id}:`, err);
                    });
                }
            }
        } catch (error) {
            console.error('Error in email scheduler:', error);
        }
    });
}
