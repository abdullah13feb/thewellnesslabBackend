import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// 1x1 transparent GIF pixel
const PIXEL_BUFFER = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Open tracking pixel endpoint
router.get('/open/:recipientId', async (req, res) => {
  const { recipientId } = req.params;

  try {
    const recipient = await prisma.emailCampaignRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, campaignId: true, openedAt: true }
    });

    // If recipient exists and this is the first time they open
    if (recipient && !recipient.openedAt) {
      await prisma.$transaction([
        prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: { openedAt: new Date() }
        }),
        prisma.emailCampaign.update({
          where: { id: recipient.campaignId },
          data: { openCount: { increment: 1 } }
        })
      ]);
    }
  } catch (error) {
    console.error('Error tracking open:', error);
  }

  // Always return the pixel
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL_BUFFER.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  });
  res.end(PIXEL_BUFFER);
});

// Click tracking endpoint
router.get('/click/:recipientId', async (req, res) => {
  const { recipientId } = req.params;
  const targetUrl = req.query.url as string;

  if (!targetUrl) {
    return res.status(400).send('Missing target URL');
  }

  try {
    const recipient = await prisma.emailCampaignRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, campaignId: true, clickedAt: true }
    });

    // If recipient exists and this is the first time they click
    if (recipient && !recipient.clickedAt) {
      await prisma.$transaction([
        prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: { clickedAt: new Date() }
        }),
        prisma.emailCampaign.update({
          where: { id: recipient.campaignId },
          data: { clickCount: { increment: 1 } }
        })
      ]);
    }
  } catch (error) {
    console.error('Error tracking click:', error);
  }

  // Redirect to original URL
  res.redirect(302, targetUrl);
});

export default router;
