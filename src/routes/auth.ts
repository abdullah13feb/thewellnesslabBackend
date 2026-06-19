import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Helper to get Supabase Admin client
const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (supabaseUrl && serviceRoleKey) {
        return createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }
    return null;
};

// Sync user from Supabase to Prisma
router.post('/sync', requireAuth, async (req, res) => {
    try {
        const { email } = req.body;
        const userId = req.auth!.userId;
        const userEmail = email || req.auth!.email;

        // Check if user exists
        let user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            if (!userEmail) {
                return res.status(400).json({ error: "Email required for initial sync" });
            }
            // Check if there is already a user with this email (e.g. from Clerk)
            const existingUser = await prisma.user.findUnique({ where: { email: userEmail } });
            if (existingUser) {
                user = await prisma.user.update({
                    where: { id: existingUser.id },
                    data: { id: userId, role: req.auth!.role === 'ADMIN' ? 'ADMIN' : 'USER' }
                });
            } else {
                // Create user in our DB
                user = await prisma.user.create({
                    data: {
                        id: userId,
                        email: userEmail,
                        role: req.auth!.role === 'ADMIN' ? 'ADMIN' : 'USER',
                    },
                });
                // Also create a Cart
                await prisma.cart.create({
                    data: { userId: user.id }
                });
            }
        } else if (req.auth!.role === 'ADMIN' && user.role !== 'ADMIN') {
            // Keep role in sync if token says admin but DB doesn't
            user = await prisma.user.update({
                where: { id: userId },
                data: { role: 'ADMIN' }
            });
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error("Sync error:", error);
        res.status(500).json({ error: "Failed to sync user" });
    }
});

// Promote current user to Admin (Bootstrap Helper)
router.post('/promote-admin', requireAuth, async (req, res) => {
    try {
        const { secretKey } = req.body;
        // Simple protection, in production use strict env var
        const ADMIN_SECRET = process.env.ADMIN_SECRET || "radiant-admin-secret-123";

        if (secretKey !== ADMIN_SECRET) {
            return res.status(403).json({ error: "Invalid admin secret" });
        }

        const userId = req.auth!.userId;

        // Update Prisma
        await prisma.user.update({
            where: { id: userId },
            data: { role: 'ADMIN' }
        });

        // Update Supabase User Metadata (requires Admin Client)
        const supabaseAdmin = getSupabaseAdmin();
        if (supabaseAdmin) {
            try {
                await supabaseAdmin.auth.admin.updateUserById(userId, {
                    user_metadata: { role: 'ADMIN' }
                });
            } catch (err) {
                console.warn("Failed to update Supabase user metadata via admin client:", err);
            }
        } else {
            console.warn("Supabase Admin Client not initialized. Add SUPABASE_SERVICE_ROLE_KEY to update user metadata.");
        }

        res.json({ success: true, message: "User promoted to ADMIN. Please sign out and sign in again to refresh permissions." });
    } catch (error) {
        console.error("Promote error:", error);
        res.status(500).json({ error: "Failed to promote user" });
    }
});

export default router;
