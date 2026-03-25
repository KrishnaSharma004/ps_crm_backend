// middleware/validateMiddleware.js
// Input validation middleware for all API endpoints
// Checks required fields, formats, and lengths before hitting business logic

// ── Validate mobile OTP request ─────────────────────────────────────────
function validateSendOTP(req, res, next) {
    const { mobile } = req.body;

    if (!mobile)
        return res.status(400).json({ error: "mobile is required" });

    if (!/^[6-9]\d{9}$/.test(String(mobile)))
        return res.status(400).json({
            error: "Invalid Indian mobile number",
            hint:  "Must be 10 digits starting with 6, 7, 8 or 9"
        });

    next();
}

// ── Validate OTP verification request ──────────────────────────────────
function validateVerifyOTP(req, res, next) {
    const { mobile, otp } = req.body;

    if (!mobile || !otp)
        return res.status(400).json({
            error:    "Both mobile and otp are required",
            received: { mobile: !!mobile, otp: !!otp }
        });

    if (!/^\d{6}$/.test(String(otp)))
        return res.status(400).json({
            error: "OTP must be exactly 6 digits"
        });

    next();
}

// ── Validate Aadhaar verification request ──────────────────────────────
function validateAadhaarVerify(req, res, next) {
    const { aadhaar_number, otp } = req.body;

    if (!aadhaar_number || !otp)
        return res.status(400).json({
            error: "aadhaar_number and otp are required"
        });

    // Aadhaar is 12 digits — strip spaces before checking
    const clean = String(aadhaar_number).replace(/\s/g, "");
    if (!/^\d{12}$/.test(clean))
        return res.status(400).json({
            error: "Invalid Aadhaar number",
            hint:  "Must be 12 digits (spaces allowed)"
        });

    // First digit cannot be 0 or 1
    if (["0", "1"].includes(clean[0]))
        return res.status(400).json({
            error: "Invalid Aadhaar number format"
        });

    next();
}

// ── Validate complaint submission ───────────────────────────────────────
function validateComplaint(req, res, next) {
    const { description, department } = req.body;

    if (!description)
        return res.status(400).json({ error: "description is required" });

    if (description.trim().length < 10)
        return res.status(400).json({
            error: "Description too short",
            hint:  "Please describe the issue in at least 10 characters"
        });

    if (description.trim().length > 1000)
        return res.status(400).json({
            error: "Description too long",
            hint:  "Maximum 1000 characters"
        });

    if (!department)
        return res.status(400).json({ error: "department is required" });

    const validDepts = ["PWD","MCD","Electricity","Water","Police","Other"];
    if (!validDepts.includes(department))
        return res.status(400).json({
            error:      "Invalid department",
            valid_options: validDepts
        });

    if (!req.file)
        return res.status(400).json({
            error: "Photo is required",
            hint:  "Upload a geotagged JPG/PNG taken directly from camera roll"
        });

    next();
}

// ── Validate assign request ─────────────────────────────────────────────
function validateAssign(req, res, next) {
    const { complaint_id, dept_id } = req.body;

    if (!complaint_id)
        return res.status(400).json({ error: "complaint_id is required" });

    if (!dept_id)
        return res.status(400).json({ error: "dept_id is required" });

    next();
}

// ── Validate reject request ─────────────────────────────────────────────
function validateReject(req, res, next) {
    const { complaint_id, reason_code } = req.body;

    if (!complaint_id)
        return res.status(400).json({ error: "complaint_id is required" });

    if (!reason_code)
        return res.status(400).json({ error: "reason_code is required" });

    const validCodes = [
        "duplicate","fake_photo","unclear",
        "out_of_area","not_civic","spam"
    ];
    if (!validCodes.includes(reason_code))
        return res.status(400).json({
            error:       "Invalid reason_code",
            valid_codes: validCodes
        });

    next();
}

// ── Validate status update ──────────────────────────────────────────────
function validateStatusUpdate(req, res, next) {
    const { complaint_id, status } = req.body;

    if (!complaint_id)
        return res.status(400).json({ error: "complaint_id is required" });

    if (!status)
        return res.status(400).json({ error: "status is required" });

    const validStatuses = ["IN_PROGRESS","RESOLVED","CLOSED"];
    if (!validStatuses.includes(status))
        return res.status(400).json({
            error:          "Invalid status",
            valid_statuses: validStatuses
        });

    next();
}

module.exports = {
    validateSendOTP,
    validateVerifyOTP,
    validateAadhaarVerify,
    validateComplaint,
    validateAssign,
    validateReject,
    validateStatusUpdate
};