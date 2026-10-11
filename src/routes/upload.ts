import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// AWS S3 Configuration
const awsAccessKey = process.env.APP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY || "";
const awsSecretKey = process.env.APP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SCERET_KEY || "";
const awsSessionToken = process.env.AWS_SESSION_TOKEN || "";
const awsRegion = process.env.APP_AWS_REGION || process.env.AWS_REGION || "ap-south-1";
const s3Bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || "thewellnesslab-public-assets";

if (!awsAccessKey || !awsSecretKey) {
    console.warn("⚠️ Explicit AWS credentials not provided, will rely on IAM execution role if in Lambda.");
} else {
    const maskedSecret = awsSecretKey.substring(0, 2) + "..." + awsSecretKey.substring(awsSecretKey.length - 2);
    console.log("✅ AWS S3 Configured. Bucket: %s, Region: %s, Key: %s, Secret: %s",
        s3Bucket,
        awsRegion,
        awsAccessKey,
        maskedSecret
    );
}

export const s3 = new S3Client({
    region: awsRegion,
    credentials: awsAccessKey && awsSecretKey ? {
        accessKeyId: awsAccessKey,
        secretAccessKey: awsSecretKey,
        ...(awsSessionToken && awsAccessKey.startsWith("ASIA") ? { sessionToken: awsSessionToken } : {})
    } : undefined
});

// Helper: Determine MIME types
const MIME_TYPES: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    avif: "image/avif",
    ico: "image/x-icon",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm"
};

export function getMimeType(filename: string): string {
    const ext = path.extname(filename).replace(".", "").toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

// Helper: Upload file buffer to AWS S3
export async function uploadBufferToS3(
    fileBuffer: Buffer,
    originalName: string,
    mimeType?: string,
    folder: string = "radiant-aura"
): Promise<{ location: string; key: string; bucket: string }> {
    const ext = path.extname(originalName).toLowerCase();
    const baseName = path.basename(originalName, ext)
        .replace(/[^a-z0-9]/gi, "-")
        .replace(/-+/g, "-")
        .slice(0, 50);

    const uniqueToken = Math.random().toString(36).substring(2, 8);
    const key = `${folder}/${baseName}-${Date.now()}-${uniqueToken}${ext}`;
    const contentType = mimeType && mimeType !== "application/octet-stream" ? mimeType : getMimeType(originalName);

    const command = new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable"
    });

    await s3.send(command);
    const publicUrl = `https://${s3Bucket}.s3.${awsRegion}.amazonaws.com/${key}`;

    return {
        location: publicUrl,
        key: key,
        bucket: s3Bucket
    };
}

