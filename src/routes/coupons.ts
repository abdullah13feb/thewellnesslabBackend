import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAuthOrApiKey, requireAdminOrApiKey } from "../middleware/auth.js";

const router = Router();

// Validate a coupon
router.post("/validate", async (req, res) => {
    try {
        const { code, subtotal, items } = req.body;
        if (!code) {
            return res.status(400).json({ error: "Coupon code is required" });
        }

        const coupon = await prisma.coupon.findUnique({
            where: { code: code.toUpperCase() }
        });

        if (!coupon || !coupon.isActive) {
            return res.status(404).json({ error: "Invalid or inactive coupon" });
        }

        if (coupon.expiry && new Date(coupon.expiry) < new Date()) {
            return res.status(400).json({ error: "Coupon has expired" });
        }

        const parsedSubtotal = Number(subtotal) || 0;
        if (parsedSubtotal < coupon.minPurchase) {
            return res.status(400).json({ error: `Minimum purchase of AED ${coupon.minPurchase} required` });
        }

        // Check product applicability if restricted
        let eligibleSubtotal = parsedSubtotal;
        if (coupon.applicableProducts && coupon.applicableProducts.length > 0) {
            if (!Array.isArray(items) || items.length === 0) {
                // If items not provided, check if cart meets restriction or prompt items needed
                return res.status(400).json({
                    error: `Coupon ${coupon.code} is only valid on specific products: ${coupon.applicableProducts.join(", ")}. Please ensure eligible items are in your cart.`
                });
            }

            // Fetch product records from DB for accurate identification
            const productIdsOrSlugs = items.map((it: any) => String(it.productId || it.id || ""));
            const dbProducts = await prisma.product.findMany({
                where: {
                    OR: [
                        { id: { in: productIdsOrSlugs } },
                        { slug: { in: productIdsOrSlugs } }
                    ]
                },
                select: { id: true, slug: true, name: true }
            });

            const productMap = new Map<string, { id: string; slug: string; name: string }>();
            dbProducts.forEach(p => {
                productMap.set(p.id, p);
                productMap.set(p.slug, p);
            });

            const allowedSet = new Set(coupon.applicableProducts.map(p => p.toLowerCase().trim()));

            const eligibleItems = items.filter((item: any) => {
                const rawId = String(item.productId || item.id || "");
                const rawSlug = String(item.slug || "");
                const rawName = String(item.name || "").toLowerCase();

                const dbProduct = productMap.get(rawId) || (rawSlug ? productMap.get(rawSlug) : undefined);
                const dbSlug = dbProduct?.slug?.toLowerCase();
                const dbId = dbProduct?.id?.toLowerCase();
                const dbName = dbProduct?.name?.toLowerCase();

                // Check against allowedSet
                for (const allowed of allowedSet) {
                    if (allowed === rawId.toLowerCase() || allowed === rawSlug.toLowerCase()) return true;
                    if (dbSlug && allowed === dbSlug) return true;
                    if (dbId && allowed === dbId) return true;
                    if (allowed.includes("pro") && (rawName.includes("rex pro") || (dbName && dbName.includes("rex pro")))) return true;
                    if (allowed.includes("core") && (rawName.includes("rex core") || (dbName && dbName.includes("rex core")))) return true;
                    if (allowed.includes("ultra") && (rawName.includes("rex ultra") || (dbName && dbName.includes("rex ultra")))) return true;
                    if (allowed.includes("prestige") && (rawName.includes("rex prestige") || (dbName && dbName.includes("rex prestige")))) return true;
                }
                return false;
            });

            if (eligibleItems.length === 0) {
                const readableNames = coupon.applicableProducts.map(p => {
                    if (p.includes("pro")) return "Rex Pro";
                    if (p.includes("core")) return "Rex Core";
                    if (p.includes("ultra")) return "Rex Ultra";
                    if (p.includes("prestige")) return "Rex Prestige";
                    return p;
                }).join(" & ");

                return res.status(400).json({
                    error: `Coupon ${coupon.code} is only applicable on ${readableNames}. Not applicable on Ultra or Prestige.`
                });
            }

            eligibleSubtotal = eligibleItems.reduce((sum: number, it: any) => {
                const itemPrice = Number(it.price) || 0;
                const itemQty = Number(it.quantity) || 1;
                return sum + (itemPrice * itemQty);
            }, 0);
        }

        let calculatedDiscount = 0;
        if (coupon.type === "PERCENTAGE") {
            calculatedDiscount = (eligibleSubtotal * coupon.discount) / 100;
        } else {
            calculatedDiscount = Math.min(coupon.discount, eligibleSubtotal);
        }

        res.json({
            ...coupon,
            discountAmount: calculatedDiscount,
            eligibleSubtotal
        });
    } catch (error) {
        console.error("Failed to validate coupon:", error);
        res.status(500).json({ error: "Failed to validate coupon" });
    }
});

// Admin routes
router.get("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const coupons = await prisma.coupon.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(coupons);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch coupons" });
    }
});

router.post("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const { code, discount, type, description, expiry, minPurchase, applicableProducts } = req.body;
        const coupon = await prisma.coupon.create({
            data: {
                code: code.toUpperCase(),
                discount: Number(discount),
                type: type || "FIXED",
                description: description || null,
                expiry: expiry ? new Date(expiry) : null,
                minPurchase: minPurchase ? Number(minPurchase) : 0,
                applicableProducts: Array.isArray(applicableProducts) ? applicableProducts : []
            }
        });
        res.json(coupon);
    } catch (error) {
        console.error("Failed to create coupon:", error);
        res.status(500).json({ error: "Failed to create coupon" });
    }
});

router.put("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const { code, discount, type, description, expiry, minPurchase, isActive, applicableProducts } = req.body;
        const coupon = await prisma.coupon.update({
            where: { id: req.params.id },
            data: {
                ...(code ? { code: code.toUpperCase() } : {}),
                ...(discount !== undefined ? { discount: Number(discount) } : {}),
                ...(type ? { type } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(expiry !== undefined ? { expiry: expiry ? new Date(expiry) : null } : {}),
                ...(minPurchase !== undefined ? { minPurchase: Number(minPurchase) || 0 } : {}),
                ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
                ...(applicableProducts !== undefined ? { applicableProducts: Array.isArray(applicableProducts) ? applicableProducts : [] } : {})
            }
        });
        res.json(coupon);
    } catch (error) {
        console.error("Failed to update coupon:", error);
        res.status(500).json({ error: "Failed to update coupon" });
    }
});

router.delete("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
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
