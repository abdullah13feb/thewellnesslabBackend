import express, { Express } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import productRoutes from "./routes/products.js";
import cartRoutes from "./routes/cart.js";
import orderRoutes from "./routes/orders.js";
import blogRoutes from "./routes/blogs.js";
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/upload.js";
import settingsRoutes from "./routes/settings.js";
import couponRoutes from "./routes/coupons.js";
import contactRoutes from "./routes/contact.js";
import leadRoutes from "./routes/leads.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://production.d3nct9ywhbsaue.amplifyapp.com",
  "https://www.thewellnesslab.ae",
  "https://thewellnesslab.ae",
  "http://localhost:8080",
  "http://localhost:5174"
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

app.use(express.json());

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "../../public/uploads")));

// Routes
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/blogs", blogRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/leads", leadRoutes);

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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
