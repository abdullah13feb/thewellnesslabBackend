import { ClerkExpressRequireAuth, StrictAuthProp } from '@clerk/clerk-sdk-node';
import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';

// Extend Express Request to include auth
declare global {
  namespace Express {
    interface Request extends StrictAuthProp { }
  }
}

export const requireAuth = ClerkExpressRequireAuth();

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Check Prisma first
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
    });

    if (user && user.role === 'ADMIN') {
      return next();
    }

    // Fallback: Check Clerk Session Claims (if metadata is in JWT)
    // Note: You must configure Clerk "Session token" in dashboard to include public_metadata
    // If not configured, this might be undefined.
    // However, for immediate user fix if they manually edited metadata:
    const claims = (req.auth as any).sessionClaims;
    const clerkRole = claims?.public_metadata?.role || claims?.metadata?.role;

    if (clerkRole === 'ADMIN') {
      // Optional: Sync back to Prisma?
      if (user && user.role !== 'ADMIN') {
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      }
      return next();
    }

    // Fallback 2: Fetch fresh data from Clerk API (Slow but reliable if token is stale)
    // Import clerkClient dynamically to avoid top-level await issues if any, or just trust imports.
    // We needed to add import at top. But since I am editing the function, I'll add the logic here.

    try {
      // We can iterate on this file to add the import at the top in a separate step or just assume it is available?
      // The user prompt shows I can edit the file.
      // I'll add the check here.
      const { clerkClient } = await import('@clerk/clerk-sdk-node');
      const clerkUser = await clerkClient.users.getUser(req.auth.userId);
      const metaRole = clerkUser.publicMetadata?.role;

      if (metaRole === 'ADMIN') {
        // Sync to Prisma
        if (user) {
          await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
        } else {
          // Create if missing?
          await prisma.user.create({
            data: {
              id: req.auth.userId,
              email: clerkUser.emailAddresses[0]?.emailAddress || "",
              role: 'ADMIN'
            }
          });
          // Also cart
          await prisma.cart.create({ data: { userId: req.auth.userId } });
        }
        return next();
      }
    } catch (err) {
      console.error("Clerk API fallback failed", err);
    }

    return res.status(403).json({ error: "Forbidden: Admin access required" });
  } catch (error) {
    console.error("Admin check error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
