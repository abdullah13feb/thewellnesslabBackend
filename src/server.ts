import express, { Express } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createServer } from "http";
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
import { startWhatsappScheduler } from "./lib/whatsappScheduler.js";
import { startEmailScheduler } from "./services/emailScheduler.js";
import scrapingRoutes from "./routes/scraping.js";
import { initScheduler } from "./services/scheduler.js";
import { initWeeklyScheduler } from "./services/weekly-scheduler.js";
import emailSenderRoutes from "./routes/email-senders.js";
import emailCampaignRoutes from "./routes/email-campaigns.js";
import emailTemplateRoutes from "./routes/email-templates.js";
import emailTrackingRoutes from "./routes/email-tracking.js";
import { startReplyTracker } from "./services/reply-tracker.service.js";
import chatRoutes from "./routes/chat.js";
import reviewRoutes from "./routes/reviews.js";
import ctwaRoutes from "./routes/ctwa.js";
import { initSocketServer } from "./lib/socket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const httpServer = createServer(app);

// Initialize socket server
initSocketServer(httpServer);

// Middleware
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
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if the origin is allowed
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes("localhost") || origin.includes("thewellnesslab.ae")) {
      callback(null, true);
    } else {
      console.log("Blocked Origin:", origin);
      // For now, let's be permissive to avoid blocking valid requests during dev/testing
      // callback(new Error('Not allowed by CORS'));
      callback(null, true);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-API-Key"]
}));

// Set express size limits to 50mb
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "../../public/uploads")));

// Routes
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

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "Server is running" });
});

// Serve static files from the React app
const distPath = path.join(__dirname, "../../dist");
app.use(express.static(distPath));

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global error handler:", err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
    details: err.details || err
  });
});

// 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({ success: false, error: "API Route not found" });
});

// Catch-all route for the React app
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Start scheduler
startWhatsappScheduler();
startEmailScheduler();
initScheduler();
initWeeklyScheduler();
startReplyTracker();

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
