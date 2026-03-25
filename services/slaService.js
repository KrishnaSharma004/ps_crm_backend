// services/slaService.js
// Runs background cron job every 15 minutes
// Checks SLA deadlines and escalates breached complaints
// Also sends early warnings at 75% SLA usage

const cron        = require("node-cron");
const db          = require("../config/db");
const { sendSMS } = require("./notifyService");


// ── SLA thresholds per department (in hours) ────────────────────────────
const SLA_HOURS = {
    "dept_pwd":   48,
    "dept_mcd":   24,
    "dept_elec":  12,
    "dept_water": 24,
    "dept_pol":    6,
    "default":    48
};


// ── Get SLA hours for a department ─────────────────────────────────────
// ✅ FIXED: was db.prepare().get() — now uses MySQL queryOne
async function getSLAHours(deptId) {
    const dept = await db.queryOne(
        "SELECT sla_hours FROM departments WHERE id = ?",
        [deptId]
    );
    return dept?.sla_hours || SLA_HOURS[deptId] || SLA_HOURS["default"];
}


// ── Check a single complaint's SLA status ──────────────────────────────
// (no DB calls — pure logic, no changes needed)
function checkComplaintSLA(complaint) {
    if (!complaint.sla_deadline) return "unknown";

    const deadline = new Date(complaint.sla_deadline).getTime();
    const created  = new Date(complaint.created_at).getTime();
    const now      = Date.now();
    const totalMs  = deadline - created;
    const elapsed  = now - created;
    const pctUsed  = (elapsed / totalMs) * 100;

    if (now > deadline) return "breached";
    if (pctUsed >= 75)  return "warning";
    return "on_track";
}


// ── Handle SLA breach ──────────────────────────────────────────────────
// ✅ FIXED: all db.prepare() replaced with MySQL helpers, made async
async function handleBreach(complaint) {
    const newStatus = complaint.status === "ESCALATED"
        ? "SUPER_ESCALATED"
        : "ESCALATED";

    await db.run(
        "UPDATE complaints SET status = ? WHERE id = ?",
        [newStatus, complaint.id]
    );

    await db.insertAudit(
        complaint.id,
        "sla_breach",
        "system",
        `Auto-escalated to ${newStatus} — SLA deadline passed`
    );

    const citizen = await db.queryOne(
        "SELECT * FROM citizens WHERE id = ?",
        [complaint.citizen_id]
    );

    if (citizen?.mobile) {
        sendSMS(
            citizen.mobile,
            `PS-CRM: Your complaint #${complaint.id} has been escalated ` +
            `due to a delay. A senior official has been alerted. ` +
            `We apologize for the inconvenience.`
        );
    }

    const supervisor = await db.queryOne(
        `SELECT o.mobile FROM officers o
         WHERE o.dept_id = ? AND o.is_active = 1
         ORDER BY o.resolution_rate DESC
         LIMIT 1`,
        [complaint.dept_id]
    );

    if (supervisor?.mobile) {
        sendSMS(
            supervisor.mobile,
            `PS-CRM ALERT: Complaint #${complaint.id} has breached SLA. ` +
            `Immediate action required. Status: ${newStatus}`
        );
    }

    console.log(`[SLA] Complaint ${complaint.id} escalated to ${newStatus}`);
}


// ── Handle SLA warning (75% used) ──────────────────────────────────────
// ✅ FIXED: all db.prepare() replaced with MySQL helpers, made async
async function handleWarning(complaint) {
    const alreadyWarned = await db.queryOne(
        `SELECT id FROM audit_log
         WHERE complaint_id = ? AND action = 'sla_warning'
         LIMIT 1`,
        [complaint.id]
    );

    if (alreadyWarned) return;

    await db.insertAudit(
        complaint.id,
        "sla_warning",
        "system",
        "75% of SLA time used — early warning sent"
    );

    if (complaint.officer_id) {
        const officer = await db.queryOne(
            "SELECT mobile FROM officers WHERE id = ?",
            [complaint.officer_id]
        );

        if (officer?.mobile) {
            const hoursLeft = Math.ceil(
                (new Date(complaint.sla_deadline) - Date.now()) / 3600000
            );
            sendSMS(
                officer.mobile,
                `PS-CRM REMINDER: Complaint #${complaint.id} must be resolved ` +
                `within ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}. ` +
                `Please prioritize this immediately.`
            );
        }
    }

    console.log(`[SLA] Warning sent for complaint ${complaint.id}`);
}


