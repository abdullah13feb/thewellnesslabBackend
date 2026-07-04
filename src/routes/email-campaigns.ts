import { Router } from 'express';
import { emailCampaignService } from '../services/email-campaign.service.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all email campaigns (with optional filtering)
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    let whereClause: any = {};

    if (status && status !== 'all') {
      whereClause.status = status as string;
    }

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        const start = new Date(startDate as string);
        start.setHours(0, 0, 0, 0);
        whereClause.createdAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = end;
      }
    }

    const campaigns = await prisma.emailCampaign.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { recipients: true }
        }
      }
    });
    res.json(campaigns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific campaign
router.get('/:id', async (req, res) => {
  try {
    const { page, limit, status } = req.query;

    // Build recipient where clause supporting:
    //   status = SENT | PENDING | FAILED | BOUNCED | SPAM  → filter by record status
    //   status = OPENED  → recipients where openedAt IS NOT NULL
    //   status = CLICKED → recipients where clickedAt IS NOT NULL
    //   status = ALL (or omitted) → no filter
    const recipientWhere: any = { campaignId: req.params.id };
    if (status && status !== 'ALL') {
      if (status === 'OPENED') {
        recipientWhere.openedAt = { not: null };
      } else if (status === 'CLICKED') {
        recipientWhere.clickedAt = { not: null };
      } else {
        recipientWhere.status = status as string;
      }
    }

    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: req.params.id }
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Count filtered recipients (drives pagination)
    const totalRecipients = await prisma.emailCampaignRecipient.count({
      where: recipientWhere
    });

    // Count all recipients (for overview stats bar)
    const totalRecipientsAll = await prisma.emailCampaignRecipient.count({
      where: { campaignId: req.params.id }
    });

    // limit=0 means "show all" (no pagination)
    const parsedLimit = parseInt(limit as string);
    const showAll = parsedLimit === 0;
    const allowedLimits = [10, 25, 50, 100];
    const limitNum = showAll ? totalRecipients : (allowedLimits.includes(parsedLimit) ? parsedLimit : 10);
    const pageNum = showAll ? 1 : Math.max(1, parseInt(page as string) || 1);
    const skip = showAll ? 0 : (pageNum - 1) * limitNum;

    const recipients = await prisma.emailCampaignRecipient.findMany({
      where: recipientWhere,
      include: { senderAccount: true },
      orderBy: { id: 'asc' },
      skip,
      ...(showAll ? {} : { take: limitNum })
    });

    res.json({
      ...campaign,
      recipients,
      totalRecipients,     // filtered count (pagination denominator)
      totalRecipientsAll,  // unfiltered count (overview stats)
      page: pageNum,
      limit: showAll ? 0 : limitNum,
      showAll,
      statusFilter: status || 'ALL'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new campaign
router.post('/', async (req, res) => {
  try {
    const { 
      name, 
      subject, 
      htmlTemplate, 
      recipients, 
      pdfUrl, 
      scheduledAt, 
      timezone, 
      senderAccountIds, 
      targetListId,
      batchSize,
      recipientDelay,
      batchDelay,
      thresholdCount,
      thresholdDelay,
      percentageDelay
    } = req.body;
    
    let finalRecipients = recipients;
    if (targetListId) {
      const targetList = await prisma.targetList.findUnique({
        where: { id: targetListId }
      });
      if (!targetList) {
        return res.status(404).json({ error: 'Target list not found' });
      }

      const emailsList = targetList.emails as any[];
      finalRecipients = emailsList
        .filter((r: any) => r.isValid)
        .map((r: any) => ({
          email: r.email,
          name: r.name || null,
          variables: r.variables || {}
        }));
    }

    if (!subject || !htmlTemplate || !finalRecipients || !Array.isArray(finalRecipients) || finalRecipients.length === 0) {
      return res.status(400).json({ error: 'Subject, htmlTemplate, and recipients (or valid target list) are required' });
    }

    const campaign = await emailCampaignService.createCampaign({ 
      name, 
      subject, 
      htmlTemplate, 
      recipients: finalRecipients, 
      pdfUrl, 
      scheduledAt, 
      timezone,
      senderAccountIds,
      batchSize: batchSize !== undefined ? Number(batchSize) : undefined,
      recipientDelay: recipientDelay !== undefined ? Number(recipientDelay) : undefined,
      batchDelay: batchDelay !== undefined ? Number(batchDelay) : undefined,
      thresholdCount: thresholdCount !== undefined ? Number(thresholdCount) : undefined,
      thresholdDelay: thresholdDelay !== undefined ? Number(thresholdDelay) : undefined,
      percentageDelay: percentageDelay !== undefined ? Number(percentageDelay) : undefined
    });
    res.status(201).json({ 
      message: 'Campaign created successfully', 
      id: campaign.id, 
      status: campaign.status 
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Trigger sending a campaign
router.post('/:id/send', async (req, res) => {
  try {
    // We run the send function asynchronously and respond immediately so the client doesn't time out
    // In a real production app, this should be dispatched to a worker queue.
    emailCampaignService.sendCampaign(req.params.id).catch(console.error);
    
    res.json({ message: 'Campaign sending process started in the background. Status will update shortly.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Pause a campaign in progress
router.post('/:id/pause', async (req, res) => {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: req.params.id }
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'SENDING') {
      return res.status(400).json({ error: 'Only campaigns in SENDING status can be paused' });
    }

    await prisma.emailCampaign.update({
      where: { id: req.params.id },
      data: { status: 'PAUSED' }
    });

    res.json({ message: 'Campaign paused successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel a campaign in progress, paused, or scheduled
router.post('/:id/cancel', async (req, res) => {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: req.params.id }
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'SENDING' && campaign.status !== 'PAUSED' && campaign.status !== 'SCHEDULED') {
      return res.status(400).json({ error: 'Only active, paused, or scheduled campaigns can be cancelled' });
    }

    await prisma.emailCampaign.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' }
    });

    res.json({ message: 'Campaign cancelled successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
