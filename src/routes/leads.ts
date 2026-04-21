import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAdminOrApiKey, requireAuthOrApiKey } from "../middleware/auth.js";

const router = Router();

// --- Status Management Routes ---

// Get all lead statuses
router.get("/statuses", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const statuses = await prisma.leadStatus.findMany({
      orderBy: { order: "asc" },
    });
    res.json({ success: true, data: statuses });
  } catch (error) {
    console.error("Error fetching statuses:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Create a new status
router.post("/statuses", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { label, value, color, order } = req.body;
    if (!label || !value) {
      return res.status(400).json({ success: false, error: "Label and value are required" });
    }
    const status = await prisma.leadStatus.create({
      data: { label, value, color, order: order || 0 },
    });
    res.status(201).json({ success: true, data: status });
  } catch (error) {
    console.error("Error creating status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update a status
router.patch("/statuses/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, value, color, order } = req.body;
    const status = await prisma.leadStatus.update({
      where: { id },
      data: { label, value, color, order },
    });
    res.json({ success: true, data: status });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete a status
router.delete("/statuses/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.leadStatus.delete({
      where: { id },
    });
    res.json({ success: true, message: "Status deleted successfully" });
  } catch (error) {
    console.error("Error deleting status:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// --- Lead Management Routes ---

// Create a lead - Protected by API key (X-API-KEY) or Admin
router.post("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { name, phone, email, source, status, company, jobTitle, city, dynamicFields } = req.body;

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
        dynamicFields: dynamicFields || {},
      },
    });

    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Get all leads - Protected by Admin
router.get("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
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
router.get("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
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
router.patch("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, name, phone, email, source, company, jobTitle, city, dynamicFields } = req.body;

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
        dynamicFields,
      },
    });

    res.json({ success: true, data: lead });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Delete lead
router.delete("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
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
