// services/otpService.js
// Handles OTP generation, storage and verification
// Uses in-memory store for demo — swap with Redis for production

const OTP_EXPIRY_MS  = 5 * 60 * 1000;    // 5 minutes
const OTP_LENGTH     = 6;
const MAX_ATTEMPTS   = 3;                  // max wrong attempts before lockout
const RESEND_WAIT_MS = 60 * 1000;         // must wait 60s before resending

// In-memory OTP store — works for demo
// Structure: { mobile: { otp, expires_at, attempts, last_sent } }
const otpStore = {};


// ── Generate a random numeric OTP ──────────────────────────────────────
function generateOTP() {
    const digits = "0123456789";
    let otp      = "";
    for (let i = 0; i < OTP_LENGTH; i++) {
        otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
}


// ── Store OTP for a mobile number ──────────────────────────────────────
// Returns the OTP (for demo — in production send via SMS only)
function storeOTP(mobile) {
    const existing = otpStore[mobile];

    // Enforce resend wait time
    if (existing && Date.now() - existing.last_sent < RESEND_WAIT_MS) {
        const waitSec = Math.ceil(
            (RESEND_WAIT_MS - (Date.now() - existing.last_sent)) / 1000
        );
        return {
            success: false,
            error:   `Please wait ${waitSec} seconds before requesting a new OTP`
        };
    }

    const otp = generateOTP();
    otpStore[mobile] = {
        otp,
        expires_at: Date.now() + OTP_EXPIRY_MS,
        attempts:   0,
        last_sent:  Date.now()
    };

    return { success: true, otp };
}


// ── Verify OTP for a mobile number ─────────────────────────────────────
// Returns { valid: bool, error: string }
function verifyOTP(mobile, inputOtp) {
    const record = otpStore[mobile];

    if (!record)
        return { valid: false, error: "OTP not found. Please request a new one." };

    // Check expiry
    if (Date.now() > record.expires_at) {
        delete otpStore[mobile];
        return { valid: false, error: "OTP has expired. Please request a new one." };
    }

    // Check attempt count
    if (record.attempts >= MAX_ATTEMPTS) {
        delete otpStore[mobile];
        return {
            valid: false,
            error: `Too many wrong attempts. Please request a new OTP.`
        };
    }

    // Check OTP value
    if (record.otp !== String(inputOtp).trim()) {
        otpStore[mobile].attempts += 1;
        const remaining = MAX_ATTEMPTS - record.attempts;
        return {
            valid: false,
            error: `Wrong OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
        };
    }

    // Valid — clear after use (one-time use)
    delete otpStore[mobile];
    return { valid: true };
}


// ── Clear OTP (for logout or manual invalidation) ───────────────────────
function clearOTP(mobile) {
    delete otpStore[mobile];
}


// ── Check if OTP is pending for a mobile ───────────────────────────────
function hasPendingOTP(mobile) {
    const record = otpStore[mobile];
    if (!record) return false;
    if (Date.now() > record.expires_at) {
        delete otpStore[mobile];
        return false;
    }
    return true;
}


// ── Get remaining expiry seconds (for frontend countdown timer) ─────────
function getExpirySeconds(mobile) {
    const record = otpStore[mobile];
    if (!record) return 0;
    const remaining = Math.max(0, record.expires_at - Date.now());
    return Math.ceil(remaining / 1000);
}


module.exports = {
    generateOTP,
    storeOTP,
    verifyOTP,
    clearOTP,
    hasPendingOTP,
    getExpirySeconds
};