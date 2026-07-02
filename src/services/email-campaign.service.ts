import { PrismaClient, EmailSenderAccount } from '@prisma/client';
import nodemailer from 'nodemailer';
import { emailSenderService } from './email-sender.service.js';

const prisma = new PrismaClient();

export class EmailCampaignService {
  /**
   * Create a new email campaign
   */
  async createCampaign(data: { 
    name?: string; 
    subject: string; 
    htmlTemplate: string; 
    pdfUrl?: string; 
    scheduledAt?: string; 
    timezone?: string; 
    senderAccountIds?: string[]; 
    recipients: { email: string; name?: string; variables?: any }[];
    batchSize?: number;
    recipientDelay?: number;
    batchDelay?: number;
    thresholdCount?: number;
    thresholdDelay?: number;
    percentageDelay?: number;
  }) {
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
        batchSize: data.batchSize !== undefined ? data.batchSize : 10,
        recipientDelay: data.recipientDelay !== undefined ? data.recipientDelay : 1.5,
        batchDelay: data.batchDelay !== undefined ? data.batchDelay : 15.0,
        thresholdCount: data.thresholdCount !== undefined ? data.thresholdCount : 100,
        thresholdDelay: data.thresholdDelay !== undefined ? data.thresholdDelay : 30.0,
        percentageDelay: data.percentageDelay !== undefined ? data.percentageDelay : 60.0,
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
   * Send a campaign using Round-Robin Inbox Rotation and customizable batch throttling
   */
  async sendCampaign(campaignId: string) {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: campaignId },
      include: {
        recipients: {
          where: { status: 'PENDING' },
          orderBy: { id: 'asc' },
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

    // Helper to sleep with periodic database checks to abort if STOPPED
    const sleepWithCheck = async (minutes: number): Promise<boolean> => {
      const ms = minutes * 60 * 1000;
      const checkInterval = 5000; // Check DB every 5 seconds
      let elapsed = 0;
      while (elapsed < ms) {
        const latest = await prisma.emailCampaign.findUnique({
          where: { id: campaignId },
          select: { status: true },
        });
        if (!latest || latest.status === 'STOPPED' || latest.status === 'CANCELLED') {
          return false; // Campaign stopped during sleep
        }
        const timeToSleep = Math.min(checkInterval, ms - elapsed);
        await new Promise(resolve => setTimeout(resolve, timeToSleep));
        elapsed += timeToSleep;
      }
      return true; // Completed sleep without stop
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
        
        // Update campaign counts in real-time
        await prisma.emailCampaign.update({
          where: { id: campaignId },
          data: { successCount }
        });
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

        // Update campaign counts in real-time
        await prisma.emailCampaign.update({
          where: { id: campaignId },
          data: { failCount, bounceCount, spamCount }
        });
      }
    };

    // Fetch global timing settings from db Setting table, fallback to defaults
    const settingsList = await prisma.setting.findMany();
    const getSettingVal = (key: string, defaultValue: number): number => {
      const s = settingsList.find(item => item.key === key);
      return s ? parseFloat(s.value) : defaultValue;
    };

    const batchSize = getSettingVal('email_batch_size', 10);
    const recipientDelay = getSettingVal('email_recipient_delay', 1.5);
    const batchDelay = getSettingVal('email_batch_delay', 15.0);
    const thresholdCount = getSettingVal('email_threshold_count', 100);
    const thresholdDelay = getSettingVal('email_threshold_delay', 30.0);
    const percentageDelay = getSettingVal('email_percentage_delay', 60.0);

    const totalSentAtStart = campaign.successCount + campaign.failCount + campaign.bounceCount + campaign.spamCount;
    const fiftyPercentCount = Math.floor(campaign.totalCount / 2);

    // Sequential loop through pending recipients
    for (let idx = 0; idx < campaign.recipients.length; idx++) {
      const recipient = campaign.recipients[idx];

      // Check if campaign was manually stopped/cancelled
      const latest = await prisma.emailCampaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!latest || latest.status === 'STOPPED' || latest.status === 'CANCELLED') {
        console.log(`Campaign ${campaignId} was manually stopped or cancelled. Halting sending.`);
        return { successCount, failCount, bounceCount, spamCount, total: campaign.totalCount };
      }

      // Process recipient (send email, increment counters, and update DB)
      await processRecipient(recipient, idx);

      const currentSent = totalSentAtStart + idx + 1;

      // Apply dynamic sleep logic if there are more recipients to process
      if (idx + 1 < campaign.recipients.length) {
        let sleepMinutes = 0;
        let sleepReason = "";

        if (currentSent === fiftyPercentCount && fiftyPercentCount > 0) {
          sleepMinutes = percentageDelay;
          sleepReason = `50% milestone (${fiftyPercentCount} emails sent)`;
        } else if (currentSent % thresholdCount === 0) {
          sleepMinutes = thresholdDelay;
          sleepReason = `threshold limit (${currentSent} emails sent)`;
        } else if ((idx + 1) % batchSize === 0) {
          sleepMinutes = batchDelay;
          sleepReason = `batch boundary (${idx + 1} emails in this run)`;
        } else {
          sleepMinutes = recipientDelay;
          sleepReason = "individual recipient gap";
        }

        if (sleepMinutes > 0) {
          console.log(`Campaign ${campaignId}: sleeping for ${sleepMinutes} minutes due to ${sleepReason}`);
          const continueSending = await sleepWithCheck(sleepMinutes);
          if (!continueSending) {
            console.log(`Campaign ${campaignId} stopped during sleep.`);
            return { successCount, failCount, bounceCount, spamCount, total: campaign.totalCount };
          }
        }
      }
    }

    // Final update of campaign status to COMPLETED
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

    return { successCount, failCount, bounceCount, spamCount, total: campaign.totalCount };
  }
}

export const emailCampaignService = new EmailCampaignService();
