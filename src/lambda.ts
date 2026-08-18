import serverless from "serverless-http";
import express, { Express } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Import API routes
import productRoutes from "./routes/products.js";
import cartRoutes from "./routes/cart.js";
import orderRoutes from "./routes/orders.js";
import flexOrderRoutes from "./routes/flexOrders.js";
import blogRoutes from "./routes/blogs.js";
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/upload.js";
import mediaRoutes from "./routes/media.js";
import targetListRoutes from "./routes/target-lists.js";
import settingsRoutes from "./routes/settings.js";
import couponRoutes from "./routes/coupons.js";
import contactRoutes from "./routes/contact.js";
import leadRoutes from "./routes/leads.js";
import najahRoutes from "./najah/najah.routes.js";
import whatsappRoutes from "./routes/whatsapp.js";
import marketingRoutes from "./routes/marketing.js";
import visitsRoutes from "./routes/visits.js";
import salespersonsRoutes from "./routes/salespersons.js";
import scrapingRoutes from "./routes/scraping.js";
import emailSenderRoutes from "./routes/email-senders.js";
import emailCampaignRoutes from "./routes/email-campaigns.js";
import emailTemplateRoutes from "./routes/email-templates.js";
import emailTrackingRoutes from "./routes/email-tracking.js";
import chatRoutes from "./routes/chat.js";
import reviewRoutes from "./routes/reviews.js";
import ctwaRoutes from "./routes/ctwa.js";

const currentDir = typeof __dirname !== "undefined" ? __dirname : process.cwd();

dotenv.config();

const app: Express = express();

// Allowed CORS origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.NAJAH_FRONTEND_URL,
  "https://production.d3nct9ywhbsaue.amplifyapp.com",
  "https://www.thewellnesslab.ae",
  "https://thewellnesslab.ae",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:5174",
  "https://www.flexa.thewellnesslab.ae",
  "https://flexa.thewellnesslab.ae"
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes("localhost") || origin.includes("thewellnesslab.ae")) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-API-Key"]
}));

// Body Parsers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static uploads
app.use("/uploads", express.static(path.join(currentDir, "../../public/uploads")));

// Mount API Routes
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/flex-orders", flexOrderRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/target-lists", targetListRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/najah", najahRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/marketing", marketingRoutes);
app.use("/api/visits", visitsRoutes);
app.use("/api/salespersons", salespersonsRoutes);
app.use("/api/admin/scraping", scrapingRoutes);
app.use("/api/email-senders", emailSenderRoutes);
app.use("/api/email-campaigns", emailCampaignRoutes);
app.use("/api/email-templates", emailTemplateRoutes);
app.use("/api/tracking", emailTrackingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/ctwa", ctwaRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "AWS Lambda Express API is running", timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global Lambda Error:", err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
    details: err.details || err
  });
});

// Export Lambda handler wrapped with serverless-http
export const handler = serverless(app, {
  binary: ["multipart/form-data", "image/*", "video/*", "application/pdf", "*/*"]
});
