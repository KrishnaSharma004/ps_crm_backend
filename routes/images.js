// routes/images.js
// Handles image upload, EXIF GPS extraction, AI detection, classification

const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const protect = require("../middleware/authMiddleware");
const {
    processImage,
    checkAIGenerated,
    classifyComplaint
} = require("../services/imageService");

const router = express.Router();

// ── Multer config ───────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = "uploads/";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext      = path.extname(file.originalname).toLowerCase();
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp"];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error("Only JPG, PNG and WEBP images are allowed"), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }   // 10 MB max
});


// ── POST /images/upload ─────────────────────────────────────────────────
// Upload image and run full pipeline in one call
// Returns: GPS coords, address, trust score, AI check, complaint type
router.post("/upload", protect, upload.single("photo"), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: "No image file provided" });

        const result = await processImage(req.file.path);

        res.json({
            success:      true,
            photo_path:   req.file.path,
            photo_url:    `/uploads/${req.file.filename}`,
            gps: {
                lat:      result.lat,
                lon:      result.lon,
                has_gps:  result.has_gps
            },
            address:      result.address,
            state:        result.state,
            district:     result.district,
            pincode:      result.pincode,
            trust_score:  result.trust_score,
            ai_check: {
                is_ai_generated: result.ai_generated,
                camera_make:     result.camera_make,
                has_exif:        result.has_exif
            },
            verdict: result.trust_score >= 70
                ? "ACCEPT"
                : result.trust_score >= 40
                    ? "REVIEW"
                    : "REJECT"
        });

    } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ error: "Image processing failed", detail: err.message });
    }
});


// ── POST /images/extract-gps ────────────────────────────────────────────
// Extract only GPS coordinates from an already-uploaded image
router.post("/extract-gps", protect, upload.single("photo"), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: "No image provided" });

        const exifr = require("exifr");
        const gps   = await exifr.gps(req.file.path);

        if (!gps || !gps.latitude)
            return res.status(422).json({
                error:  "No GPS data found in image",
                reason: "Make sure location was ON when photo was taken. Photos shared via WhatsApp lose GPS data."
            });

        // Reverse geocode
        let address = null;
        try {
            const axios = require("axios");
            const geo   = await axios.get("https://nominatim.openstreetmap.org/reverse", {
                params: { lat: gps.latitude, lon: gps.longitude, format: "json" },
                headers: { "User-Agent": "PS-CRM/1.0" },
                timeout: 5000
            });
            address = geo.data;
        } catch { /* geocoding optional */ }

        res.json({
            lat:      gps.latitude,
            lon:      gps.longitude,
            address:  address?.display_name || null,
            state:    address?.address?.state || null,
            district: address?.address?.county || null,
            pincode:  address?.address?.postcode || null
        });

    } catch (err) {
        res.status(500).json({ error: "GPS extraction failed", detail: err.message });
    }
});


// ── POST /images/ai-check ───────────────────────────────────────────────
// Check if an already-uploaded image is AI generated
router.post("/ai-check", protect, upload.single("photo"), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: "No image provided" });

        const result = await checkAIGenerated(req.file.path);
        res.json(result);

    } catch (err) {
        res.status(500).json({ error: "AI check failed", detail: err.message });
    }
});


// ── POST /images/classify ───────────────────────────────────────────────
// Classify what complaint type is shown in the image
router.post("/classify", protect, upload.single("photo"), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: "No image provided" });

        const result = await classifyComplaint(req.file.path);
        res.json(result);

    } catch (err) {
        res.status(500).json({ error: "Classification failed", detail: err.message });
    }
});


// ── Error handler for multer ────────────────────────────────────────────
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE")
            return res.status(400).json({ error: "File too large. Max 10MB." });
        return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
});


module.exports = router;