import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

// GET all salespersons
router.get("/", async (req, res) => {
  try {
    const salespersons = await prisma.salesperson.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ salespersons });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// POST new salesperson
router.post("/", async (req, res) => {
  try {
    const { name, whatsappNumber, isActive } = req.body;
    
    if (!name || !whatsappNumber) {
      return res.status(400).json({ error: "Name and WhatsApp number are required" });
    }

    const salesperson = await prisma.salesperson.create({
      data: {
        name,
        whatsappNumber,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    res.status(201).json({ salesperson });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// PUT update salesperson
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, whatsappNumber, isActive } = req.body;

    const salesperson = await prisma.salesperson.update({
      where: { id },
      data: { name, whatsappNumber, isActive },
    });

    res.json({ salesperson });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// DELETE salesperson
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.salesperson.delete({
      where: { id },
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

export default router;
