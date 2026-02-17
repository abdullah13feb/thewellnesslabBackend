import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Sync user from Clerk to Prisma
router.post('/sync', requireAuth, async (req, res) => {
    try {
        const { email, firstName, lastName } = req.body;
        const userId = req.auth.userId!;

        // Check if user exists
        let user = await prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            if (!email) {
                return res.status(400).json({ error: "Email required for initial sync" });
            }
            // Create user
            user = await prisma.user.create({
                data: {
                    id: userId,
                    email: email,
                    role: 'USER', // Default role
                },
            });
            // Also create a Cart
            await prisma.cart.create({
                data: { userId: user.id }
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

        const userId = req.auth.userId!;

        // Update Prisma
        await prisma.user.update({
            where: { id: userId },
            data: { role: 'ADMIN' }
        });

        // Update Clerk Metadata
        // We need to dynamic import or use standard import if available
        // Assuming @clerk/clerk-sdk-node is available and configured

        try {
            // ESM import for Clerk
            const { clerkClient } = await import('@clerk/clerk-sdk-node');
            await clerkClient.users.updateUser(userId, {
                publicMetadata: { role: 'ADMIN' }
            });
        } catch (err) {
            console.warn("Failed to update Clerk metadata directly. Ensure API keys are set.", err);
            // Fallback: We updated Prisma, which is our backend source of truth.
            // But frontend relies on metadata. User might need to re-login or Token refresh.
        }

        res.json({ success: true, message: "User promoted to ADMIN. Please sign out and sign in again to refresh permissions." });
    } catch (error) {
        console.error("Promote error:", error);
        res.status(500).json({ error: "Failed to promote user" });
    }
});

export default router;
