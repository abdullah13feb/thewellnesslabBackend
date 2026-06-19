import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

// Define the custom Auth structure to maintain compatibility with existing req.auth references
interface AuthProp {
  auth?: {
    userId: string;
    email?: string;
    role?: string;
    sessionClaims?: any;
  };
}

declare global {
  namespace Express {
    interface Request extends AuthProp {
      apiKey?: {
        id: string;
        name: string;
      };
    }
  }
}

// Lazy initialize supabase client
let supabaseClientInstance: any = null;
const getSupabaseClient = () => {
  if (supabaseClientInstance) return supabaseClientInstance;
  const supabaseUrl = process.env.SUPABASE_URL || '';
  // Fallback to SUPABASE_JWT_SECRET since the user has populated it with their service role token
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_JWT_SECRET || '';
  if (supabaseUrl && supabaseKey) {
    supabaseClientInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseClientInstance;
};

// Supabase JWT Verification middleware
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token format" });
  }

  const token = authHeader.slice(7).trim();
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!jwtSecret) {
    console.error("SUPABASE_JWT_SECRET is not configured in environment variables.");
    return res.status(500).json({ error: "Internal Server Error" });
  }

  // 1. Try local verification (requires raw JWT secret)
  try {
    const decoded = jwt.verify(token, jwtSecret) as any;
    
    const role = decoded.app_metadata?.role || decoded.user_metadata?.role || decoded.role || 'USER';

    req.auth = {
      userId: decoded.sub,
      email: decoded.email,
      role: role,
      sessionClaims: decoded
    };
    
    return next();
  } catch (error) {
    // 2. Fallback: call Supabase auth API to verify the token
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (user && !authError) {
          const role = user.app_metadata?.role || user.user_metadata?.role || 'USER';
          req.auth = {
            userId: user.id,
            email: user.email,
            role: role,
            sessionClaims: user
          };
          return next();
        }
      } catch (fallbackError) {
        console.error("Supabase API verification fallback failed:", fallbackError);
      }
    }

    console.error("Supabase JWT validation failed:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

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

    // Fallback: Check Supabase Session Claims
    const claims = req.auth.sessionClaims;
    const role = claims?.app_metadata?.role || claims?.user_metadata?.role || claims?.role;

    if (role === 'ADMIN') {
      // Sync back to Prisma
      if (user && user.role !== 'ADMIN') {
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
      } else if (!user) {
        const userEmail = req.auth.email || "";
        const existingUser = userEmail ? await prisma.user.findUnique({ where: { email: userEmail } }) : null;
        if (existingUser) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { id: req.auth.userId, role: 'ADMIN' }
          });
        } else {
          await prisma.user.create({
            data: {
              id: req.auth.userId,
              email: userEmail,
              role: 'ADMIN'
            }
          });
          await prisma.cart.create({ data: { userId: req.auth.userId } });
        }
      }
      return next();
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

    return requireAuth(req, res, () => requireAdmin(req, res, next));
  } catch (error) {
    console.error("Admin or API key check error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
