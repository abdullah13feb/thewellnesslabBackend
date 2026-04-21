import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAdminOrApiKey } from "../middleware/auth.js";

const router = Router();

// Create a lead - Protected by API key (X-API-KEY) or Admin
router.post("/", requireAdminOrApiKey, async (req, res) => {
  try {
    const { name, phone, email, source, status, company, jobTitle, city } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }

    const lead = await prisma.lead.create({
      data: {
        name,
        phone,
        email,
        source,
        status: status || "NEW",
        company,
        jobTitle,
        city,
      },
    });

    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get all leads - Protected by Admin
router.get("/", requireAdminOrApiKey, async (req, res) => {
  try {
    const leads = await prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: leads });
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get lead by ID - Protected by Admin
router.get("/:id", requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
    });

    if (!lead) {
      return res.status(404).json({ success: false, error: "Lead not found" });
    }

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error("Error fetching lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update lead status or details
router.patch("/:id", requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, name, phone, email, source, company, jobTitle, city } = req.body;

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        status,
        name,
        phone,
        email,
        source,
        company,
        jobTitle,
        city,
      },
    });

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete lead
router.delete("/:id", requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.lead.delete({
      where: { id },
    });

    res.json({ success: true, message: "Lead deleted successfully" });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
