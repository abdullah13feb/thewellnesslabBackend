import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get all email templates
router.get('/', async (req, res) => {
  try {
    const templates = await prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new email template
router.post('/', async (req, res) => {
  try {
    const { name, subject, html } = req.body;
    if (!name || !html) {
      return res.status(400).json({ error: 'Name and HTML content are required' });
    }

    const template = await prisma.emailTemplate.create({
      data: { name, subject, html },
    });
    res.status(201).json({ message: 'Template created successfully', id: template.id });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A template with this name already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Update an email template
router.put('/:id', async (req, res) => {
  try {
    const { name, subject, html } = req.body;
    const template = await prisma.emailTemplate.update({
      where: { id: req.params.id },
      data: { name, subject, html },
    });
    res.json({ message: 'Template updated successfully', id: template.id });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Delete an email template
router.delete('/:id', async (req, res) => {
  try {
    await prisma.emailTemplate.delete({
      where: { id: req.params.id },
    });
    res.json({ message: 'Template deleted successfully' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
