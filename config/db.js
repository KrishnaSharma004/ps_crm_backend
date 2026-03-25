// config/db.js
// MySQL database connection using mysql2 with connection pooling
// Pool = multiple connections available — handles concurrent requests

const mysql = require("mysql2/promise");

// ── Create connection pool ──────────────────────────────────────────────
const pool = mysql.createPool({
    host:            process.env.DB_HOST     || "localhost",
    port:            process.env.DB_PORT     || 3306,
    user:            process.env.DB_USER     || "root",
    password:        process.env.DB_PASSWORD || "Neymar10",
    database:        process.env.DB_NAME     || "pscrm",
    waitForConnections: true,
    connectionLimit:    10,       // max 10 simultaneous connections
    queueLimit:         0,        // unlimited queue
    charset:            "utf8mb4" // supports all characters including emoji
});

// ── Test connection on startup ──────────────────────────────────────────
async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log("[DB] MySQL connected successfully");
        console.log(`[DB] Host: ${process.env.DB_HOST || "localhost"}`);
        console.log(`[DB] Database: ${process.env.DB_NAME || "pscrm"}`);
        conn.release();
    } catch (err) {
        console.error("[DB] MySQL connection failed:", err.message);
        console.error("[DB] Check your .env DB_HOST, DB_USER, DB_PASSWORD, DB_NAME");
        process.exit(1);   // stop server if DB not reachable
    }
}

testConnection();

// ── Helper: run a query with values ────────────────────────────────────
// Returns rows array directly
// Usage: const rows = await query("SELECT * FROM complaints WHERE id = ?", [id])
async function query(sql, values = []) {
    const [rows] = await pool.execute(sql, values);
    return rows;
}

// ── Helper: get single row ──────────────────────────────────────────────
// Returns first row or null
// Usage: const row = await queryOne("SELECT * FROM citizens WHERE id = ?", [id])
async function queryOne(sql, values = []) {
    const rows = await query(sql, values);
    return rows[0] || null;
}

// ── Helper: insert a row and return insertId ────────────────────────────
// Usage: const id = await insert("INSERT INTO citizens ...", [values])
async function insert(sql, values = []) {
    const [result] = await pool.execute(sql, values);
    return result.insertId;
}

// ── Helper: update/delete rows, returns affectedRows ───────────────────
// Usage: const affected = await run("UPDATE complaints SET status=? WHERE id=?", [...])
async function run(sql, values = []) {
    const [result] = await pool.execute(sql, values);
    return result.affectedRows;
}

// ── Helper: insert audit log entry ─────────────────────────────────────
// Called after every state change for full audit trail
async function insertAudit(complaintId, action, actorId, note, role = "system") {
    return query(
        `INSERT INTO audit_log (complaint_id, action, actor_id, actor_role, note)
         VALUES (?, ?, ?, ?, ?)`,
        [complaintId, action, actorId, role, note]
    );
}

// ── Helper: get complaint with joined dept + officer names ──────────────
async function getComplaintFull(complaintId) {
    return queryOne(
        `SELECT c.*,
                d.name        AS dept_name,
                d.sla_hours,
                o.name        AS officer_name,
                o.mobile      AS officer_mobile
         FROM   complaints c
         LEFT JOIN departments d ON c.dept_id    = d.id
         LEFT JOIN officers    o ON c.officer_id = o.id
         WHERE  c.id = ?`,
        [complaintId]
    );
}

// ── Helper: get citizen by mobile ──────────────────────────────────────
async function getCitizenByMobile(mobile) {
    return queryOne("SELECT * FROM citizens WHERE mobile = ?", [mobile]);
}

// ── Helper: get citizen by Aadhaar ─────────────────────────────────────
async function getCitizenByAadhaar(aadhaar) {
    return queryOne("SELECT * FROM citizens WHERE aadhaar = ?", [aadhaar]);
}

// ── Export pool + all helpers ───────────────────────────────────────────
module.exports = {
    pool,
    query,
    queryOne,
    insert,
    run,
    insertAudit,
    getComplaintFull,
    getCitizenByMobile,
    getCitizenByAadhaar
};