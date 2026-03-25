// middleware/errorMiddleware.js
// Global error handler — catches any unhandled errors across all routes
// Must be registered LAST in server.js after all routes

// ── 404 handler — route not found ──────────────────────────────────────
function notFound(req, res, next) {
    res.status(404).json({
        error:     "Route not found",
        requested: `${req.method} ${req.originalUrl}`,
        available: [
            "GET  /ping",
            "POST /auth/send-otp",
            "POST /auth/verify-otp",
            "POST /auth/aadhaar-verify",
            "POST /complaints",
            "GET  /complaints",
            "GET  /complaints/track/:id",
            "POST /images/upload",
            "POST /images/extract-gps",
            "POST /images/ai-check",
            "POST /images/classify",
            "GET  /officers/queue",
            "GET  /officers/review-queue",
            "POST /officers/assign",
            "POST /officers/reject",
            "PATCH /officers/status",
            "GET  /officers/analytics",
            "GET  /officers/departments"
        ]
    });
}

// ── Global error handler ────────────────────────────────────────────────
function errorHandler(err, req, res, next) {
    if (process.env.NODE_ENV !== "production") {
        console.error("\n[ERROR]", err.stack || err.message);
    }

    // Multer file size error
    if (err.code === "LIMIT_FILE_SIZE")
        return res.status(400).json({ error: "File too large. Max 10MB." });

    // JWT errors
    if (err.name === "JsonWebTokenError")
        return res.status(401).json({ error: "Invalid token" });

    if (err.name === "TokenExpiredError")
        return res.status(401).json({ error: "Token expired. Please login again." });

    // ✅ FIXED: was checking SQLite error message "UNIQUE constraint failed"
    // MySQL uses error code ER_DUP_ENTRY instead
    if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
            error: "Record already exists"
        });
    }

    // Default server error
    res.status(err.status || 500).json({
        error:  err.message || "Internal server error",
        detail: process.env.NODE_ENV !== "production" ? err.stack : undefined
    });
}

module.exports = { notFound, errorHandler };