import { Router } from "express";
import { randomBytes } from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuthOrApiKey, requireAdminOrApiKey } from "../middleware/auth.js";

const router = Router();

const maskApiKey = (key: string) => {
    return key;
};

// Get all settings
router.get("/", async (req, res) => {
    try {
        const settings = await prisma.setting.findMany();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch settings" });
    }
});

// Get all API keys (Admin or API key)
router.get("/api-keys/all", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const apiKeys = await prisma.apiKey.findMany({
            orderBy: { createdAt: "desc" }
        });

        res.json(apiKeys.map((apiKey) => ({
            id: apiKey.id,
            name: apiKey.name,
            keyPreview: maskApiKey(apiKey.key),
            isActive: apiKey.isActive,
            createdAt: apiKey.createdAt,
            updatedAt: apiKey.updatedAt
        })));
    } catch (error) {
        console.error("Failed to fetch API keys:", error);
        res.status(500).json({ error: "Failed to fetch API keys" });
    }
});

// Create API key (Admin or API key)
router.post("/api-keys", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim();

        if (!name) {
            return res.status(400).json({ error: "API key name is required" });
        }

        const generatedKey = `twl_${randomBytes(24).toString("hex")}`;

        const apiKey = await prisma.apiKey.create({
            data: {
                name,
                key: generatedKey
            }
        });

        res.status(201).json({
            id: apiKey.id,
            name: apiKey.name,
            key: generatedKey,
            isActive: apiKey.isActive,
            createdAt: apiKey.createdAt
        });
    } catch (error) {
        console.error("Failed to create API key:", error);
        res.status(500).json({ error: "Failed to create API key" });
    }
});

// Toggle API key status (Admin or API key)
router.patch("/api-keys/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({ error: "isActive must be a boolean" });
        }

        const apiKey = await prisma.apiKey.update({
            where: { id },
            data: { isActive }
        });

        res.json({
            id: apiKey.id,
            name: apiKey.name,
            keyPreview: maskApiKey(apiKey.key),
            isActive: apiKey.isActive,
            createdAt: apiKey.createdAt,
            updatedAt: apiKey.updatedAt
        });
    } catch (error) {
        console.error("Failed to update API key:", error);
        res.status(500).json({ error: "Failed to update API key" });
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
router.post("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
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
