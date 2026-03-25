// server.js
require("dotenv").config();

const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const fs       = require("fs");

// ── Imports must ALL come first before anything else ────────────────────
const authRoutes      = require("./routes/auth");
const complaintRoutes = require("./routes/complaints");
const imageRoutes     = require("./routes/images");
const officerRoutes   = require("./routes/officers");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const { startSLAService }        = require("./services/slaService");

// ── Create uploads folder if it doesn't exist ───────────────────────────
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log("[Server] Created uploads/ directory");
}

// ── Initialize Express app ──────────────────────────────────────────────
const app = express();

// ── Core middleware ─────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

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
app.listen(PORT, () => {
    console.log(`\nPS-CRM server running on http://localhost:${PORT}`);
    console.log(`Health check → http://localhost:${PORT}/ping\n`);
});

// ── Start background SLA cron job ───────────────────────────────────────
// Runs AFTER server starts — checks SLA breaches every 15 minutes
startSLAService();