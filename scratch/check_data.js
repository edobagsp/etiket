require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkData() {
    const client = await pool.connect();
    try {
        console.log("Fetching first 5 assets...");
        const res = await client.query("SELECT id, pcid, namastaff, rfid FROM assets LIMIT 5");
        console.table(res.rows);
        
        console.log("Checking if column 'rfid' exists in information_schema...");
        const colRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'assets' AND column_name = 'rfid'
        `);
        console.log("RFID Column Info:", colRes.rows);

    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

checkData();
