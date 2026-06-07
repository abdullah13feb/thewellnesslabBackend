import { Router } from 'express';
import { emailCampaignService } from '../services/email-campaign.service';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all email campaigns
router.get('/', async (req, res) => {
  try {
    const campaigns = await prisma.emailCampaign.findMany({
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
      include: { recipients: true }
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
    const { subject, htmlTemplate, recipients } = req.body;
    
    if (!subject || !htmlTemplate || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Subject, htmlTemplate, and recipients array are required' });
    }

    const campaign = await emailCampaignService.createCampaign({ subject, htmlTemplate, recipients });
    res.status(201).json({ message: 'Campaign created successfully', id: campaign.id });
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

export default router;
