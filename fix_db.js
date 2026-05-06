require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fixDB() {
    try {
        await pool.query('DROP TABLE IF EXISTS attendance');
        await pool.query(`
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
        console.log('Attendance table fixed.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
fixDB();
