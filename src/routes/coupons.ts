import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

// Validate a coupon
router.post("/validate", async (req, res) => {
    try {
        const { code, subtotal } = req.body;
        const coupon = await prisma.coupon.findUnique({
            where: { code: code.toUpperCase() }
        });

        if (!coupon || !coupon.isActive) {
            return res.status(404).json({ error: "Invalid or inactive coupon" });
        }

        if (coupon.expiry && new Date(coupon.expiry) < new Date()) {
            return res.status(400).json({ error: "Coupon has expired" });
        }

        if (subtotal < coupon.minPurchase) {
            return res.status(400).json({ error: `Minimum purchase of AED ${coupon.minPurchase} required` });
        }

        res.json(coupon);
    } catch (error) {
        res.status(500).json({ error: "Failed to validate coupon" });
    }
});

// Admin routes
router.get("/", requireAuth, requireAdmin, async (req, res) => {
    try {
        const coupons = await prisma.coupon.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(coupons);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch coupons" });
    }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { code, discount, type, description, expiry, minPurchase } = req.body;
        const coupon = await prisma.coupon.create({
            data: {
                code: code.toUpperCase(),
                discount,
                type,
                description,
                expiry: expiry ? new Date(expiry) : null,
                minPurchase: minPurchase || 0
            }
        });
        res.json(coupon);
    } catch (error) {
        res.status(500).json({ error: "Failed to create coupon" });
    }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
        await prisma.coupon.delete({
            where: { id: req.params.id }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete coupon" });
    }
});

export default router;
