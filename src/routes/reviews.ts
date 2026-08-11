import { Router, Request, Response } from "express";
import { ApiResponse } from "../types/index.js";
import prisma from "../lib/prisma.js";

const router = Router();

// POST /api/reviews - Public endpoint to submit a review (defaults to status: "pending")
router.post("/", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { name, rating, comment, productId, productName, verified } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Name is required" });
    }

    if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: "Rating must be between 1 and 5" });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({ success: false, error: "Review comments writeup is required" });
    }

    const review = await (prisma as any).review.create({
      data: {
        name: name.trim(),
        rating: Math.round(rating),
        comment: comment.trim(),
        status: "pending",
        productId: productId || null,
        productName: productName || null,
        verified: typeof verified === "boolean" ? verified : true,
      },
    });

    return res.status(201).json({
      success: true,
      data: review,
      message: "Thank you! Your review has been submitted and is pending approval.",
    });
  } catch (error) {
    console.error("Submit review error:", error);
    return res.status(500).json({ success: false, error: "Failed to submit review" });
  }
});

// GET /api/reviews - Public endpoint to get ONLY approved reviews
router.get("/", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { productId } = req.query;

    const whereClause: any = {
      status: "approved",
    };

    if (productId && typeof productId === "string") {
      whereClause.productId = productId;
    }

    const reviews = await (prisma as any).review.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    // Calculate total count and average rating of approved reviews
    const totalCount = reviews.length;
    const totalRatingSum = reviews.reduce((sum: number, r: any) => sum + (r.rating || 5), 0);
    const averageRating = totalCount > 0 ? parseFloat((totalRatingSum / totalCount).toFixed(1)) : 5.0;

    return res.json({
      success: true,
      data: {
        reviews,
        totalCount,
        averageRating,
      },
    });
  } catch (error) {
    console.error("Fetch public approved reviews error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch reviews" });
  }
});

// GET /api/reviews/admin/all - Endpoint to get ALL reviews (pending, approved, rejected) for CRM / Admin Portal
router.get("/admin/all", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const reviews = await (prisma as any).review.findMany({
      orderBy: { createdAt: "desc" },
    });

    const stats = {
      total: reviews.length,
      pending: reviews.filter((r: any) => r.status === "pending").length,
      approved: reviews.filter((r: any) => r.status === "approved").length,
      rejected: reviews.filter((r: any) => r.status === "rejected").length,
    };

    return res.json({
      success: true,
      data: {
        reviews,
        stats,
      },
    });
  } catch (error) {
    console.error("Fetch all admin reviews error:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch admin reviews" });
  }
});

// PUT /api/reviews/admin/:id/status - Update review status (approve/reject/pending)
router.put("/admin/:id/status", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { id } = req.params;
    const { status, verified } = req.body;

    if (status && !["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status value" });
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (typeof verified === "boolean") updateData.verified = verified;

    const review = await (prisma as any).review.update({
      where: { id },
      data: updateData,
    });

    return res.json({
      success: true,
      data: review,
      message: `Review ${status || "updated"} successfully`,
    });
  } catch (error) {
    console.error("Update review status error:", error);
    return res.status(500).json({ success: false, error: "Failed to update review status" });
  }
});

// DELETE /api/reviews/admin/:id - Delete review
router.delete("/admin/:id", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { id } = req.params;
    await (prisma as any).review.delete({
      where: { id },
    });
    return res.json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    console.error("Delete review error:", error);
    return res.status(500).json({ success: false, error: "Failed to delete review" });
  }
});

export default router;
