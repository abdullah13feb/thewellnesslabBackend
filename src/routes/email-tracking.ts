import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// 1x1 transparent GIF pixel
const PIXEL_BUFFER = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function detectDeviceType(userAgent: string | undefined): 'Smartphone' | 'Tablet' | 'Smartwatch' | 'Device/Laptop' {
  if (!userAgent) return 'Device/Laptop'; // Default
  const ua = userAgent.toLowerCase();
  if (ua.includes('watch') || ua.includes('wear')) return 'Smartwatch';
  if (ua.includes('tablet') || ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) return 'Tablet';
  if (ua.includes('mobile') || ua.includes('iphone') || ua.includes('android') || ua.includes('webos')) return 'Smartphone';
  return 'Device/Laptop';
}

function getDeviceField(deviceType: string) {
  if (deviceType === 'Smartphone') return 'mobileCount';
  if (deviceType === 'Tablet') return 'tabletCount';
  if (deviceType === 'Smartwatch') return 'smartwatchCount';
  return 'desktopCount';
}

// Open tracking pixel endpoint
router.get('/open/:recipientId', async (req, res) => {
  const { recipientId } = req.params;

  try {
    const recipient = await prisma.emailCampaignRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, campaignId: true, openedAt: true, deviceType: true }
    });

    // If recipient exists and this is the first time they open
    if (recipient && !recipient.openedAt) {
      const deviceType = detectDeviceType(req.headers['user-agent']);
      const deviceField = getDeviceField(deviceType);
      
      const campaignUpdates: any = { openCount: { increment: 1 } };
      
      // Only increment device count if we haven't already set the device type (e.g. from a prior click)
      if (!recipient.deviceType) {
        campaignUpdates[deviceField] = { increment: 1 };
      }

      await prisma.$transaction([
        prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: { 
            openedAt: new Date(),
            ...(!recipient.deviceType && { deviceType }) 
          }
        }),
        prisma.emailCampaign.update({
          where: { id: recipient.campaignId },
          data: campaignUpdates
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
      select: { id: true, campaignId: true, clickedAt: true, deviceType: true }
    });

    // If recipient exists and this is the first time they click
    if (recipient && !recipient.clickedAt) {
      const deviceType = detectDeviceType(req.headers['user-agent']);
      const deviceField = getDeviceField(deviceType);
      
      const campaignUpdates: any = { clickCount: { increment: 1 } };
      
      if (!recipient.deviceType) {
        campaignUpdates[deviceField] = { increment: 1 };
      }

      await prisma.$transaction([
        prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: { 
            clickedAt: new Date(),
            ...(!recipient.deviceType && { deviceType })
          }
        }),
        prisma.emailCampaign.update({
          where: { id: recipient.campaignId },
          data: campaignUpdates
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
