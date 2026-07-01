import { PrismaClient, EmailSenderAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import { emailSenderService } from './email-sender.service.js';

const prisma = new PrismaClient();

export class EmailCampaignService {
  /**
   * Create a new email campaign
   */
  async createCampaign(data: { name?: string; subject: string; htmlTemplate: string; pdfUrl?: string; scheduledAt?: string; timezone?: string; senderAccountIds?: string[]; recipients: { email: string; name?: string; variables?: any }[] }) {
    const status = data.scheduledAt ? 'SCHEDULED' : 'DRAFT';
    return prisma.emailCampaign.create({
      data: {
        name: data.name || null,
        subject: data.subject,
        htmlTemplate: data.htmlTemplate,
        pdfUrl: data.pdfUrl,
        status: status,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        timezone: data.timezone || null,
        senderAccountIds: data.senderAccountIds || [],
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
    let activeSenders = await emailSenderService.getActiveSenders();
    if (campaign.senderAccountIds && campaign.senderAccountIds.length > 0) {
      activeSenders = activeSenders.filter(sender => campaign.senderAccountIds.includes(sender.id));
    }
    
    if (activeSenders.length === 0) {
      throw new Error('No active email sender accounts configured for this campaign. Please verify your selected senders.');
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
    let bounceCount = campaign.bounceCount;
    let spamCount = campaign.spamCount;

    // Helper to classify sending errors
    const getSendErrorStatus = (errorMessage: string): 'FAILED' | 'BOUNCED' | 'SPAM' => {
      const msg = errorMessage.toLowerCase();
      if (
        msg.includes('550') || 
        msg.includes('554') || 
        msg.includes('5.1.1') || 
        msg.includes('recipient address rejected') || 
        msg.includes('user unknown') || 
        msg.includes('mailbox unavailable') ||
        msg.includes('does not exist') ||
        msg.includes('invalid recipient')
      ) {
        if (msg.includes('spam') || msg.includes('block') || msg.includes('unsolicited') || msg.includes('policy')) {
          return 'SPAM';
        }
        return 'BOUNCED';
      }
      if (msg.includes('spam') || msg.includes('block') || msg.includes('unsolicited') || msg.includes('blacklist')) {
        return 'SPAM';
      }
      return 'FAILED';
    };

    // Process a single recipient
    const processRecipient = async (recipient: any, index: number) => {
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
      const baseUrl = process.env.API_URL || 'https://api.thewellnesslab.ae/api';
      const openTracker = `<img src="${baseUrl}/tracking/open/${recipient.id}" width="1" height="1" style="display:none;" />`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${openTracker}</body>`);
      } else {
        finalHtml += openTracker;
      }

      // 2. Rewrite Links for Click Tracking
      finalHtml = finalHtml.replace(/href=["'](https?:\/\/[^"']+)["']/g, (match, url) => {
        // Don't rewrite if it's already a tracking URL
        if (url.includes('/api/tracking/')) return match;
        const encodedUrl = encodeURIComponent(url);
        return `href="${baseUrl}/tracking/click/${recipient.id}?url=${encodedUrl}"`;
      });

      try {
        const mailOptions: any = {
          from: `"${sender.name}" <${sender.email}>`,
          to: recipient.email,
          subject: campaign.subject,
          html: finalHtml,
        };

        // Attach PDF if provided
        if (campaign.pdfUrl) {
          let filename = campaign.pdfUrl.split('/').pop() || 'attachment.pdf';
          if (!filename.includes('.')) {
            filename += '.pdf';
          }
          mailOptions.attachments = [
            {
              filename,
              path: campaign.pdfUrl,
            }
          ];
        }

        await transporter.sendMail(mailOptions);

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
        
        const errMessage = error.message || 'Unknown error';
        const errorStatus = getSendErrorStatus(errMessage);

        // Mark recipient with categorized error status
        await prisma.emailCampaignRecipient.update({
          where: { id: recipient.id },
          data: { 
            status: errorStatus, 
            error: errMessage,
            senderAccountId: sender.id,
            bouncedAt: errorStatus === 'BOUNCED' ? new Date() : null,
            spamReportedAt: errorStatus === 'SPAM' ? new Date() : null,
          },
        });

        if (errorStatus === 'BOUNCED') {
          bounceCount++;
        } else if (errorStatus === 'SPAM') {
          spamCount++;
        } else {
          failCount++;
        }
      }
    };

    // Send emails in batches of 50 to prevent SMTP blocking and RAM spikes
    const batchSize = 50;
    for (let i = 0; i < campaign.recipients.length; i += batchSize) {
      const batch = campaign.recipients.slice(i, i + batchSize);
      
      await Promise.allSettled(
        batch.map((recipient, idx) => processRecipient(recipient, i + idx))
      );

      // Add a 10 second pause between batches to respect rate limits (skip pause on final batch)
      if (i + batchSize < campaign.recipients.length) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    // Update final campaign status
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'COMPLETED',
        successCount,
        failCount,
        bounceCount,
        spamCount,
      },
    });

    return { successCount, failCount, bounceCount, spamCount, total: campaign.recipients.length };
  }
}

export const emailCampaignService = new EmailCampaignService();
