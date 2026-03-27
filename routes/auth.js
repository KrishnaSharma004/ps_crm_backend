// routes/auth.js — MySQL version
const express = require("express");
const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");
const db      = require("../config/db");
const { storeOTP, verifyOTP } = require("../services/otpService");
const router  = express.Router();

// ============================================================================
// CITIZEN AUTHENTICATION
// ============================================================================

// ── CITIZEN: POST /auth/citizen/register ────────────────────────────────────
router.post("/citizen/register", async (req, res) => {
    try {
        const { name, mobile, password } = req.body;
        
        if (!name || !mobile || !password) {
            return res.status(400).json({ error: "Name, mobile, and password are required" });
        }

        // Check if citizen already exists
        const existing = await db.queryOne("SELECT * FROM citizens WHERE mobile = ?", [mobile]);
        if (existing) {
            return res.status(400).json({ error: "Citizen with this mobile number already exists" });
        }

        const id = "CIT_" + Date.now();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update DB call (Assuming your citizens table has a password column. If not, this adds them dynamically or expects an altered schema)
        await db.query(
            `INSERT INTO citizens (id, name, mobile, password, verified_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [id, name, mobile, hashedPassword]
        );

        res.status(201).json({ message: "Citizen registered successfully", citizen_id: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── CITIZEN: POST /auth/citizen/login ───────────────────────────────────────
router.post("/citizen/login", async (req, res) => {
    try {
        const { mobile, password } = req.body;

        if (!mobile || !password) {
            return res.status(400).json({ error: "Mobile and password required" });
        }

        const citizen = await db.queryOne("SELECT * FROM citizens WHERE mobile = ?", [mobile]);
        
        if (!citizen) {
            return res.status(404).json({ error: "Citizen not found. Please register." });
        }

        // Check password (only if they registered with one, fallback to OTP logic later if none exists)
        if (!citizen.password) {
             return res.status(401).json({ error: "Please login with OTP or update your account to use a password." });
        }

        const isMatch = await bcrypt.compare(password, citizen.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: citizen.id, role: "citizen" },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({ message: "Login successful", token, user: { id: citizen.id, name: citizen.name, role: "citizen" } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// OFFICER AUTHENTICATION
// ============================================================================

// ── OFFICER: POST /auth/officer/register ────────────────────────────────────
router.post("/officer/register", async (req, res) => {
    try {
        const { name, email, password, dept_id } = req.body;

        if (!name || !email || !password || !dept_id) {
            return res.status(400).json({ error: "Name, email, password, and dept_id are required" });
        }

        // Check if officer already exists
        const existing = await db.queryOne("SELECT * FROM officers WHERE email = ?", [email]);
        if (existing) {
            return res.status(400).json({ error: "Officer with this email already exists" });
        }

        const id = "OFF_" + Date.now();
        const hashedPassword = await bcrypt.hash(password, 10);

        // Expected officers table insertion
        await db.query(
            `INSERT INTO officers (id, name, email, password, dept_id, is_active, resolution_rate)
             VALUES (?, ?, ?, ?, ?, 1, 100)`,
            [id, name, email, hashedPassword, dept_id]
        );

        res.status(201).json({ message: "Officer registered successfully", officer_id: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── OFFICER: POST /auth/officer/login ───────────────────────────────────────
router.post("/officer/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password required" });
        }

        const officer = await db.queryOne("SELECT * FROM officers WHERE email = ?", [email]);
        
        if (!officer) {
            return res.status(404).json({ error: "Officer not found" });
        }

        const isMatch = await bcrypt.compare(password, officer.password || "");
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const token = jwt.sign(
            { id: officer.id, role: "officer", dept_id: officer.dept_id },
            process.env.JWT_SECRET,
            { expiresIn: "10h" } // Officers have shorter sessions
        );

        res.json({ message: "Officer login successful", token, user: { id: officer.id, name: officer.name, role: "officer" } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// OLD OTP AUTHENTICATION (For backward compatibility / Aadhaar)
// ============================================================================

// ── POST /auth/send-otp ─────────────────────────────────────────────────
router.post("/send-otp", async (req, res) => {
    try {
        const { mobile } = req.body;

        if (!mobile || !/^[6-9]\d{9}$/.test(String(mobile)))
            return res.status(400).json({ error: "Invalid mobile number" });

        const result = storeOTP(mobile);
        if (!result.success)
            return res.status(429).json({ error: result.error });

        // Demo mode — return OTP in response
        // Production — send via Fast2SMS
        console.log(`[OTP] ${mobile} → ${result.otp}`);
        res.json({ message: "OTP sent", demo_otp: result.otp });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /auth/verify-otp ───────────────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
    try {
        const { mobile, otp } = req.body;

        if (!mobile || !otp)
            return res.status(400).json({ error: "mobile and otp required" });

        const check = verifyOTP(mobile, otp);
        if (!check.valid)
            return res.status(401).json({ error: check.error });

        // Find citizen or create new one
        let citizen = await db.getCitizenByMobile(mobile);

        if (!citizen) {
            const id = "CIT_" + Date.now();
            await db.query(
                `INSERT INTO citizens (id, mobile, verified_at)
                 VALUES (?, ?, NOW())`,
                [id, mobile]
            );
            citizen = { id, mobile };
        }

        const token = jwt.sign(
            { id: citizen.id, mobile: citizen.mobile },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({ token, citizen });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /auth/aadhaar-verify ───────────────────────────────────────────
router.post("/aadhaar-verify", async (req, res) => {
    try {
        const { aadhaar_number, otp } = req.body;

        if (!aadhaar_number || !otp)
            return res.status(400).json({ error: "aadhaar_number and otp required" });

        // Check mock Aadhaar dataset
        const records = require("../models/mock_aadhaar.json");
        const clean   = String(aadhaar_number).replace(/\s/g, "");
        const record  = records.find(
            r => r.aadhaar_number.replace(/\s/g, "") === clean
        );

        if (!record)
            return res.status(404).json({ error: "Aadhaar number not found" });

        // Verify OTP for registered mobile
        const check = verifyOTP(record.mobile_number, otp);
        if (!check.valid)
            return res.status(401).json({ error: check.error });

        // Find or create citizen in DB
        let citizen = await db.getCitizenByAadhaar(clean);

        if (!citizen) {
            const id = "CIT_" + Date.now();
            await db.query(
                `INSERT INTO citizens
                 (id, name, aadhaar, mobile, state, district, pincode, verified_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    id, record.name, clean, record.mobile_number,
                    record.address.state, record.address.district,
                    record.address.pincode
                ]
            );
            citizen = { id, name: record.name };
        }

        const token = jwt.sign(
            { id: citizen.id, name: record.name },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.json({
            token,
            name:     record.name,
            state:    record.address.state,
            district: record.address.district
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;