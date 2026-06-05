import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { rescheduleJob } from '../services/scheduler.js';
import { runScrapingJob } from '../services/scrapingService.js';

const router = Router();
const prisma = new PrismaClient();

// GET current configuration
router.get('/config', async (req, res) => {
  try {
    const config = await prisma.scrapingConfig.findFirst();
    res.json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// UPDATE or CREATE configuration
router.post('/config', async (req, res) => {
  try {
    const { provider, scheduleCron, apifyToken, googleMapsApiKey, isActive, searchQuery } = req.body;

    let config = await prisma.scrapingConfig.findFirst();

    if (config) {
      config = await prisma.scrapingConfig.update({
        where: { id: config.id },
        data: {
          provider,
          scheduleCron,
          apifyToken,
          googleMapsApiKey,
          isActive,
          searchQuery
        }
      });
    } else {
      config = await prisma.scrapingConfig.create({
        data: {
          provider,
          scheduleCron,
          apifyToken,
          googleMapsApiKey,
          isActive,
          searchQuery
        }
      });
    }

    // Refresh the scheduler with new config
    await rescheduleJob();

    res.json({ success: true, data: config, message: 'Configuration saved and scheduler updated.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// TRIGGER manual run
router.post('/trigger', async (req, res) => {
    try {
        // Run asynchronously without blocking the response
        runScrapingJob();
        res.json({ success: true, message: 'Scraping job triggered manually.' });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
