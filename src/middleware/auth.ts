import { ClerkExpressRequireAuth, StrictAuthProp } from '@clerk/clerk-sdk-node';
import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';

// Extend Express Request to include auth
declare global {
  namespace Express {
    interface Request extends StrictAuthProp {
      apiKey?: {
        id: string;
        name: string;
      };
    }
  }
}

export const requireAuth = ClerkExpressRequireAuth();

const getApiKeyFromRequest = (req: Request) => {
  const xApiKey = req.header('x-api-key');
  if (xApiKey) {
    return xApiKey.trim();
  }

  const authorization = req.header('authorization');
  if (authorization?.toLowerCase().startsWith('apikey ')) {
    return authorization.slice(7).trim();
  }

  return null;
};

const authenticateApiKey = async (req: Request) => {
  const providedKey = getApiKeyFromRequest(req);
  if (!providedKey) {
    return null;
  }

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      key: providedKey,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (apiKey) {
    req.apiKey = apiKey;
  }

  return apiKey;
};

export const requireAuthOrApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKey = await authenticateApiKey(req);
    if (apiKey) {
      return next();
    }

    return requireAuth(req, res, next);
  } catch (error) {
    console.error("API key auth error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

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

export const requireAdminOrApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.apiKey) {
      return next();
    }

    const apiKey = await authenticateApiKey(req);
    if (apiKey) {
      return next();
    }

    return requireAdmin(req, res, next);
  } catch (error) {
    console.error("Admin or API key check error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
