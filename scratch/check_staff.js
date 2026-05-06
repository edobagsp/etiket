require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("SELECT name, rfid, location, worker_type FROM staff_profiles WHERE rfid = '0012016657'")
    .then(res => { console.log(JSON.stringify(res.rows, null, 2)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
