import { Router, Request, Response } from "express";
import { ApiResponse } from "../types/index.js";
import prisma from "../lib/prisma.js";
import { requireAuthOrApiKey, requireAdminOrApiKey } from "../middleware/auth.js";

const router = Router();

// GET all products
router.get("/", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const products = await prisma.product.findMany();
    res.json({ success: true, data: products });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch products" });
  }
});

// GET single product (by ID or Slug)
router.get("/:idOrSlug", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { idOrSlug } = req.params;

    // Convert to number strictly if you were using numeric IDs but here IDs are CUIds/UUIDs (string).
    // So we just check both OR.

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { id: idOrSlug },
          { slug: idOrSlug }
        ]
      },
    });
    if (!product) {
      return res
        .status(404)
        .json({ success: false, error: "Product not found" });
    }
    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch product" });
  }
});

// CREATE product
router.post("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const {
      name, price, description, image, images,
      category, stock, slug, specs, includes, tag, tagline, trustBadges, comparison
    } = req.body;

    if (!name || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: "Name and price are required" });
    }

    // Auto-generate slug if not provided
    const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const product = await prisma.product.create({
      data: {
        name,
        slug: finalSlug,
        price: parseFloat(price),
        description,
        image: image || (Array.isArray(images) && images.length > 0 ? images[0] : null),
        images: Array.isArray(images) ? images : [],
        category,
        stock: parseInt(stock) || 0,
        specs: specs || {},
        includes: includes || {},
        tag,
        tagline,
        trustBadges: trustBadges || [],
        faq: req.body.faq || [],
        comparison: comparison || {}
      },
    });

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to create product" });
  }
});

// UPDATE product
router.put("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    console.log("Update Product Body:", req.body);
    const {
      name, price, description, image, images,
      category, stock, specs, includes, tag, tagline, trustBadges, faq, comparison
    } = req.body;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(description && { description }),
        ...(image && { image }),
        ...(images && { images }),
        ...(category && { category }),
        ...(stock !== undefined && { stock: parseInt(stock) }),
        ...(specs && { specs }),
        ...(includes && { includes }),
        ...(tag !== undefined && { tag }),
        ...(tagline !== undefined && { tagline }),
        ...(trustBadges !== undefined && { trustBadges }),
        ...(faq !== undefined && { faq }),
        ...(comparison !== undefined && { comparison }),
      },
    });

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update product" });
  }
});

// DELETE product
router.delete("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<null>>) => {
  try {
    await prisma.product.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete product" });
  }
});

export default router;
