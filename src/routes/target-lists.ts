import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import multer from "multer";
import os from "os";
import fs from "fs";
import csv from "csv-parser";
import validator from "validator";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();
const upload = multer({ dest: os.tmpdir() });

// Get all target lists (metadata only, omitting large emails array for performance)
router.get("/", async (req, res) => {
    try {
        const targetLists = await prisma.targetList.findMany({
            select: {
                id: true,
                name: true,
                totalCount: true,
                validCount: true,
                invalidCount: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(targetLists);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get a specific target list with all email records
router.get("/:id", async (req, res) => {
    try {
        const targetList = await prisma.targetList.findUnique({
            where: { id: req.params.id },
        });
        if (!targetList) {
            return res.status(404).json({ error: "Target list not found" });
        }
        res.json(targetList);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Upload and validate a new target list
router.post("/", requireAuth, upload.single("file"), async (req, res) => {
    try {
        const { name } = req.body;
        const file = req.file;

        if (!name) {
            if (file) fs.unlink(file.path, () => {});
            return res.status(400).json({ error: "Target list name is required" });
        }

        if (!file) {
            return res.status(400).json({ error: "CSV file is required" });
        }

        // Check if name is unique
        const existing = await prisma.targetList.findUnique({ where: { name: name.trim() } });
        if (existing) {
            fs.unlink(file.path, () => {});
            return res.status(400).json({ error: "A target list with this name already exists" });
        }

        const parsedRows: any[] = [];
        
        fs.createReadStream(file.path)
            .pipe(csv())
            .on("data", (data) => parsedRows.push(data))
            .on("end", async () => {
                // Delete temp file
                fs.unlink(file.path, () => {});

                if (parsedRows.length === 0) {
                    return res.status(400).json({ error: "CSV file is empty" });
                }

                let validCount = 0;
                let invalidCount = 0;

                const emails = parsedRows.map((row) => {
                    const rawEmail = row.email || row.Email || row.EMAIL || "";
                    const email = rawEmail.trim();
                    const name = row.name || row.Name || row.NAME || "";
                    
                    const isValid = validator.isEmail(email);

                    if (isValid) {
                        validCount++;
                    } else {
                        invalidCount++;
                    }

                    // Store other columns as custom variables
                    const variables = { ...row };
                    delete variables.email;
                    delete variables.Email;
                    delete variables.EMAIL;
                    delete variables.name;
                    delete variables.Name;
                    delete variables.NAME;

                    return {
                        email,
                        name: name.trim() || null,
                        isValid,
                        variables
                    };
                });

                try {
                    const targetList = await prisma.targetList.create({
                        data: {
                            name: name.trim(),
                            totalCount: emails.length,
                            validCount,
                            invalidCount,
                            emails: emails as any
                        }
                    });

                    res.status(201).json(targetList);
                } catch (dbError: any) {
                    res.status(500).json({ error: dbError.message });
                }
            })
            .on("error", (error) => {
                fs.unlink(file.path, () => {});
                console.error("CSV parse error:", error);
                res.status(500).json({ error: "Failed to parse CSV file" });
            });
    } catch (error: any) {
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ error: error.message });
    }
});

// Delete a target list
router.delete("/:id", requireAuth, async (req, res) => {
    try {
        await prisma.targetList.delete({
            where: { id: req.params.id },
        });
        res.json({ message: "Target list deleted successfully" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
