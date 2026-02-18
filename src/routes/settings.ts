import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

// Get all settings
router.get("/", async (req, res) => {
    try {
        const settings = await prisma.setting.findMany();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch settings" });
    }
});

// Get setting by key
router.get("/:key", async (req, res) => {
    try {
        const { key } = req.params;
        const setting = await prisma.setting.findUnique({
            where: { key }
        });
        res.json(setting);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch setting" });
    }
});

// Update or create setting (Admin only)
router.post("/", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { key, value } = req.body;
        const setting = await prisma.setting.upsert({
            where: { key },
            update: { value },
            create: { key, value }
        });
        res.json(setting);
    } catch (error) {
        res.status(500).json({ error: "Failed to update setting" });
    }
});

export default router;
