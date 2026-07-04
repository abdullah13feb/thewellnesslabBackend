import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

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

function getClientIp(req: any): string {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const ips = (xForwardedFor as string).split(',');
    return ips[0].trim();
  }
  return req.socket.remoteAddress || '';
}

async function lookupLocation(ip: string): Promise<string> {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return 'Localhost / Dev';
  }
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 2000 });
    if (res.data && res.data.status === 'success') {
      const parts = [];
      if (res.data.city) parts.push(res.data.city);
      if (res.data.regionName && res.data.regionName !== res.data.city) parts.push(res.data.regionName);
      if (res.data.country) parts.push(res.data.country);
      return parts.join(', ');
    }
  } catch (error) {
    console.error('GeoIP lookup failed for IP:', ip);
  }
  return 'Unknown Location';
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
      const ipAddress = getClientIp(req);
      const ipLocation = await lookupLocation(ipAddress);
      
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
            ...(!recipient.deviceType && { deviceType }),
            ipAddress,
            ipLocation
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

function isBotClickScanner(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  
  const botKeywords = [
    'bot', 'crawler', 'spider', 'yahoo', 'bing', 'google', 'slurp',
    'baiduspider', 'yandex', 'sogou', 'exabot', 'facebot', 'facebook',
    'ia_archiver', 'officeheaders', 'microsoft office', 'gsa-crawler',
    'adsbot-google', 'mediapartners-google', 'aqua 2.0', 'safelinks',
    'outlook-express', 'pingdom', 'uptime', 'monit', 'virus', 'threat',
    'scanner', 'firewall', 'security', 'inspect'
  ];

  return botKeywords.some(keyword => ua.includes(keyword));
}

// Click tracking endpoint
router.get('/click/:recipientId', async (req, res) => {
  const { recipientId } = req.params;
  const targetUrl = req.query.url as string;

  if (!targetUrl) {
    return res.status(400).send('Missing target URL');
  }

  const userAgent = req.headers['user-agent'];
  if (isBotClickScanner(userAgent)) {
    console.log(`Ignoring bot/scanner click with User-Agent: ${userAgent}`);
    return res.redirect(302, targetUrl);
  }

  try {
    const recipient = await prisma.emailCampaignRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, campaignId: true, clickedAt: true, deviceType: true }
    });

    // If recipient exists and this is the first time they click
    if (recipient && !recipient.clickedAt) {
      const deviceType = detectDeviceType(userAgent);
      const deviceField = getDeviceField(deviceType);
      const ipAddress = getClientIp(req);
      const ipLocation = await lookupLocation(ipAddress);
      
      const campaignUpdates: any = { clickCount: { increment: 1 } };
      
      if (!recipient.deviceType) {
        campaignUpdates[deviceField] = { increment: 1 };
      }

      await prisma.$transaction([
        prisma.emailCampaignRecipient.update({
          where: { id: recipientId },
          data: { 
            clickedAt: new Date(),
            ...(!recipient.deviceType && { deviceType }),
            ipAddress,
            ipLocation
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
