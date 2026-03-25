// services/notifyService.js
// Handles all outbound notifications to citizens and officers
// Supports: SMS (Fast2SMS), console log (demo mode)
// Add WhatsApp / email here when needed

const axios = require("axios");


// ── Notification log — keeps record of all sent messages ───────────────
const notificationLog = [];


// ── Core SMS sender ────────────────────────────────────────────────────
// Uses Fast2SMS API (free tier: 20 SMS/day without DLT)
// Sign up at fast2sms.com to get your API key
async function sendSMS(mobile, message) {
    // Validate mobile
    if (!mobile || String(mobile).length !== 10) {
        console.warn(`[SMS] Invalid mobile: ${mobile}`);
        return { success: false, error: "Invalid mobile number" };
    }

    // Log every notification regardless of mode
    const logEntry = {
        id:        notificationLog.length + 1,
        mobile:    String(mobile).slice(-4).padStart(10, "*"),  // mask for privacy
        message,
        timestamp: new Date().toISOString(),
        status:    "pending"
    };
    notificationLog.push(logEntry);

    // Demo mode — just log to console if no API key
    const apiKey = process.env.FAST2SMS_KEY;
    if (!apiKey || apiKey === "your-key-here") {
        console.log(`\n[SMS DEMO] To: ${mobile}`);
        console.log(`[SMS DEMO] Message: ${message}\n`);
        logEntry.status = "demo_sent";
        return { success: true, mode: "demo" };
    }

    // Production — send via Fast2SMS
    try {
        const response = await axios.post(
            "https://www.fast2sms.com/dev/bulkV2",
            {
                route:    "q",
                message,
                language: "english",
                flash:    0,
                numbers:  mobile
            },
            {
                headers: {
                    authorization: apiKey,
                    "Content-Type": "application/json"
                },
                timeout: 8000
            }
        );

        if (response.data?.return === true) {
            logEntry.status = "sent";
            console.log(`[SMS] Sent to ${mobile.slice(-4).padStart(10,"*")}`);
            return { success: true, mode: "live" };
        } else {
            throw new Error(response.data?.message || "SMS API returned false");
        }

    } catch (err) {
        logEntry.status = "failed";
        console.error(`[SMS] Failed for ${mobile}: ${err.message}`);
        return { success: false, error: err.message };
    }
}


// ── Complaint submitted — notify citizen ────────────────────────────────
async function notifyComplaintSubmitted(mobile, ticketId, deptName, slaDeadline) {
    const date = slaDeadline
        ? new Date(slaDeadline).toLocaleDateString("en-IN", {
              day: "2-digit", month: "short", year: "numeric"
          })
        : "shortly";

    return sendSMS(
        mobile,
        `PS-CRM: Complaint #${ticketId} submitted successfully. ` +
        `Assigned to ${deptName}. Expected resolution by ${date}. ` +
        `Track: pscrm.gov.in/track/${ticketId}`
    );
}


// ── Complaint resolved — notify citizen ────────────────────────────────
async function notifyComplaintResolved(mobile, ticketId) {
    return sendSMS(
        mobile,
        `PS-CRM: Your complaint #${ticketId} has been resolved. ` +
        `Please rate our service: pscrm.gov.in/rate/${ticketId}. ` +
        `Thank you for making your city better!`
    );
}


// ── Complaint rejected — notify citizen with reason ────────────────────
async function notifyComplaintRejected(mobile, ticketId, reason) {
    return sendSMS(
        mobile,
        `PS-CRM: Complaint #${ticketId} could not be processed. ` +
        `Reason: ${reason}. ` +
        `You may refile with clearer details at pscrm.gov.in`
    );
}


// ── SLA warning — notify officer ───────────────────────────────────────
async function notifyOfficerSLAWarning(mobile, ticketId, hoursLeft) {
    return sendSMS(
        mobile,
        `PS-CRM ALERT: Complaint #${ticketId} must be resolved within ` +
        `${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}. ` +
        `Please take immediate action.`
    );
}


// ── SLA breach — notify supervisor ─────────────────────────────────────
async function notifySupervisorSLABreach(mobile, ticketId) {
    return sendSMS(
        mobile,
        `PS-CRM URGENT: Complaint #${ticketId} has breached its SLA deadline. ` +
        `Immediate escalation required. Login: pscrm.gov.in/officers`
    );
}


// ── Ask citizen for more info ───────────────────────────────────────────
async function notifyAskCitizen(mobile, ticketId, question) {
    return sendSMS(
        mobile,
        `PS-CRM: Regarding complaint #${ticketId} — ${question} ` +
        `Please reply within 48 hours or the complaint will be auto-closed.`
    );
}


// ── New complaint assigned to officer ──────────────────────────────────
async function notifyOfficerNewAssignment(mobile, ticketId, description) {
    const shortDesc = description?.slice(0, 60) || "Civic complaint";
    return sendSMS(
        mobile,
        `PS-CRM: New complaint #${ticketId} assigned to you. ` +
        `"${shortDesc}..." ` +
        `Login to view details: pscrm.gov.in/officers`
    );
}


// ── Get notification log (for admin) ───────────────────────────────────
function getNotificationLog(limit = 50) {
    return notificationLog.slice(-limit).reverse();
}


module.exports = {
    sendSMS,
    notifyComplaintSubmitted,
    notifyComplaintResolved,
    notifyComplaintRejected,
    notifyOfficerSLAWarning,
    notifySupervisorSLABreach,
    notifyAskCitizen,
    notifyOfficerNewAssignment,
    getNotificationLog
};