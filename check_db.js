require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
    try {
        const cols = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'assets' ORDER BY ordinal_position"
        );
        console.log('COLUMNS:', cols.rows.map(x => x.column_name));
        
        const data = await pool.query('SELECT * FROM assets LIMIT 3');
        console.log('SAMPLE DATA:', JSON.stringify(data.rows, null, 2));
        
        const count = await pool.query('SELECT COUNT(*) as total FROM assets');
        console.log('TOTAL ASSETS:', count.rows[0].total);
    } catch (e) {
        console.error(e);
    }
    process.exit();
}
check();
