import { Router } from 'express';
import { emailSenderService } from '../services/email-sender.service.js';

const router = Router();

// Get all sender accounts
router.get('/', async (req, res) => {
  try {
    const senders = await emailSenderService.getAllSenders();
    // Omit passwords from the response
    const safeSenders = senders.map(s => {
      const { password, ...rest } = s;
      return rest;
    });
    res.json(safeSenders);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new sender account
router.post('/', async (req, res) => {
  try {
    const { name, email, password, smtpHost, smtpPort } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const sender = await emailSenderService.createSender({ name, email, password, smtpHost, smtpPort });
    res.status(201).json({ message: 'Sender account created successfully', id: sender.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Update an existing sender account
router.put('/:id', async (req, res) => {
  try {
    const sender = await emailSenderService.updateSender(req.params.id, req.body);
    res.json({ message: 'Sender account updated successfully', id: sender.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Delete a sender account
router.delete('/:id', async (req, res) => {
  try {
    await emailSenderService.deleteSender(req.params.id);
    res.json({ message: 'Sender account deleted successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
