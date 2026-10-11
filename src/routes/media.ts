import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { upload, s3 } from "./upload.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

// Get all media assets with optional search and type filter
router.get("/", async (req, res) => {
    try {
        const { search, type } = req.query;
        const whereClause: any = {};

        if (search) {
            whereClause.name = {
                contains: search as string,
                mode: "insensitive",
            };
        }

        if (type && type !== "ALL") {
            whereClause.type = type as string;
        }

        const media = await prisma.mediaAsset.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
        });

        res.json(media);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create/Upload a new media asset to AWS S3
router.post("/", requireAuth, upload.single("file"), async (req, res) => {
    try {
        const { name, type } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        if (!type) {
            return res.status(400).json({ error: "Type is required" });
        }

        const originalName = req.file.originalname;
        const defaultName = originalName.substring(0, originalName.lastIndexOf(".")) || originalName;
        const finalName = name && name.trim() !== "" ? name.trim() : defaultName;

        const mediaAsset = await prisma.mediaAsset.create({
            data: {
                name: finalName,
                url: req.file.path,
                type: type.toUpperCase(), // IMAGE, VIDEO, DOCUMENT
                fileSize: req.file.size,
                mimeType: req.file.mimetype,
            },
        });

        res.status(201).json(mediaAsset);
    } catch (error: any) {
        console.error("Media upload error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Delete a media asset from AWS S3 & Database
router.delete("/:id", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const media = await prisma.mediaAsset.findUnique({ where: { id } });

        if (!media) {
            return res.status(404).json({ error: "Media asset not found" });
        }

        // Attempt to delete the file from AWS S3
        try {
            const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "thewellnesslab-public-assets";
            let s3Key: string | null = null;

            if (media.url.includes("amazonaws.com/")) {
                const parts = media.url.split("amazonaws.com/");
                if (parts[1]) {
                    s3Key = decodeURIComponent(parts[1]);
                }
            } else if (media.url.includes("cloudinary.com")) {
                // If legacy Cloudinary URL exists, extract key
                const urlParts = media.url.split("/");
                const uploadIndex = urlParts.findIndex((part) => part === "upload");
                if (uploadIndex !== -1 && urlParts.length > uploadIndex + 2) {
                    s3Key = urlParts.slice(uploadIndex + 2).join("/");
                }
            }

            if (s3Key) {
                await s3.send(new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: s3Key
                }));
            }
        } catch (s3Error) {
            console.error("Failed to delete asset from AWS S3:", s3Error);
        }

        await prisma.mediaAsset.delete({ where: { id } });
        res.json({ message: "Media asset deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
