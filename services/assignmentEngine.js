// services/assignmentEngine.js
const db = require("../config/db");

// Keyword map for NLP signal
const KEYWORD_MAP = {
    "dept_pwd":   ["pothole","road","footpath","bridge","crack","pavement"],
    "dept_mcd":   ["garbage","trash","waste","dustbin","litter","sanitation"],
    "dept_elec":  ["streetlight","light","electricity","power","wire","outage"],
    "dept_water": ["water","pipe","leakage","sewage","flood","supply","tap"],
    "dept_pol":   ["accident","crime","noise","parking","encroachment","theft"]
};

// Signal 1 — citizen dropdown
function citizenSignal(deptChoice) {
    const map = {
        "PWD": "dept_pwd", "MCD": "dept_mcd",
        "Electricity": "dept_elec", "Water": "dept_water",
        "Police": "dept_pol"
    };
    const deptId = map[deptChoice];
    return deptId
        ? { deptId, confidence: 1.0 }
        : { deptId: null, confidence: 0 };
}

// Signal 2 — NLP on description text
function nlpSignal(description) {
    const text   = description.toLowerCase();
    const scores = {};

    for (const [deptId, keywords] of Object.entries(KEYWORD_MAP)) {
        const matches  = keywords.filter(kw => text.includes(kw));
        scores[deptId] = matches.length;
    }

    const best = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];
    if (!best || best[1] === 0)
        return { deptId: null, confidence: 0 };

    return {
        deptId:     best[0],
        confidence: Math.min(0.4 + best[1] * 0.2, 1.0)
    };
}

// Signal 3 — GPS location zone mapping
function locationSignal(lat, lon) {
    if (!lat || !lon) return { deptId: null, confidence: 0 };
    return { deptId: null, confidence: 0.5, hasGPS: true };
}

// Haversine distance in km
// ✅ FIXED: now exported so officers.js can import it
function haversine(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 +
                 Math.cos(lat1 * Math.PI/180) *
                 Math.cos(lat2 * Math.PI/180) *
                 Math.sin(dLon/2)**2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

// ✅ FIXED: was using db.prepare().all() — now uses MySQL db.query()
// Also made async since db.query() returns a Promise
async function findNearestOfficer(deptId, lat, lon) {
    const officers = await db.query(
        "SELECT * FROM officers WHERE dept_id = ? AND is_active = 1",
        [deptId]
    );

    if (!officers.length) return null;

    return officers
        .map(o => ({
            ...o,
            score: haversine(lat, lon, o.current_lat, o.current_lon) * 0.5
                   + (o.active_complaints / 5) * 0.3
                   + ((100 - o.resolution_rate) / 100) * 0.2
        }))
        .sort((a, b) => a.score - b.score)[0];
}

// Main assignment engine
async function runAssignmentEngine(complaint) {
    const s1 = citizenSignal(complaint.deptChoice);
    const s2 = nlpSignal(complaint.description);
    const s3 = locationSignal(complaint.lat, complaint.lon);

    const WEIGHTS = { s1: 0.40, s2: 0.35, s3: 0.25 };
    const votes   = {};

    [[s1, WEIGHTS.s1], [s2, WEIGHTS.s2], [s3, WEIGHTS.s3]]
        .forEach(([sig, weight]) => {
            if (sig.deptId) {
                votes[sig.deptId] = (votes[sig.deptId] || 0)
                                    + sig.confidence * weight * 100;
            }
        });

    const signalLog = { s1, s2, s3, votes };

    const sorted = Object.entries(votes).sort((a,b) => b[1]-a[1]);
    const winner = sorted[0];

    if (!winner || winner[1] < 65) {
        return {
            status:    "HUMAN_REVIEW",
            deptId:    null,
            officerId: null,
            signalLog
        };
    }

    const deptId  = winner[0];
    // ✅ FIXED: findNearestOfficer is now async — must await it
    const officer = await findNearestOfficer(
        deptId, complaint.lat || 28.6139, complaint.lon || 77.2090
    );

    return {
        status:    "ASSIGNED",
        deptId,
        officerId: officer?.id || null,
        signalLog
    };
}

// ✅ FIXED: haversine is now exported so officers.js can use it
module.exports = { runAssignmentEngine, haversine };