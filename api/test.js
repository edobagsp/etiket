require('dotenv').config();
const { Pool } = require('pg');

module.exports = async (req, res) => {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM staff_profiles LIMIT 5');
        client.release();
        
        res.status(200).json({
            status: 'Success',
            message: 'Koneksi ke Neon Tech Berhasil!',
            data: result.rows
        });
    } catch (err) {
        res.status(500).json({
            status: 'Error',
            message: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    } finally {
        await pool.end();
    }
};