// ── Main SLA check function ─────────────────────────────────────────────
// ✅ FIXED: was db.prepare().all() — now uses MySQL query
// ✅ FIXED: removed SQLite datetime() — MySQL uses DATE_SUB(NOW(), INTERVAL ...)
async function runSLACheck() {
    console.log(`[SLA] Running check at ${new Date().toISOString()}`);

    const openComplaints = await db.query(
        `SELECT c.*, d.sla_hours
         FROM complaints c
         LEFT JOIN departments d ON c.dept_id = d.id
         WHERE c.status NOT IN ('RESOLVED','CLOSED','REJECTED',
                                'HUMAN_REVIEW','SUPER_ESCALATED')
         AND c.sla_deadline IS NOT NULL`
    );

    let breachedCount = 0;
    let warningCount  = 0;

    for (const complaint of openComplaints) {
        const slaStatus = checkComplaintSLA(complaint);

        if (slaStatus === "breached") {
            await handleBreach(complaint);
            breachedCount++;
        } else if (slaStatus === "warning") {
            await handleWarning(complaint);
            warningCount++;
        }
    }

    console.log(
        `[SLA] Check complete — ` +
        `${openComplaints.length} open, ` +
        `${breachedCount} breached, ` +
        `${warningCount} warnings`
    );
}


// ── Auto-close awaiting-info complaints after 48 hours ─────────────────
// ✅ FIXED: was db.prepare().all() — now MySQL query
// ✅ FIXED: removed SQLite datetime() — MySQL uses DATE_SUB(NOW(), INTERVAL 48 HOUR)
async function runAwaitingInfoCheck() {
    const stale = await db.query(
        `SELECT * FROM complaints
         WHERE status = 'AWAITING_INFO'
         AND created_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)`
    );

    for (const complaint of stale) {
        await db.run(
            `UPDATE complaints
             SET status = 'CLOSED',
                 rejection_reason = 'No response from citizen within 48 hours'
             WHERE id = ?`,
            [complaint.id]
        );

        await db.insertAudit(
            complaint.id,
            "auto_closed",
            "system",
            "Closed: no citizen response within 48 hours"
        );

        const citizen = await db.queryOne(
            "SELECT * FROM citizens WHERE id = ?",
            [complaint.citizen_id]
        );

        if (citizen?.mobile) {
            sendSMS(
                citizen.mobile,
                `PS-CRM: Complaint #${complaint.id} was closed as we did not ` +
                `receive the requested information. You may refile at pscrm.gov.in`
            );
        }

        console.log(`[SLA] Auto-closed complaint ${complaint.id} — no citizen response`);
    }
}


// ── Start all cron jobs ─────────────────────────────────────────────────
// ✅ FIXED: cron callbacks are now async so await works inside them
function startSLAService() {
    cron.schedule("*/15 * * * *", async () => {
        try {
            await runSLACheck();
        } catch (err) {
            console.error("[SLA] Check failed:", err.message);
        }
    });

    cron.schedule("0 * * * *", async () => {
        try {
            await runAwaitingInfoCheck();
        } catch (err) {
            console.error("[SLA] Awaiting info check failed:", err.message);
        }
    });

    console.log("[SLA] Service started — checking every 15 minutes");
}


module.exports = {
    startSLAService,
    runSLACheck,
    checkComplaintSLA,
    getSLAHours
};