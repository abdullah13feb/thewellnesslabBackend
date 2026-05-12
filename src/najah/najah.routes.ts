import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';

const router = Router();

// Transporter configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NAJAH_EMAIL_USER,
        pass: process.env.NAJAH_EMAIL_PASS,
    },
});

router.post('/analyze', async (req: Request, res: Response) => {
    const { name, email, phone, company, designation, website, platforms } = req.body;

    try {
        // Prepare Email to Admin
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
                    <p><strong>Platforms to Analyze:</strong> ${platforms && platforms.length > 0 ? platforms.join(', ') : 'None specified'}</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #777;">Received via Najah Media Brand Audit Form</p>
                </div>
            `,
        };

        // Send email to Admin
        await transporter.sendMail(adminMailOptions);

        res.status(200).json({ 
            success: true, 
            message: 'Audit request received and notification sent successfully.'
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
        // Prepare Email to Admin
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

        // Send email to Admin
        await transporter.sendMail(adminMailOptions);

        res.status(200).json({ 
            success: true, 
            message: 'Message sent successfully.'
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
