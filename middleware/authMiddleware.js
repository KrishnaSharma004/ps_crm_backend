// middleware/authMiddleware.js
// Protects routes — verifies JWT token on every protected request
// Usage: router.get("/route", protect, handler)

const jwt = require("jsonwebtoken");

function protect(req, res, next) {
    // Get token from Authorization header
    const header = req.headers["authorization"];

    if (!header)
        return res.status(401).json({
            error: "Access denied. No token provided.",
            hint:  "Add header: Authorization: Bearer <your_token>"
        });

    // Header must be "Bearer <token>"
    const parts = header.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer")
        return res.status(401).json({
            error: "Invalid token format",
            hint:  "Format must be: Bearer <your_token>"
        });

    const token = parts[1];

    try {
        const decoded  = jwt.verify(token, process.env.JWT_SECRET);
        req.citizen    = decoded;   // attach decoded payload to request
        next();
    } catch (err) {
        if (err.name === "TokenExpiredError")
            return res.status(401).json({
                error: "Token has expired. Please login again."
            });
        return res.status(401).json({
            error: "Invalid token. Please login again."
        });
    }
}

module.exports = protect;