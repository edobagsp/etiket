require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("SELECT DISTINCT type FROM attendance")
    .then(res => { console.log(JSON.stringify(res.rows, null, 2)); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
