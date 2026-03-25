// routes/officers.js
// Officer and supervisor actions:
// - view complaint queue
// - human review (assign or reject)
// - update complaint status
// - view analytics

const express = require("express");
const db      = require("../config/db");
const protect = require("../middleware/authMiddleware");
const { sendSMS } = require("../services/notifyService");
const { haversine } = require("../services/assignmentEngine");
const router  = express.Router();


// ── GET /officers/queue ─────────────────────────────────────────────────
// ✅ FIXED: added async, replaced all db.prepare().get()/.all() with MySQL helpers
router.get("/queue", protect, async (req, res) => {
    try {
        const officerId = req.citizen.id;

        const officer = await db.queryOne(
            "SELECT * FROM officers WHERE id = ?",
            [officerId]
        );

        const complaints = officer
            ? await db.query(
                `SELECT c.*, d.name as dept_name
                 FROM complaints c
                 LEFT JOIN departments d ON c.dept_id = d.id
                 WHERE c.dept_id = ? AND c.status NOT IN ('CLOSED','REJECTED')
                 ORDER BY c.sla_deadline ASC`,
                [officer.dept_id]
              )
            : await db.query(
                `SELECT c.*, d.name as dept_name
                 FROM complaints c
                 LEFT JOIN departments d ON c.dept_id = d.id
                 WHERE c.status NOT IN ('CLOSED','REJECTED')
                 ORDER BY c.sla_deadline ASC`
              );

        res.json({
            count:      complaints.length,
            complaints: complaints.map(c => ({
                id:           c.id,
                status:       c.status,
                description:  c.description,
                department:   c.dept_name,
                severity:     c.severity,
                address:      c.address,
                lat:          c.lat,
                lon:          c.lon,
                sla_deadline: c.sla_deadline,
                created_at:   c.created_at,
                photo_url:    c.photo_path ? `/${c.photo_path}` : null
            }))
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


// ── GET /officers/review-queue ──────────────────────────────────────────
// ✅ FIXED: added async, replaced all db.prepare().get()/.all() with MySQL helpers
router.get("/review-queue", protect, async (req, res) => {
    try {
        const officerId = req.citizen.id;

        const reviewComplaints = await db.query(
            `SELECT c.*, d.name as dept_name
             FROM complaints c
             LEFT JOIN departments d ON c.dept_id = d.id
             WHERE c.status = 'HUMAN_REVIEW'
             ORDER BY c.created_at ASC`
        );

        const officer = await db.queryOne(
            "SELECT * FROM officers WHERE id = ?",
            [officerId]
        );

        let sorted = reviewComplaints;
        if (officer?.current_lat && officer?.current_lon) {
            sorted = reviewComplaints
                .map(c => ({
                    ...c,
                    distance_km: c.lat && c.lon
                        ? haversine(
                            officer.current_lat, officer.current_lon,
                            c.lat, c.lon
                          ).toFixed(2)
                        : null
                }))
                .sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
        }

        res.json({
            count:      sorted.length,
            complaints: sorted.map(c => ({
                id:           c.id,
                description:  c.description,
                photo_url:    c.photo_path ? `/${c.photo_path}` : null,
                address:      c.address,
                lat:          c.lat,
                lon:          c.lon,
                distance_km:  c.distance_km || null,
                signal_log:   c.signal_log ? JSON.parse(c.signal_log) : null,
                created_at:   c.created_at
            }))
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


// ── POST /officers/assign ───────────────────────────────────────────────
// ✅ FIXED: added async, replaced all db.prepare() with MySQL helpers
router.post("/assign", protect, async (req, res) => {
    try {
        const { complaint_id, dept_id, note } = req.body;
        const officerId = req.citizen.id;

        if (!complaint_id || !dept_id)
            return res.status(400).json({
                error: "complaint_id and dept_id are required"
            });

        const complaint = await db.queryOne(
            "SELECT * FROM complaints WHERE id = ?",
            [complaint_id]
        );

        if (!complaint)
            return res.status(404).json({ error: "Complaint not found" });

        if (complaint.status !== "HUMAN_REVIEW")
            return res.status(400).json({
                error: "Complaint is not in human review status"
            });

        const dept = await db.queryOne(
            "SELECT * FROM departments WHERE id = ?",
            [dept_id]
        );

        if (!dept)
            return res.status(404).json({ error: "Department not found" });

        const slaDeadline = new Date(
            Date.now() + dept.sla_hours * 3600000
        ).toISOString();

        const officers = await db.query(
            "SELECT * FROM officers WHERE dept_id = ? AND is_active = 1",
            [dept_id]
        );

        let assignedOfficer = null;
        if (officers.length && complaint.lat && complaint.lon) {
            assignedOfficer = officers
                .map(o => ({
                    ...o,
                    dist: haversine(complaint.lat, complaint.lon,
                                    o.current_lat, o.current_lon)
                }))
                .sort((a, b) => a.dist - b.dist)[0];
        } else if (officers.length) {
            assignedOfficer = officers[0];
        }

        // ✅ FIXED: was db.prepare(...).run() — now uses MySQL run helper
        // Also fixed: removed SQLite datetime() — MySQL uses NOW()
        await db.run(
            `UPDATE complaints SET
                status        = 'ASSIGNED',
                dept_id       = ?,
                officer_id    = ?,
                sla_deadline  = ?,
                reviewed_by   = ?,
                review_action = 'manual_assign'
             WHERE id = ?`,
            [dept_id, assignedOfficer?.id || null, slaDeadline, officerId, complaint_id]
        );

        await db.insertAudit(
            complaint_id, "manual_assigned", officerId,
            note || `Manually assigned to ${dept.name} by official`
        );

        const citizen = await db.queryOne(
            "SELECT * FROM citizens WHERE id = ?",
            [complaint.citizen_id]
        );

        if (citizen?.mobile) {
            sendSMS(
                citizen.mobile,
                `PS-CRM: Your complaint #${complaint_id} has been assigned to ` +
                `${dept.name}. Expected resolution by ` +
                `${new Date(slaDeadline).toLocaleDateString("en-IN")}. ` +
                `Track at: pscrm.gov.in/track/${complaint_id}`
            );
        }

        res.json({
            success:      true,
            ticket_id:    complaint_id,
            department:   dept.name,
            officer:      assignedOfficer?.name || "To be assigned",
            sla_deadline: slaDeadline,
            message:      "Complaint assigned successfully"
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


// ── POST /officers/reject ───────────────────────────────────────────────
// ✅ FIXED: added async, replaced all db.prepare() with MySQL helpers
router.post("/reject", protect, async (req, res) => {
    try {
        const { complaint_id, reason_code, custom_note } = req.body;
        const officerId = req.citizen.id;

        if (!complaint_id || !reason_code)
            return res.status(400).json({
                error: "complaint_id and reason_code are required"
            });

        const REJECTION_REASONS = {
            duplicate:   "This complaint has already been filed",
            fake_photo:  "The photo does not match the described issue",
            unclear:     "Insufficient information to process this complaint",
            out_of_area: "This location is outside our service jurisdiction",
            not_civic:   "This is not a civic infrastructure complaint",
            spam:        "This appears to be a test or spam submission"
        };

        const reason = REJECTION_REASONS[reason_code];
        if (!reason)
            return res.status(400).json({
                error:         "Invalid reason_code",
                valid_codes:   Object.keys(REJECTION_REASONS),
                valid_reasons: REJECTION_REASONS
            });

        const finalReason = custom_note ? `${reason} — ${custom_note}` : reason;

        const complaint = await db.queryOne(
            "SELECT * FROM complaints WHERE id = ?",
            [complaint_id]
        );

        if (!complaint)
            return res.status(404).json({ error: "Complaint not found" });

        await db.run(
            `UPDATE complaints SET
                status           = 'REJECTED',
                rejection_reason = ?,
                reviewed_by      = ?,
                review_action    = 'rejected'
             WHERE id = ?`,
            [finalReason, officerId, complaint_id]
        );

        await db.insertAudit(complaint_id, "rejected", officerId, finalReason);

        const citizen = await db.queryOne(
            "SELECT * FROM citizens WHERE id = ?",
            [complaint.citizen_id]
        );

        if (citizen?.mobile) {
            sendSMS(
                citizen.mobile,
                `PS-CRM: Your complaint #${complaint_id} could not be processed. ` +
                `Reason: ${finalReason}. ` +
                `You may refile with clearer details at pscrm.gov.in`
            );
        }

        res.json({
            success:   true,
            ticket_id: complaint_id,
            reason:    finalReason,
            message:   "Complaint rejected and citizen notified"
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


// ── PATCH /officers/status ──────────────────────────────────────────────
// ✅ FIXED: added async, replaced db.prepare() with MySQL helpers
// Also fixed: removed SQLite datetime('now') — MySQL uses NOW()
router.patch("/status", protect, async (req, res) => {
    try {
        const { complaint_id, status, note } = req.body;
        const officerId = req.citizen.id;

        const VALID_STATUSES = ["IN_PROGRESS", "RESOLVED", "CLOSED"];
        if (!VALID_STATUSES.includes(status))
            return res.status(400).json({
                error:          "Invalid status",
                valid_statuses: VALID_STATUSES
            });

        const complaint = await db.queryOne(
            "SELECT * FROM complaints WHERE id = ?",
            [complaint_id]
        );

        if (!complaint)
            return res.status(404).json({ error: "Complaint not found" });

        // ✅ FIXED: replaced SQLite datetime('now') with MySQL NOW()
        await db.run(
            `UPDATE complaints SET
                status      = ?,
                resolved_at = CASE WHEN ? = 'RESOLVED' THEN NOW() ELSE resolved_at END
             WHERE id = ?`,
            [status, status, complaint_id]
        );

        await db.insertAudit(
            complaint_id,
            `status_${status.toLowerCase()}`,
            officerId,
            note || `Status updated to ${status}`
        );

        if (status === "RESOLVED") {
            const citizen = await db.queryOne(
                "SELECT * FROM citizens WHERE id = ?",
                [complaint.citizen_id]
            );

            if (citizen?.mobile) {
                sendSMS(
                    citizen.mobile,
                    `PS-CRM: Great news! Your complaint #${complaint_id} has been resolved. ` +
                    `Please rate our service at pscrm.gov.in/rate/${complaint_id}. ` +
                    `Thank you for helping improve your city.`
                );
            }
        }

        res.json({
            success:    true,
            ticket_id:  complaint_id,
            new_status: status,
            message:    `Status updated to ${status}`
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


// ── GET /officers/analytics ─────────────────────────────────────────────
// ✅ FIXED: added async, replaced all db.prepare().get()/.all() with MySQL helpers
router.get("/analytics", protect, async (req, res) => {
    try {
        const totalRow    = await db.queryOne("SELECT COUNT(*) as n FROM complaints");
        const resolvedRow = await db.queryOne("SELECT COUNT(*) as n FROM complaints WHERE status='RESOLVED'");
        const pendingRow  = await db.queryOne("SELECT COUNT(*) as n FROM complaints WHERE status NOT IN ('RESOLVED','CLOSED','REJECTED')");
        const reviewRow   = await db.queryOne("SELECT COUNT(*) as n FROM complaints WHERE status='HUMAN_REVIEW'");
        const rejectedRow = await db.queryOne("SELECT COUNT(*) as n FROM complaints WHERE status='REJECTED'");

        const total    = totalRow.n;
        const resolved = resolvedRow.n;
        const pending  = pendingRow.n;
        const review   = reviewRow.n;
        const rejected = rejectedRow.n;

        const byDept = await db.query(
            `SELECT d.name, COUNT(c.id) as count
             FROM complaints c
             JOIN departments d ON c.dept_id = d.id
             GROUP BY c.dept_id, d.name`
        );

        const bySeverity = await db.query(
            `SELECT severity, COUNT(*) as count
             FROM complaints
             GROUP BY severity`
        );

        res.json({
            summary:         { total, resolved, pending, review, rejected },
            by_department:   byDept,
            by_severity:     bySeverity,
            resolution_rate: total > 0
                ? ((resolved / total) * 100).toFixed(1) + "%"
                : "0%"
        });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


// ── GET /officers/departments ───────────────────────────────────────────
// ✅ FIXED: added async, replaced db.prepare().all() with MySQL query
router.get("/departments", protect, async (req, res) => {
    try {
        const departments = await db.query("SELECT * FROM departments");
        res.json({ departments });
    } catch (err) {
        res.status(500).json({ error: "Server error", detail: err.message });
    }
});


module.exports = router;