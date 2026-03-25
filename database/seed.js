// database/seed.js
// Runs schema.sql against your MySQL database
// Run once: node database/seed.js

require("dotenv").config();
const mysql = require("mysql2/promise");
const fs    = require("fs");
const path  = require("path");

async function seed() {
    console.log("\n[Seed] Connecting to MySQL...");

    // Connect WITHOUT specifying database first
    // because we need to CREATE the database itself
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST     || "localhost",
        port:     process.env.DB_PORT     || 3306,
        user:     process.env.DB_USER     || "root",
        password: process.env.DB_PASSWORD || "Neymar10",
        multipleStatements: true    // needed to run the full schema file at once
    });

    console.log("[Seed] Connected. Running schema...");

    // Read schema.sql
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema     = fs.readFileSync(schemaPath, "utf8");

    // Execute entire schema
    await conn.query(schema);

    console.log("[Seed] All tables created");
    console.log("[Seed] Departments seeded: 5");
    console.log("[Seed] Officers seeded:    7");
    console.log("[Seed] Done! You can now run: node server.js\n");

    await conn.end();
}

seed().catch(err => {
    console.error("[Seed] Failed:", err.message);
    console.error("[Seed] Make sure MySQL is running and your .env is correct");
    process.exit(1);
});