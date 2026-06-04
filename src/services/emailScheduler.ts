import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

const prisma = new PrismaClient();

const createTransporter = async () => {
    if (process.env.MARKETING_HOST && process.env.MARKETING_EMAIL_USER && process.env.MARKETING_EMAIL_PASS) {
        return nodemailer.createTransport({
            host: process.env.MARKETING_HOST,
            port: Number(process.env.MARKETING_EMAIL_PORT) || 465,
            secure: process.env.MARKETING_EMAIL_SECURE === 'true' || Number(process.env.MARKETING_EMAIL_PORT) === 465,
            auth: {
                user: process.env.MARKETING_EMAIL_USER,
                pass: process.env.MARKETING_EMAIL_PASS,
            },
        });
    }

    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass,
        },
    });
};

// Replace placeholders in HTML template
function replaceVariables(html: string, variables: any) {
    if (!variables) return html;
    let result = html;
    for (const [key, value] of Object.entries(variables)) {
        if (value) {
            const regex = new RegExp(`{{${key}}}`, 'gi');
            result = result.replace(regex, String(value));
        }
    }
    return result;
}

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
                },
                include: {
                    recipients: {
                        where: { status: 'PENDING' }
                    }
                }
            });

            if (dueCampaigns.length === 0) return;

            const transporter = await createTransporter();

            for (const campaign of dueCampaigns) {
                console.log(`Processing scheduled campaign ${campaign.id} - ${campaign.subject}`);
                
                // Mark as sending
                await prisma.emailCampaign.update({
                    where: { id: campaign.id },
                    data: { status: 'SENDING' }
                });

                let successCount = 0;
                let failCount = 0;

                for (const recipient of campaign.recipients) {
                    try {
                        const htmlToSend = replaceVariables(campaign.htmlTemplate, recipient.variables);
                        
                        await transporter.sendMail({
                            from: process.env.MARKETING_EMAIL_USER || '"The Wellness Lab" <marketing@thewellnesslab.ae>',
                            to: recipient.email,
                            subject: campaign.subject,
                            html: htmlToSend,
                        });

                        successCount++;
                        await prisma.emailCampaignRecipient.update({
                            where: { id: recipient.id },
                            data: { status: 'SENT', sentAt: new Date() }
                        });
                    } catch (error: any) {
                        failCount++;
                        await prisma.emailCampaignRecipient.update({
                            where: { id: recipient.id },
                            data: { status: 'FAILED', error: error.message }
                        });
                    }
                }

                // Mark as completed
                await prisma.emailCampaign.update({
                    where: { id: campaign.id },
                    data: { 
                        status: 'COMPLETED',
                        successCount: campaign.successCount + successCount,
                        failCount: campaign.failCount + failCount
                    }
                });
                
                console.log(`Campaign ${campaign.id} completed. Success: ${successCount}, Fail: ${failCount}`);
            }
        } catch (error) {
            console.error('Error in email scheduler:', error);
        }
    });
}
