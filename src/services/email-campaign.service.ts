import { PrismaClient, EmailSenderAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import { emailSenderService } from './email-sender.service.js';

const prisma = new PrismaClient();

export class EmailCampaignService {
  /**
   * Create a new email campaign
   */
  async createCampaign(data: { subject: string; htmlTemplate: string; recipients: { email: string; name?: string; variables?: any }[] }) {
    return prisma.emailCampaign.create({
      data: {
        subject: data.subject,
        htmlTemplate: data.htmlTemplate,
        status: 'DRAFT',
        totalCount: data.recipients.length,
        recipients: {
          create: data.recipients.map(r => ({
            email: r.email,
            name: r.name,
            variables: r.variables || {},
            status: 'PENDING',
          })),
        },
      },
    });
  }

  /**
   * Send a campaign using Round-Robin Inbox Rotation
   */
  async sendCampaign(campaignId: string) {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: campaignId },
      include: {
        recipients: {
          where: { status: 'PENDING' },
        },
      },
    });

    if (!campaign) throw new Error('Campaign not found');
    if (campaign.recipients.length === 0) throw new Error('No pending recipients found');

    // Fetch active sender accounts
    const activeSenders = await emailSenderService.getActiveSenders();
    if (activeSenders.length === 0) {
      throw new Error('No active email sender accounts configured. Please add an account first.');
    }

    // Update campaign status
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { status: 'SENDING' },
    });

    // Create transporter instances for all active senders
    const transporters = activeSenders.map(sender => ({
      sender,
      transporter: nodemailer.createTransport({
        host: sender.smtpHost,
        port: sender.smtpPort,
        secure: sender.smtpPort === 465,
        auth: {
          user: sender.email,
          pass: sender.password,
        },
      }),
    }));

    let successCount = campaign.successCount;
    let failCount = campaign.failCount;

    // Send emails in a round-robin fashion
    // For large lists, this should ideally be handled by a queue (like BullMQ), 
    // but for simple cases, we can process them asynchronously here.
    const promises = campaign.recipients.map(async (recipient, index) => {
      // Determine which sender to use (Round Robin)
      const senderIndex = index % transporters.length;
      const { sender, transporter } = transporters[senderIndex];

      // Parse custom variables
      let finalHtml = campaign.htmlTemplate;
      if (recipient.name) finalHtml = finalHtml.replace(/{{name}}/g, recipient.name);
      if (recipient.variables) {
        const vars: any = recipient.variables;
        for (const key of Object.keys(vars)) {
          finalHtml = finalHtml.replace(new RegExp(`{{${key}}}`, 'g'), vars[key]);
        }
      }

      // 1. Inject Open Tracking Pixel
      const baseUrl = process.env.VITE_API_URL || 'http://localhost:5000/api';
      const openTracker = `<img src="${baseUrl}/tracking/open/${recipient.id}" width="1" height="1" style="display:none;" />`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${openTracker}</body>`);
      } else {
        finalHtml += openTracker;
      }

      // 2. Rewrite Links for Click Tracking
      // Find all href="http..." and replace with href="http://localhost:5000/api/tracking/click/recipientId?url=http..."
      finalHtml = finalHtml.replace(/href=["'](https?:\/\/[^"']+)["']/g, (match, url) => {
        // Don't rewrite if it's already a tracking URL
        if (url.includes('/api/tracking/')) return match;
        const encodedUrl = encodeURIComponent(url);
        return `href="${baseUrl}/tracking/click/${recipient.id}?url=${encodedUrl}"`;
      });

      try {
        await transporter.sendMail({
          from: `"${sender.name}" <${sender.email}>`,
          to: recipient.email,
          subject: campaign.subject,
          html: finalHtml,
        });

        // Mark recipient as SENT and record which account sent it
        await prisma.emailCampaignRecipient.update({
          where: { id: recipient.id },
          data: { 
            status: 'SENT', 
            sentAt: new Date(),
            senderAccountId: sender.id 
          },
        });
        successCount++;
      } catch (error: any) {
        console.error(`Failed to send email to ${recipient.email} via ${sender.email}:`, error);
        
        // Mark recipient as FAILED
        await prisma.emailCampaignRecipient.update({
          where: { id: recipient.id },
          data: { 
            status: 'FAILED', 
            error: error.message || 'Unknown error',
            senderAccountId: sender.id
          },
        });
        failCount++;
      }
    });

    // Wait for all to finish (In production with 10k emails, chunk this using Promise.allSettled on batches)
    // Here we batch them simply by awaiting all.
    await Promise.allSettled(promises);

    // Update final campaign status
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'COMPLETED',
        successCount,
        failCount,
      },
    });

    return { successCount, failCount, total: campaign.recipients.length };
  }
}

export const emailCampaignService = new EmailCampaignService();
