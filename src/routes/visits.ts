import { Router } from 'express';
import { VisitSchedulerService } from '../services/visit-scheduler.service.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// POST /api/visits/discover
router.post('/discover', async (req, res) => {
  try {
    const { location, categories, maxVisits } = req.body;
    if (!location || !categories || !Array.isArray(categories)) {
      return res.status(400).json({ error: 'Location and categories array are required' });
    }

    const businesses = await VisitSchedulerService.discoverBusinesses(location, categories, maxVisits);
    res.json({ businesses });
  } catch (error: any) {
    console.error('Error in discover:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/visits/schedule
router.post('/schedule', async (req, res) => {
  try {
    const { date, salespersonId, startLocation, endLocation, businesses } = req.body;
    
    if (!date || !businesses || businesses.length === 0) {
      return res.status(400).json({ error: 'Date and businesses array are required' });
    }

    const result = await VisitSchedulerService.generateSchedule({
      date,
      salespersonId,
      startLocation,
      endLocation,
      businesses
    });

    res.json(result);
  } catch (error: any) {
    console.error('Error in schedule generation:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// GET /api/visits/schedules
router.get('/schedules', async (req, res) => {
  try {
    const schedules = await prisma.visitSchedule.findMany({
      include: {
        visits: {
          include: {
            business: true
          },
          orderBy: {
            orderIndex: 'asc'
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
    res.json({ schedules });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/visits/:visitId
router.put('/:visitId', async (req, res) => {
  try {
    const { visitId } = req.params;
    const updateData = req.body; // Allows updating status, checklists, notes, interestLevel

    const visit = await prisma.visit.update({
      where: { id: visitId },
      data: updateData,
    });

    res.json({ visit });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
