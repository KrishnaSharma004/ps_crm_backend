// services/imageService.js
const exifr = require("exifr");
const axios = require("axios");

async function processImage(photoPath) {
    const result = {
        lat: null, lon: null,
        address: null,
        trust_score: 50,
        ai_generated: false,
        has_gps: false,
        has_exif: false,
        camera_make: null
    };

    try {
        const exif = await exifr.parse(photoPath, {
            gps: true, tiff: true, exif: true
        });

        if (exif) {
            result.has_exif = true;

            if (exif.latitude && exif.longitude) {
                result.lat         = exif.latitude;
                result.lon         = exif.longitude;
                result.has_gps     = true;
                result.trust_score += 20;
            }

            if (exif.Make && exif.Model) {
                result.camera_make  = `${exif.Make} ${exif.Model}`;
                result.trust_score += 15;
            }

            const software = (exif.Software || "").toLowerCase();
            const aiTools  = ["midjourney","stable diffusion","dall-e","firefly","runway"];
            if (aiTools.some(t => software.includes(t))) {
                result.ai_generated = true;
                result.trust_score  = 5;
            }
        } else {
            result.trust_score -= 20;
        }

        if (result.lat && result.lon) {
            try {
                const geoRes = await axios.get(
                    "https://nominatim.openstreetmap.org/reverse",
                    {
                        params:  { lat: result.lat, lon: result.lon, format: "json" },
                        headers: { "User-Agent": "PS-CRM/1.0" }
                    }
                );
                result.address  = geoRes.data.display_name;
                result.state    = geoRes.data.address?.state;
                result.district = geoRes.data.address?.county;
                result.pincode  = geoRes.data.address?.postcode;
            } catch {
                // Geocoding failed — not critical
            }
        }

    } catch (err) {
        console.error("Image processing error:", err.message);
    }

    result.trust_score = Math.max(0, Math.min(100, result.trust_score));
    return result;
}

// ✅ FIXED: was missing — images.js route imports this
async function checkAIGenerated(photoPath) {
    const result = await processImage(photoPath);
    return {
        is_ai_generated: result.ai_generated,
        camera_make:     result.camera_make,
        has_exif:        result.has_exif,
        has_gps:         result.has_gps,
        trust_score:     result.trust_score
    };
}

// ✅ FIXED: was missing — images.js route imports this
async function classifyComplaint(photoPath) {
    const result = await processImage(photoPath);
    // Basic classification — extend with AI model later
    let type = "general";
    if (result.trust_score >= 70) type = "verified";
    else if (result.trust_score >= 40) type = "review_needed";
    else type = "rejected";

    return {
        classified:  true,
        trust_score: result.trust_score,
        type,
        has_gps:     result.has_gps,
        address:     result.address || null
    };
}

module.exports = { processImage, checkAIGenerated, classifyComplaint };