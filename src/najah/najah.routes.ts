import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import prisma from '../lib/prisma.js';

const router = Router();

// Transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NAJAH_EMAIL_USER,
        pass: process.env.NAJAH_EMAIL_PASS,
    },
});

/**
 * @route GET /api/najah/data
 * @desc Get all form submissions (Public/Free API)
 */
router.get('/data', async (req: Request, res: Response) => {
    try {
        const data = await prisma.najahForm.findMany({
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.status(200).json({
            success: true,
            count: data.length,
            data
        });
    } catch (error: any) {
        console.error('Najah Data Fetch Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch data',
            error: error.message
        });
    }
});

router.post('/analyze', async (req: Request, res: Response) => {
    const { 
        name, 
        email, 
        phone, 
        company, 
        designation, 
        website, 
        analyzeSocial, 
        platforms, 
        platformUrls 
    } = req.body as {
        name: string;
        email: string;
        phone: string;
        company: string;
        designation: string;
        website: string;
        analyzeSocial: boolean;
        platforms: string[];
        platformUrls: Record<string, string>;
    };

    try {
        // 1. Save to Database
        await prisma.najahForm.create({
            data: {
                formType: 'ANALYZE',
                name,
                email,
                phone,
                company,
                designation,
                website,
                analyzeSocial: !!analyzeSocial,
                platforms: platforms || [],
                platformUrls: platformUrls || {}
            }
        });

        // 2. Prepare Social Media Info for Email
        let socialHtml = '';
        if (analyzeSocial && platforms && platforms.length > 0) {
            socialHtml = `
                <div style="background: #fdf2ef; padding: 15px; border-radius: 8px; border-left: 4px solid #ec4e20; margin-top: 15px;">
                    <h3 style="margin-top: 0; color: #ec4e20; font-size: 16px;">Social Media Audit Requested</h3>
                    <ul style="padding-left: 20px; margin-bottom: 0;">
                        ${platforms.map((p: string) => `<li><strong>${p.toUpperCase()}:</strong> ${platformUrls?.[p] || 'URL not provided'}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // 3. Prepare Email to Admin
        const adminMailOptions = {
            from: process.env.NAJAH_EMAIL_USER,
            to: process.env.NAJAH_EMAIL_RECEIVER,
            subject: `[NAJAH] New Brand Audit Request: ${name}`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #ec4e20; border-bottom: 2px solid #ec4e20; padding-bottom: 10px;">New Brand Audit Request</h2>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Phone:</strong> ${phone}</p>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Designation:</strong> ${designation}</p>
                    <p><strong>Website:</strong> ${website}</p>
                    ${socialHtml}
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #777;">Received via Najah Media Brand Audit Form</p>
                </div>
            `,
        };

        // 4. Prepare Email to User
        const userMailOptions = {
            from: process.env.NAJAH_EMAIL_USER,
            to: email,
            subject: `Thank You for Your Brand Audit Request - NAJAH MEDIA`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #ec4e20; border-bottom: 2px solid #ec4e20; padding-bottom: 10px;">Audit Request Received</h2>
                    <p>Dear ${name},</p>
                    <p>Thanks for signing up! We will get back to you with your full brand audit report within 48 hours.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #777;">&copy; ${new Date().getFullYear()} Najah Media. All rights reserved.</p>
                </div>
            `,
        };

        // 5. Send emails
        await Promise.all([
            transporter.sendMail(adminMailOptions),
            transporter.sendMail(userMailOptions)
        ]);

        res.status(200).json({ 
            success: true, 
            message: 'Audit request received, saved, and notifications sent successfully.'
        });
    } catch (error: any) {
        console.error('Najah API Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process request',
            error: error.message 
        });
    }
});

router.post('/contact', async (req: Request, res: Response) => {
    const { firstName, lastName, email, message } = req.body;
    const fullName = `${firstName} ${lastName}`;

    try {
        // 1. Save to Database
        await prisma.najahForm.create({
            data: {
                formType: 'CONTACT',
                name: fullName,
                email,
                message
            }
        });

        // 2. Prepare Email to Admin
        const adminMailOptions = {
            from: process.env.NAJAH_EMAIL_USER,
            to: process.env.NAJAH_EMAIL_RECEIVER,
            subject: `[NAJAH] New Contact Message: ${fullName}`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #ec4e20; border-bottom: 2px solid #ec4e20; padding-bottom: 10px;">New Contact Message</h2>
                    <p><strong>Name:</strong> ${fullName}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Message:</strong></p>
                    <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 4px solid #ec4e20;">
                        ${message}
                    </div>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #777;">Received via Najah Media Contact Form</p>
                </div>
            `,
        };

        // 3. Prepare Email to User
        const userMailOptions = {
            from: process.env.NAJAH_EMAIL_USER,
            to: email,
            subject: `Thank You for Contacting Najah Media`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                    <h2 style="color: #ec4e20; border-bottom: 2px solid #ec4e20; padding-bottom: 10px;">Message Received</h2>
                    <p>Dear ${fullName},</p>
                    <p>Thanks for reaching out! Our team will contact you soon.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #777;">&copy; ${new Date().getFullYear()} Najah Media. All rights reserved.</p>
                </div>
            `,
        };

        // 4. Send emails
        await Promise.all([
            transporter.sendMail(adminMailOptions),
            transporter.sendMail(userMailOptions)
        ]);

        res.status(200).json({ 
            success: true, 
            message: 'Message sent, saved, and notifications delivered successfully.'
        });
    } catch (error: any) {
        console.error('Najah Contact Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send message',
            error: error.message 
        });
    }
});

export default router;
