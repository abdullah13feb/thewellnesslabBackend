import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { upload } from "./upload.js";
import { requireAuth } from "../middleware/auth.js";
import { v2 as cloudinary } from "cloudinary";

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

// Create/Upload a new media asset
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

// Delete a media asset
router.delete("/:id", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const media = await prisma.mediaAsset.findUnique({ where: { id } });

        if (!media) {
            return res.status(404).json({ error: "Media asset not found" });
        }

        // Attempt to delete the file from Cloudinary (extract public_id from URL)
        try {
            const urlParts = media.url.split("/");
            const uploadIndex = urlParts.findIndex((part) => part === "upload");
            if (uploadIndex !== -1 && urlParts.length > uploadIndex + 2) {
                // E.g. radiant-aura/file-name-timestamp-token
                const publicIdWithExt = urlParts.slice(uploadIndex + 2).join("/");
                const publicId = publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf("."));
                
                // Configure resource type for Cloudinary destroy ('raw' for docs, 'video' for video, default is 'image')
                let destroyType = "image";
                if (media.type === "DOCUMENT") {
                    destroyType = "raw";
                } else if (media.type === "VIDEO") {
                    destroyType = "video";
                }

                await cloudinary.uploader.destroy(publicId, { resource_type: destroyType });
            }
        } catch (cloudinaryError) {
            console.error("Failed to delete asset from Cloudinary:", cloudinaryError);
        }

        await prisma.mediaAsset.delete({ where: { id } });
        res.json({ message: "Media asset deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