// Multer memory storage
const memoryStorage = multer.memoryStorage();
const rawMulter = multer({
    storage: memoryStorage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

// Middleware wrapper that processes uploaded file(s) and sends to S3
export const upload = {
    single: (fieldName: string) => {
        const multerMiddleware = rawMulter.single(fieldName);
        return async (req: Request, res: Response, next: NextFunction) => {
            multerMiddleware(req, res, async (err: any) => {
                if (err) return next(err);
                if (req.file) {
                    try {
                        const s3Result = await uploadBufferToS3(
                            req.file.buffer,
                            req.file.originalname,
                            req.file.mimetype,
                            "radiant-aura"
                        );
                        // Attach S3 details to req.file
                        (req.file as any).path = s3Result.location;
                        (req.file as any).location = s3Result.location;
                        (req.file as any).filename = s3Result.key;
                        (req.file as any).key = s3Result.key;
                        (req.file as any).url = s3Result.location;
                    } catch (uploadError) {
                        return next(uploadError);
                    }
                }
                next();
            });
        };
    },
    array: (fieldName: string, maxCount: number = 20) => {
        const multerMiddleware = rawMulter.array(fieldName, maxCount);
        return async (req: Request, res: Response, next: NextFunction) => {
            multerMiddleware(req, res, async (err: any) => {
                if (err) return next(err);
                if (req.files && Array.isArray(req.files)) {
                    try {
                        for (const file of req.files) {
                            const s3Result = await uploadBufferToS3(
                                file.buffer,
                                file.originalname,
                                file.mimetype,
                                "radiant-aura"
                            );
                            (file as any).path = s3Result.location;
                            (file as any).location = s3Result.location;
                            (file as any).filename = s3Result.key;
                            (file as any).key = s3Result.key;
                            (file as any).url = s3Result.location;
                        }
                    } catch (uploadError) {
                        return next(uploadError);
                    }
                }
                next();
            });
        };
    }
};

const router = express.Router();

/**
 * Generate AWS S3 Presigned URL for direct browser uploads.
 */
router.post("/presigned-url", async (req: Request, res: Response) => {
    try {
        const { filename = "upload.bin", contentType, folder = "radiant-aura" } = req.body;
        const ext = path.extname(filename).toLowerCase();
        const baseName = path.basename(filename, ext)
            .replace(/[^a-z0-9]/gi, "-")
            .replace(/-+/g, "-")
            .slice(0, 50);

        const uniqueToken = Math.random().toString(36).substring(2, 8);
        const key = `${folder}/${baseName}-${Date.now()}-${uniqueToken}${ext}`;
        const finalContentType = contentType || getMimeType(filename);

        const command = new PutObjectCommand({
            Bucket: s3Bucket,
            Key: key,
            ContentType: finalContentType
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        const publicUrl = `https://${s3Bucket}.s3.${awsRegion}.amazonaws.com/${key}`;

        res.json({
            success: true,
            data: {
                uploadUrl,
                publicUrl,
                key,
                bucket: s3Bucket,
                region: awsRegion,
                contentType: finalContentType
            }
        });
    } catch (error: any) {
        console.error("Presigned URL error:", error);
        res.status(500).json({ success: false, error: error.message || "Failed to generate presigned upload URL" });
    }
});

/**
 * Legacy signature endpoint
 */
router.get("/signature", async (req: Request, res: Response) => {
    try {
        const filename = (req.query.filename as string) || "asset.bin";
        const folder = (req.query.folder as string) || "radiant-aura";
        const contentType = (req.query.contentType as string) || getMimeType(filename);

        const ext = path.extname(filename).toLowerCase();
        const baseName = path.basename(filename, ext)
            .replace(/[^a-z0-9]/gi, "-")
            .replace(/-+/g, "-")
            .slice(0, 50);

        const uniqueToken = Math.random().toString(36).substring(2, 8);
        const key = `${folder}/${baseName}-${Date.now()}-${uniqueToken}${ext}`;

        const command = new PutObjectCommand({
            Bucket: s3Bucket,
            Key: key,
            ContentType: contentType
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        const publicUrl = `https://${s3Bucket}.s3.${awsRegion}.amazonaws.com/${key}`;

        res.json({
            success: true,
            data: {
                provider: "s3",
                uploadUrl,
                publicUrl,
                key,
                bucket: s3Bucket,
                region: awsRegion
            }
        });
    } catch (error: any) {
        console.error("Signature error:", error);
        res.status(500).json({ success: false, error: error.message || "Failed to generate upload URL" });
    }
});

/**
 * Single image upload through backend to S3
 */
router.post("/image", upload.single("image"), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "No file uploaded" });
        }

        const file = req.file as any;
        res.json({
            success: true,
            data: {
                url: file.path || file.location,
                filename: file.filename || file.key,
                originalName: file.originalname,
                size: file.size,
                mimetype: file.mimetype
            }
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: "Failed to upload image" });
    }
});

/**
 * Multiple images upload through backend to S3
 */
router.post("/images", upload.array("images", 20), (req: Request, res: Response) => {
    try {
        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({ success: false, error: "No files uploaded" });
        }

        const fileUrls = (req.files as any[]).map((file) => ({
            url: file.path || file.location,
            filename: file.filename || file.key,
            originalName: file.originalname,
            size: file.size,
            mimetype: file.mimetype
        }));

        res.json({
            success: true,
            data: fileUrls
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: "Failed to upload images" });
    }
});

/**
 * Delete image / asset from S3
 */
router.delete("/image/*", async (req: Request, res: Response) => {
    try {
        const rawKey = req.params[0] || (req.params as any).public_id;
        if (!rawKey) {
            return res.status(400).json({ success: false, error: "File key required" });
        }

        const key = decodeURIComponent(rawKey);
        await s3.send(new DeleteObjectCommand({
            Bucket: s3Bucket,
            Key: key
        }));

        res.json({ success: true, message: "File deleted successfully from AWS S3" });
    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({ success: false, error: "Failed to delete file from AWS S3" });
    }
});

/**
 * Test AWS S3 Connection
 */
router.get("/test-connection", async (req: Request, res: Response) => {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: s3Bucket }));
        res.json({
            success: true,
            message: "AWS S3 connection successful",
            bucket: s3Bucket,
            region: awsRegion
        });
    } catch (error: any) {
        console.error("AWS S3 test failed:", error);
        res.status(500).json({
            success: false,
            error: error.message || "AWS S3 connection failed",
            details: error
        });
    }
});

export default router;
