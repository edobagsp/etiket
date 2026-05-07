require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    if (req.method !== 'GET') console.log('Body:', JSON.stringify(req.body));
    next();
});

// ==================== DATABASE INIT ====================
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id TEXT PRIMARY KEY,
                issue TEXT NOT NULL,
                description TEXT DEFAULT '',
                location TEXT NOT NULL,
                "user" TEXT NOT NULL,
                date TEXT NOT NULL,
                priority TEXT DEFAULT 'NORMAL',
                status TEXT DEFAULT 'OPEN',
                pic TEXT DEFAULT ''
            )
        `);

        // Migration: Add perbaikan column
        try {
            await client.query("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS perbaikan TEXT DEFAULT ''");
        } catch (e) {
            console.log("Migration: perbaikan column already exists or error occurred", e.message);
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                pcid TEXT DEFAULT '',
                namastaff TEXT DEFAULT '',
                location TEXT DEFAULT 'Semarang',
                workertype TEXT DEFAULT 'Staff',
                type TEXT DEFAULT '',
                cpu TEXT DEFAULT '',
                ram TEXT DEFAULT '',
                gpu TEXT DEFAULT '',
                ssdm2 TEXT DEFAULT '',
                hdd1 TEXT DEFAULT '',
                lastmaintenance TEXT DEFAULT '',
                lastmaintenancenotes TEXT DEFAULT '',
                rfid TEXT DEFAULT ''
            )
        `);

        // Migration: Add rfid column if not exists
        try {
            await client.query("ALTER TABLE assets ADD COLUMN IF NOT EXISTS rfid TEXT DEFAULT ''");
        } catch (e) {
            console.log("Migration: rfid column already exists or error occurred", e.message);
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS maintenance_schedule (
                id SERIAL PRIMARY KEY,
                asset_id TEXT NOT NULL,
                pcid TEXT DEFAULT '',
                namastaff TEXT DEFAULT '',
                location TEXT DEFAULT '',
                scheduled_date TEXT NOT NULL,
                status TEXT DEFAULT 'PENDING',
                notes TEXT DEFAULT ''
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                "user" TEXT NOT NULL,
                rating INTEGER DEFAULT 5,
                comment TEXT DEFAULT '',
                status TEXT DEFAULT 'PENDING',
                date TEXT DEFAULT ''
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS attendance (
                id SERIAL PRIMARY KEY,
                rfid TEXT NOT NULL,
                "user" TEXT NOT NULL,
                worker_type TEXT NOT NULL,
                type TEXT NOT NULL, -- 'MASUK' or 'PULANG'
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                date_str TEXT NOT NULL -- YYYY-MM-DD for daily check
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS staff_profiles (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                worker_type TEXT NOT NULL,
                rfid TEXT UNIQUE NOT NULL,
                employment_period TEXT DEFAULT '',
                location TEXT DEFAULT 'Semarang'
            )
        `);

        // Migration: Add location to staff_profiles
        try { await client.query("ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS location TEXT DEFAULT 'Semarang'"); } catch (e) {}

        await client.query(`
            CREATE TABLE IF NOT EXISTS maintenance_schedule (
                id SERIAL PRIMARY KEY,
                asset_id TEXT NOT NULL,
                pcid TEXT DEFAULT '',
                namastaff TEXT DEFAULT '',
                location TEXT DEFAULT '',
                scheduled_date TEXT NOT NULL,
                status TEXT DEFAULT 'PENDING',
                notes TEXT DEFAULT '',
                is_approved BOOLEAN DEFAULT FALSE,
                approved_by TEXT DEFAULT ''
            )
        `);

        // Migration: Add approval columns to maintenance_schedule
        try { await client.query("ALTER TABLE maintenance_schedule ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT FALSE"); } catch (e) {}
        try { await client.query("ALTER TABLE maintenance_schedule ADD COLUMN IF NOT EXISTS approved_by TEXT DEFAULT ''"); } catch (e) {}

        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('❌ DB init error:', err.message);
    } finally {
        client.release();
    }
}

// ==================== TICKET ROUTES ====================
app.get('/api/tickets', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tickets ORDER BY date DESC');
        const tickets = result.rows.map(row => ({
            id: row.id,
            issue: row.issue,
            description: row.description,
            location: row.location,
            user: row.user,
            date: row.date,
            priority: row.priority,
            status: row.status,
            pic: row.pic,
            perbaikan: row.perbaikan
        }));
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tickets', async (req, res) => {
    try {
        const { id, issue, desc, location, user, date, priority, status } = req.body;
        await pool.query(
            `INSERT INTO tickets (id, issue, description, location, "user", date, priority, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, issue, desc || '', location, user, date, priority || 'NORMAL', status || 'OPEN']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/tickets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, pic, perbaikan } = req.body;
        await pool.query(
            `UPDATE tickets SET status = COALESCE($1, status), pic = COALESCE($2, pic), perbaikan = COALESCE($3, perbaikan) WHERE id = $4`,
            [status, pic, perbaikan, id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tickets/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM tickets WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ASSET ROUTES (with pagination) ====================
app.get('/api/assets', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = (req.query.search || '').toLowerCase();
        const offset = (page - 1) * limit;

        let countQuery = 'SELECT COUNT(*) as total FROM assets';
        let dataQuery = 'SELECT * FROM assets';
        const params = [];

        if (search) {
            const searchFilter = ` WHERE LOWER(id) LIKE $1 OR LOWER(namastaff) LIKE $1 OR LOWER(location) LIKE $1 OR LOWER(pcid) LIKE $1`;
            countQuery += searchFilter;
            dataQuery += searchFilter;
            params.push(`%${search}%`);
        }

        // Count total
        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].total);

        // Order by ID descending (newest/bottom first) + pagination
        const pIdx = params.length;
        dataQuery += ` ORDER BY id DESC LIMIT $${pIdx + 1} OFFSET $${pIdx + 2}`;
        params.push(limit, offset);

        const result = await pool.query(dataQuery, params);
        const assets = result.rows.map(row => ({
            id: row.id,
            pcId: row.pcid,
            namaStaff: row.namastaff,
            location: row.location,
            workerType: row.workertype,
            type: row.type,
            cpu: row.cpu,
            ram: row.ram,
            gpu: row.gpu,
            ssdM2: row.ssdm2,
            hdd1: row.hdd1,
            lastMaintenance: row.lastmaintenance,
            lastMaintenanceNotes: row.lastmaintenancenotes,
            rfid: row.rfid
        }));

        res.json({
            data: assets,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get ALL assets (no pagination, for maintenance/schedule/stats)
app.get('/api/assets/all', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM assets ORDER BY id ASC');
        const assets = result.rows.map(row => ({
            id: row.id,
            pcId: row.pcid,
            namaStaff: row.namastaff,
            location: row.location,
            workerType: row.workertype,
            type: row.type,
            cpu: row.cpu,
            ram: row.ram,
            gpu: row.gpu,
            ssdM2: row.ssdm2,
            hdd1: row.hdd1,
            lastMaintenance: row.lastmaintenance,
            lastMaintenanceNotes: row.lastmaintenancenotes,
            rfid: row.rfid
        }));
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/assets', async (req, res) => {
    try {
        const { id, pcId, namaStaff, location, workerType, type, cpu, ram, gpu, ssdM2, hdd1, rfid } = req.body;
        
        // Check if ID already exists
        const existing = await pool.query('SELECT id FROM assets WHERE id = $1', [id]);
        if (existing.rows.length > 0) {
            return res.status(409).send(`Asset dengan ID "${id}" sudah ada.`);
        }

        await pool.query(
            `INSERT INTO assets (id, pcid, namastaff, location, workertype, type, cpu, ram, gpu, ssdm2, hdd1, lastmaintenance, rfid)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id, pcId || '', namaStaff || '', location || 'Semarang', workerType || 'Staff',
             type || '', cpu || '', ram || '', gpu || '', ssdM2 || '', hdd1 || '', '', rfid || '']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/assets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { pcId, namaStaff, location, workerType, type, cpu, ram, gpu, ssdM2, hdd1, lastMaintenance, lastMaintenanceNotes } = req.body;
        
        const fields = [];
        const values = [];
        let idx = 1;

        if (pcId !== undefined) { fields.push(`pcid = $${idx++}`); values.push(pcId); }
        if (namaStaff !== undefined) { fields.push(`namastaff = $${idx++}`); values.push(namaStaff); }
        if (location !== undefined) { fields.push(`location = $${idx++}`); values.push(location); }
        if (workerType !== undefined) { fields.push(`workertype = $${idx++}`); values.push(workerType); }
        if (type !== undefined) { fields.push(`type = $${idx++}`); values.push(type); }
        if (cpu !== undefined) { fields.push(`cpu = $${idx++}`); values.push(cpu); }
        if (ram !== undefined) { fields.push(`ram = $${idx++}`); values.push(ram); }
        if (gpu !== undefined) { fields.push(`gpu = $${idx++}`); values.push(gpu); }
        if (ssdM2 !== undefined) { fields.push(`ssdm2 = $${idx++}`); values.push(ssdM2); }
        if (hdd1 !== undefined) { fields.push(`hdd1 = $${idx++}`); values.push(hdd1); }
        if (lastMaintenance !== undefined) { fields.push(`lastmaintenance = $${idx++}`); values.push(lastMaintenance); }
        if (lastMaintenanceNotes !== undefined) { fields.push(`lastmaintenancenotes = $${idx++}`); values.push(lastMaintenanceNotes); }
        if (req.body.rfid !== undefined) { fields.push(`rfid = $${idx++}`); values.push(req.body.rfid); }

        if (fields.length === 0) return res.status(400).send('No fields to update');

        values.push(id);
        await pool.query(`UPDATE assets SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/assets/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM assets WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== MAINTENANCE SCHEDULE ROUTES ====================
app.get('/api/maintenance-schedule', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM maintenance_schedule ORDER BY id ASC');
        const schedule = result.rows.map(row => ({
            id: row.id,
            assetId: row.assetid || row.asset_id,
            pcId: row.pcid,
            namaStaff: row.namastaff,
            location: row.location,
            scheduledDate: row.scheduleddate || row.scheduled_date,
            status: row.status,
            notes: row.notes,
            isApproved: row.is_approved,
            approvedBy: row.approved_by
        }));
        res.json(schedule);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/maintenance-schedule/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledDate, status, notes, pcId, isApproved, approvedBy, location } = req.body;

        const fields = [];
        const values = [];
        let idx = 1;

        if (scheduledDate !== undefined) { fields.push(`scheduled_date = $${idx++}`); values.push(scheduledDate); }
        if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
        if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }
        if (pcId !== undefined) { fields.push(`pcid = $${idx++}`); values.push(pcId); }
        if (isApproved !== undefined) { fields.push(`is_approved = $${idx++}`); values.push(isApproved); }
        if (approvedBy !== undefined) { fields.push(`approved_by = $${idx++}`); values.push(approvedBy); }
        if (location !== undefined) { fields.push(`location = $${idx++}`); values.push(location); }

        if (fields.length === 0) return res.status(400).send('No fields to update');

        values.push(parseInt(id));
        await pool.query(`UPDATE maintenance_schedule SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/maintenance-schedule', async (req, res) => {
    try {
        const { assetId, pcId, namaStaff, location, scheduledDate, status, isApproved, approvedBy } = req.body;
        await pool.query(
            `INSERT INTO maintenance_schedule (assetid, pcid, namastaff, location, scheduleddate, status, is_approved, approved_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [assetId, pcId || '', namaStaff || '', location || '', scheduledDate, status || 'PENDING', isApproved || false, approvedBy || '']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/maintenance-schedule/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM maintenance_schedule WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// ==================== FEEDBACK ROUTES ====================
// Public: only approved feedback
app.get('/api/feedback', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM feedback WHERE status = 'APPROVED' ORDER BY id DESC`
        );
        const feedbacks = result.rows.map(row => ({
            id: row.id,
            user: row.user,
            rating: row.rating,
            comment: row.comment,
            status: row.status,
            date: row.date
        }));
        res.json(feedbacks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: all feedback
app.get('/api/feedback/admin', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM feedback ORDER BY id DESC');
        const feedbacks = result.rows.map(row => ({
            id: row.id,
            user: row.user,
            rating: row.rating,
            comment: row.comment,
            status: row.status,
            date: row.date
        }));
        res.json(feedbacks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/feedback', async (req, res) => {
    try {
        const { user, rating, comment } = req.body;
        const date = new Date().toISOString().split('T')[0];
        await pool.query(
            `INSERT INTO feedback ("user", rating, comment, status, date)
             VALUES ($1, $2, $3, 'PENDING', $4)`,
            [user, rating || 5, comment || '', date]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/feedback/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        await pool.query(
            `UPDATE feedback SET status = $1 WHERE id = $2`,
            [status, parseInt(id)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/feedback/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM feedback WHERE id = $1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== STAFF PROFILE ROUTES ====================
app.get('/api/staff', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM staff_profiles ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/staff', async (req, res) => {
    try {
        const { name, worker_type, rfid, employment_period, location } = req.body;
        await pool.query(
            'INSERT INTO staff_profiles (name, worker_type, rfid, employment_period, location) VALUES ($1, $2, $3, $4, $5)',
            [name, worker_type, rfid, employment_period, location || 'Semarang']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving staff:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/staff/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, worker_type, rfid, employment_period, location } = req.body;
        await pool.query(
            'UPDATE staff_profiles SET name=$1, worker_type=$2, rfid=$3, employment_period=$4, location=$5 WHERE id=$6',
            [name, worker_type, rfid, employment_period, location, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating staff:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/staff/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM staff_profiles WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ATTENDANCE ROUTES ====================
app.post('/api/attendance', async (req, res) => {
    try {
        const { rfid } = req.body;
        if (!rfid) return res.status(400).json({ error: 'RFID is required' });

        // 1. Lookup User by RFID in staff_profiles table
        const userRes = await pool.query('SELECT name, worker_type FROM staff_profiles WHERE rfid = $1 LIMIT 1', [rfid]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Kartu RFID tidak terdaftar di sistem pegawai!' });
        }
        const { name, worker_type } = userRes.rows[0];
        const namastaff = name;
        const workertype = worker_type;

        // 2. Anti-spam: Check last 1 hour
        const cooldownRes = await pool.query(
            `SELECT timestamp FROM attendance 
             WHERE rfid = $1 AND timestamp > NOW() - INTERVAL '1 hour' 
             ORDER BY timestamp DESC LIMIT 1`,
            [rfid]
        );
        if (cooldownRes.rows.length > 0) {
            return res.status(429).json({ error: 'Anda sudah absen. Tunggu 1 jam untuk tap kembali.' });
        }

        // 3. Determine MASUK or PULANG (toggle daily)
        const dateStr = new Date().toISOString().split('T')[0];
        const dailyRes = await pool.query(
            'SELECT type FROM attendance WHERE rfid = $1 AND date_str = $2 ORDER BY timestamp DESC LIMIT 1',
            [rfid, dateStr]
        );
        
        let type = 'MASUK';
        if (dailyRes.rows.length > 0 && dailyRes.rows[0].type === 'MASUK') {
            type = 'PULANG';
        }

        // 4. Save attendance
        await pool.query(
            `INSERT INTO attendance (rfid, "user", worker_type, type, date_str)
             VALUES ($1, $2, $3, $4, $5)`,
            [rfid, namastaff, workertype, type, dateStr]
        );

        res.json({ 
            success: true, 
            message: `Absen ${type} Berhasil!`,
            data: { name: namastaff, type, workerType: workertype, time: new Date().toLocaleTimeString('id-ID') }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/attendance', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.*, s.location 
            FROM attendance a 
            LEFT JOIN staff_profiles s ON a.rfid = s.rfid 
            ORDER BY a.timestamp DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== ADMIN RESET DATABASE ====================
app.post('/api/admin/reset-db', async (req, res) => {
    const { code } = req.body;
    if (code !== '12345') {
        return res.status(403).json({ error: 'Kode reset salah!' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('TRUNCATE TABLE tickets, assets, maintenance_schedule, feedback RESTART IDENTITY CASCADE');
        await client.query('COMMIT');
        res.json({ success: true, message: 'Database berhasil di-reset!' });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// ==================== PROCESS LISTENERS ====================
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

process.on('exit', (code) => {
    console.log(`About to exit with code: ${code}`);
});

// ==================== START SERVER ====================
initDB();

module.exports = app;