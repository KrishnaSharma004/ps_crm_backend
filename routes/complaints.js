// routes/complaints.js
const express     = require("express");
const multer      = require("multer");
const path        = require("path");
const db          = require("../config/db");
const protect     = require("../middleware/authMiddleware");
const { processImage }        = require("../services/imageService");
const { runAssignmentEngine } = require("../services/assignmentEngine");
const router = express.Router();

// Configure multer for photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename:    (req, file, cb) => {
        cb(null, `${Date.now()}_${file.originalname}`);
    }
});
const upload = multer({ storage });

// ── Submit complaint ────────────────────────────────────────────────────
router.post("/", protect, upload.single("photo"), async (req, res) => {
    try {
        const { description, department } = req.body;
        const citizenId = req.citizen.id;

        if (!description || !department || !req.file)
            return res.status(400).json({
                error: "All 3 inputs required: description, department, photo"
            });

        const photoPath = req.file.path;

        // Run image pipeline
        const imageResult = await processImage(photoPath);

        if (imageResult.trust_score < 40)
            return res.status(422).json({
                error:  "Photo rejected",
                reason: "Image appears AI-generated or has no GPS data",
                score:  imageResult.trust_score
            });

        // Generate ticket ID
        const ticketId = "CMP" + Date.now().toString().slice(-6);

        // Run assignment engine
        const assignment = await runAssignmentEngine({
            id:         ticketId,
            citizenId,
            description,
            deptChoice: department,
            photoPath,
            lat:        imageResult.lat,
            lon:        imageResult.lon,
            address:    imageResult.address
        });

        // ✅ FIXED: was db.prepare(...).get() — now uses MySQL queryOne
        const dept = await db.queryOne(
            "SELECT * FROM departments WHERE id = ?",
            [assignment.deptId]
        );

        const slaDeadline = new Date(
            Date.now() + (dept?.sla_hours || 48) * 3600000
        ).toISOString();

        // ✅ FIXED: was db.prepare(...).run() — now uses MySQL query
        await db.query(
            `INSERT INTO complaints
             (id, citizen_id, dept_id, officer_id, status, description,
              photo_path, lat, lon, address, trust_score,
              signal_log, sla_deadline)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                ticketId, citizenId,
                assignment.deptId,
                assignment.officerId,
                assignment.status,
                description, photoPath,
                imageResult.lat, imageResult.lon,
                imageResult.address,
                imageResult.trust_score,
                JSON.stringify(assignment.signalLog),
                slaDeadline
            ]
        );

        // ✅ FIXED: was db.prepare(...).run() — now uses MySQL insertAudit helper
        await db.insertAudit(ticketId, "created", citizenId, "Complaint submitted");

        res.status(201).json({
            ticket_id:    ticketId,
            status:       assignment.status,
            department:   dept?.name || "Under review",
            sla_deadline: slaDeadline,
            message:      "Complaint submitted successfully"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});

// ── Track complaint ──────────────────────────────────────────────────────
// ✅ FIXED: added async, replaced db.prepare().get() with db.queryOne()
router.get("/track/:id", protect, async (req, res) => {
    try {
        const complaint = await db.queryOne(
            "SELECT * FROM complaints WHERE id = ?",
            [req.params.id]
        );

        if (!complaint)
            return res.status(404).json({ error: "Complaint not found" });

        res.json({
            ticket_id:    complaint.id,
            status:       complaint.status,
            department:   complaint.dept_id,
            description:  complaint.description,
            severity:     complaint.severity,
            sla_deadline: complaint.sla_deadline,
            created_at:   complaint.created_at,
            resolved_at:  complaint.resolved_at
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});

// ── Get my complaints ────────────────────────────────────────────────────
// ✅ FIXED: added async, replaced db.prepare().all() with db.query()
router.get("/", protect, async (req, res) => {
    try {
        const complaints = await db.query(
            "SELECT * FROM complaints WHERE citizen_id = ? ORDER BY created_at DESC",
            [req.citizen.id]
        );
        res.json({ complaints });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});

module.exports = router;