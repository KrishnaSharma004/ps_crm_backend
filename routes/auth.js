// routes/auth.js — MySQL version
const express = require("express");
const jwt     = require("jsonwebtoken");
const db      = require("../config/db");
const { storeOTP, verifyOTP } = require("../services/otpService");
const router  = express.Router();

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