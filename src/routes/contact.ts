import { Router, Request, Response } from "express";
import { ApiResponse } from "../types/index.js";
import prisma from "../lib/prisma.js";
import { requireAuthOrApiKey, requireAdminOrApiKey } from "../middleware/auth.js";

const router = Router();

// POST submit contact form
router.post("/", async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
        const { name, email, phone, subject, message } = req.body;

        if (!name || !email || !message) {
            return res
                .status(400)
                .json({ success: false, error: "Name, email, and message are required" });
        }

        const contactSubmission = await prisma.contactSubmission.create({
            data: {
                name,
                email,
                phone,
                subject,
                message,
                status: "NEW"
            },
        });

        res.status(201).json({ success: true, data: contactSubmission, message: "Message sent successfully" });
    } catch (error) {
        console.error("Contact submission error:", error);
        res.status(500).json({ success: false, error: "Failed to send message" });
    }
});

// GET all contact submissions (Admin only)
router.get("/", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
        const submissions = await prisma.contactSubmission.findMany({
            orderBy: { createdAt: "desc" },
        });
        res.json({ success: true, data: submissions });
    } catch (error) {
        console.error("Fetch submissions error:", error);
        res.status(500).json({ success: false, error: "Failed to fetch messages" });
    }
});

// UPDATE submission status
router.put("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
        const { status } = req.body;
        const submission = await prisma.contactSubmission.update({
            where: { id: req.params.id },
            data: { status },
        });
        res.json({ success: true, data: submission });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to update status" });
    }
});

// DELETE submission
router.delete("/:id", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
        await prisma.contactSubmission.delete({
            where: { id: req.params.id },
        });
        res.json({ success: true, message: "Message deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to delete message" });
    }
});

export default router;
