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
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: req.params.id },
      include: {
        recipients: {
          include: {
            senderAccount: true
          }
        }
      }
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
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

// Stop a campaign in progress
router.post('/:id/stop', async (req, res) => {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: req.params.id }
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'SENDING' && campaign.status !== 'SCHEDULED') {
      return res.status(400).json({ error: 'Only active (SENDING) or scheduled campaigns can be stopped' });
    }

    await prisma.emailCampaign.update({
      where: { id: req.params.id },
      data: { status: 'STOPPED' }
    });

    res.json({ message: 'Campaign stop signal sent successfully. Status will update to STOPPED shortly.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
