import express, { Request, Response } from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Validate credentials
const missingKeys = [];
if (!process.env.CLOUDINARY_CLOUD_NAME) missingKeys.push("CLOUDINARY_CLOUD_NAME");
if (!process.env.CLOUDINARY_API_KEY) missingKeys.push("CLOUDINARY_API_KEY");
if (!process.env.CLOUDINARY_API_SECRET) missingKeys.push("CLOUDINARY_API_SECRET");

if (missingKeys.length > 0) {
    console.error("❌ Cloudinary credentials missing:", missingKeys.join(", "));
} else {
    const secret = process.env.CLOUDINARY_API_SECRET || "";
    const maskedSecret = secret.substring(0, 2) + "..." + secret.substring(secret.length - 2);
    console.log("✅ Cloudinary Configured. Cloud: %s, API Key: %s, Secret: %s",
        process.env.CLOUDINARY_CLOUD_NAME,
        process.env.CLOUDINARY_API_KEY,
        maskedSecret
    );
}

const router = express.Router();

// Configure Cloudinary Storage
const storage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'radiant-aura',
        resource_type: 'image',
        allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        public_id: (req: Request, file: Express.Multer.File) => {
            const ext = path.extname(file.originalname);
            const name = path.basename(file.originalname, ext)
                .replace(/[^a-z0-9]/gi, '-')
                .replace(/-+/g, '-')
                .slice(0, 50);

            return `${name}-${Date.now()}`;
        }
    } as any
});

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

// Single image upload
router.post("/image", upload.single("image"), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded" });
        }

        res.json({
            success: true,
            data: {
                url: req.file.path,
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
            },
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: "Failed to upload image" });
    }
});

// Multiple images upload
router.post("/images", upload.array("images", 10), (req: Request, res: Response) => {
    try {
        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({ success: false, error: "No files uploaded" });
        }

        const fileUrls = (req.files as Express.Multer.File[]).map((file) => ({
            url: file.path,
            filename: file.filename,
            originalName: file.originalname,
            size: file.size,
        }));

        res.json({
            success: true,
            data: fileUrls,
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: "Failed to upload images" });
    }
});

// Delete image
router.delete("/image/:public_id", async (req: Request, res: Response) => {
    try {
        const { public_id } = req.params;
        await cloudinary.uploader.destroy(public_id);
        res.json({ success: true, message: "File deleted successfully from Cloudinary" });
    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({ success: false, error: "Failed to delete image" });
    }
});

// Test Cloudinary Connection
router.get("/test-connection", async (req: Request, res: Response) => {
    try {
        // Try to ping cloudinary API
        const result = await cloudinary.api.ping();
        res.json({
            success: true,
            message: "Cloudinary connection successful",
            result
        });
    } catch (error: any) {
        console.error("Cloudinary test failed:", error);
        res.status(500).json({
            success: false,
            error: error.message || "Cloudinary connection failed",
            details: error
        });
    }
});

export default router;
