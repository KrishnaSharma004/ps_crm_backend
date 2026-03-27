// server.js
require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const helmet   = require("helmet");
const compression = require("compression");
const morgan   = require("morgan");
const rateLimit = require("express-rate-limit");
const path     = require("path");
const fs       = require("fs");

// ── Imports must ALL come first before anything else ────────────────────
const authRoutes      = require("./routes/auth");
const complaintRoutes = require("./routes/complaints");
const imageRoutes     = require("./routes/images");
const officerRoutes   = require("./routes/officers");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const { startSLAService }        = require("./services/slaService");
const db                         = require("./config/db"); // Assuming pool is accessible or we rely on process exit

// ── Create uploads folder if it doesn't exist ───────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log("[Server] Created uploads/ directory");
}

// ── Initialize Express app ──────────────────────────────────────────────
const app = express();

// ── Production Security & Middleware ────────────────────────────────────
app.use(helmet());            // Sets secure HTTP headers
app.use(compression());       // Gzip compression for faster payload transfer
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev")); // HTTP request logging

// Rate Limiting — Max 200 requests per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 200, 
    message: "Too many requests from this IP, please try again later."
});
app.use("/api", limiter);     // Apply rate limiting

// Setup CORS appropriately for production
const corsOptions = {
    origin: process.env.CLIENT_ORIGIN || "*", // Fallback to all in dev, restrict in prod
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
};
app.use(cors(corsOptions));

app.use(express.json({ limit: "15mb" })); // Limit body payload to avoid giant payload attacks
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
    maxAge: "1d" // Cache static files 
}));

// ── Health check ────────────────────────────────────────────────────────
// Must be defined BEFORE error handlers
app.get("/ping", (req, res) => {
    res.json({
        status:    "PS-CRM backend running",
        version:   "1.0",
        timestamp: new Date().toISOString(),
        uptime:    `${Math.floor(process.uptime())}s`
    });
});

// ── API routes ──────────────────────────────────────────────────────────
// All registered BEFORE notFound and errorHandler
app.use("/auth",       authRoutes);
app.use("/complaints", complaintRoutes);
app.use("/images",     imageRoutes);
app.use("/officers",   officerRoutes);

// ── Error handlers ──────────────────────────────────────────────────────
// MUST come AFTER all routes — order matters in Express
app.use(notFound);       // catches unknown routes → 404
app.use(errorHandler);   // catches all thrown errors → 500

// ── Start server ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`\n[Server] Node Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`[Server] PS-CRM running on http://localhost:${PORT}`);
    console.log(`[Server] Health check → http://localhost:${PORT}/ping\n`);
});

// ── Start background SLA cron job ───────────────────────────────────────
// Runs AFTER server starts — checks SLA breaches every 15 minutes
startSLAService();

// ── Graceful Shutdown ───────────────────────────────────────────────────
const shutdown = () => {
    console.log("\n[Server] Shutting down gracefully...");
    server.close(() => {
        console.log("[Server] HTTP server closed.");
        // Add database pool closing logic here if exported, e.g. db.pool.end()
        process.exit(0);
    });
    
    // Force shutdown if taking too long
    setTimeout(() => {
        console.error("[Server] Forcefully shutting down!");
        process.exit(1);
    }, 10000);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);