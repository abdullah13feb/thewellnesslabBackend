import express from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import nodemailer from 'nodemailer';
import { requireAuth } from '../middleware/auth.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const upload = multer({ dest: os.tmpdir() });
const prisma = new PrismaClient();

// Mock transporter for demonstration (replace with actual SMTP config if provided)
// If we had Sendgrid or similar, we would use it here.
const createTransporter = async () => {
    if (process.env.MARKETING_HOST && process.env.MARKETING_EMAIL_USER && process.env.MARKETING_EMAIL_PASS) {
        return nodemailer.createTransport({
            host: process.env.MARKETING_HOST,
            port: Number(process.env.MARKETING_EMAIL_PORT) || 465,
            secure: process.env.MARKETING_EMAIL_SECURE === 'true' || Number(process.env.MARKETING_EMAIL_PORT) === 465,
            auth: {
                user: process.env.MARKETING_EMAIL_USER,
                pass: process.env.MARKETING_EMAIL_PASS,
            },
        });
    }

    // Default to ethereal for testing if no env vars
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: {
            user: testAccount.user,
            pass: testAccount.pass,
        },
    });
};

const replaceVariables = (template: string, recipient: any) => {
    let personalizedHtml = template;
    for (const key in recipient) {
        const regex = new RegExp(`{{${key}}}`, 'gi');
        personalizedHtml = personalizedHtml.replace(regex, recipient[key]);
    }
    return personalizedHtml;
};

router.post('/send-campaign', requireAuth, upload.single('csvFile'), async (req, res) => {
    try {
        const { htmlTemplate, subject, scheduledAt, timezone } = req.body;
        const file = req.file;

        if (!file || !htmlTemplate || !subject) {
            return res.status(400).json({ error: 'Missing required fields: csvFile, htmlTemplate, or subject' });
        }

        const recipients: any[] = [];
        
        fs.createReadStream(file.path)
            .pipe(csv())
            .on('data', (data) => recipients.push(data))
            .on('end', async () => {
                // Delete the temp file
                fs.unlink(file.path, () => {});

                if (recipients.length === 0) {
                    return res.status(400).json({ error: 'CSV file is empty or invalid' });
                }

                if (scheduledAt) {
                    // Schedule the campaign in the database
                    const scheduleDate = new Date(scheduledAt);
                    
                    const campaign = await prisma.emailCampaign.create({
                        data: {
                            subject,
                            htmlTemplate,
                            scheduledAt: scheduleDate,
                            timezone: timezone || 'UTC',
                            status: 'SCHEDULED',
                            totalCount: recipients.length,
                            recipients: {
                                create: recipients.map(r => ({
                                    email: r.email || r.Email || r.EMAIL,
                                    name: r.name || r.Name || r.NAME || null,
                                    variables: r
                                }))
                            }
                        }
                    });

                    return res.json({
                        success: true,
                        message: `Campaign scheduled successfully for ${scheduleDate.toLocaleString()} (${timezone || 'UTC'})`,
                        totalRecipients: recipients.length,
                        campaignId: campaign.id
                    });
                }

                // Immediate execution fallback (if no schedule is provided)
                let successCount = 0;
                let failureCount = 0;
                const transporter = await createTransporter();

                // Create campaign record for immediate sending
                const campaign = await prisma.emailCampaign.create({
                    data: {
                        subject,
                        htmlTemplate,
                        status: 'SENDING',
                        totalCount: recipients.length,
                    }
                });

                for (const recipient of recipients) {
                    const recipientEmail = recipient.email || recipient.Email || recipient.EMAIL;
                    if (!recipientEmail) {
                        failureCount++;
                        continue;
                    }

                    try {
                        const htmlToSend = replaceVariables(htmlTemplate, recipient);
                        
                        await transporter.sendMail({
                            from: process.env.MARKETING_EMAIL_USER || '"The Wellness Lab" <marketing@thewellnesslab.ae>',
                            to: recipientEmail,
                            subject: subject,
                            html: htmlToSend,
                        });

                        successCount++;
                        await prisma.emailCampaignRecipient.create({
                            data: {
                                campaignId: campaign.id,
                                email: recipientEmail,
                                variables: recipient,
                                status: 'SENT',
                                sentAt: new Date()
                            }
                        });
                    } catch (error: any) {
                        console.error(`Failed to send to ${recipientEmail}:`, error);
                        failureCount++;
                        await prisma.emailCampaignRecipient.create({
                            data: {
                                campaignId: campaign.id,
                                email: recipientEmail,
                                variables: recipient,
                                status: 'FAILED',
                                error: error.message
                            }
                        });
                    }
                }

                // Update final status
                await prisma.emailCampaign.update({
                    where: { id: campaign.id },
                    data: {
                        status: 'COMPLETED',
                        successCount,
                        failCount: failureCount
                    }
                });

                res.json({
                    success: true,
                    message: `Campaign finished immediately. Sent: ${successCount}, Failed: ${failureCount}`,
                    successCount,
                    failureCount
                });
            })
            .on('error', (error) => {
                fs.unlink(file.path, () => {});
                console.error('Error parsing CSV:', error);
                res.status(500).json({ error: 'Failed to process CSV file' });
            });

    } catch (error) {
        console.error('Error sending campaign:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
