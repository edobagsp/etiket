require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkAndFix() {
    const client = await pool.connect();
    try {
        console.log("Checking columns in 'assets' table...");
        const res = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'assets'
        `);
        const columns = res.rows.map(r => r.column_name);
        console.log("Current columns:", columns);

        if (!columns.includes('rfid')) {
            console.log("RFID column missing. Adding it...");
            await client.query("ALTER TABLE assets ADD COLUMN rfid TEXT DEFAULT ''");
            console.log("RFID column added successfully!");
        } else {
            console.log("RFID column already exists.");
        }

        // Also check attendance table
        console.log("Checking 'attendance' table...");
        const attRes = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_name = 'attendance'");
        if (attRes.rows[0].count === '0') {
            console.log("Attendance table missing. Creating it...");
            await client.query(`
                CREATE TABLE attendance (
                    id SERIAL PRIMARY KEY,
                    rfid TEXT NOT NULL,
                    "user" TEXT NOT NULL,
                    worker_type TEXT NOT NULL,
                    type TEXT NOT NULL,
                    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    date_str TEXT NOT NULL
                )
            `);
            console.log("Attendance table created!");
        } else {
            console.log("Attendance table exists.");
        }

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkAndFix();
