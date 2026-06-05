import { Router } from 'express';
import { VisitSchedulerService } from '../services/visit-scheduler.service.js';
import { PrismaClient } from '@prisma/client';
import { sendWhatsappMessage } from '../lib/whatsappGateway.js';

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

// POST /api/visits/schedules/:id/send-whatsapp
router.post('/schedules/:id/send-whatsapp', async (req, res) => {
  try {
    const { id } = req.params;
    
    const schedule = await prisma.visitSchedule.findUnique({
      where: { id },
      include: {
        salesperson: true,
        visits: true
      }
    });

    if (!schedule || !schedule.salesperson || !schedule.salesperson.whatsappNumber) {
      return res.status(400).json({ error: 'Salesperson or WhatsApp number not found for this schedule.' });
    }

    const portalUrl = process.env.FRONTEND_URL || "https://admin.thewellnesslab.ae";
    const message = `Hello ${schedule.salesperson.name}!\n\nYour field visit route for ${schedule.date.toDateString()} is ready. You have ${schedule.visits.length} visits.\n\nClick here to view your schedule: ${portalUrl}/admin/visits`;

    const success = await sendWhatsappMessage("default", schedule.salesperson.whatsappNumber, message);
    
    if (success) {
      res.json({ success: true, message: 'WhatsApp itinerary sent!' });
    } else {
      res.status(500).json({ error: 'Gateway rejected the message. Verify session and phone number format.' });
    }
  } catch (error: any) {
    console.error('Failed to send manual WhatsApp itinerary:', error);
    res.status(500).json({ error: error.message || 'Failed to send WhatsApp message. Make sure the gateway is connected.' });
  }
});

export default router;
