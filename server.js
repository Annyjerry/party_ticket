require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve the frontend files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// --- SECURE CLOUD DATABASE SETUP ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Render
});

// Create the tickets table if it doesn't exist
pool.query(`CREATE TABLE IF NOT EXISTS tickets (
    ticket_id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'valid',
    used_time VARCHAR(100),
    reference VARCHAR(100) UNIQUE
)`).catch(err => console.error("Database Setup Error:", err));

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- GENERATE TICKET AFTER PAYMENT ---
app.post('/verify-payment', async (req, res) => {
    const { reference, ticketType } = req.body;

    try {
        const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (paystackRes.data.data.status === 'success') {
            const prefix = ticketType.substring(0, 3).toUpperCase();
            const randomString = crypto.randomBytes(3).toString('hex').toUpperCase();
            const ticketId = `${prefix}-${randomString}`;

            try {
                // Save to Postgres
                await pool.query(
                    `INSERT INTO tickets (ticket_id, type, reference) VALUES ($1, $2, $3)`, 
                    [ticketId, ticketType, reference]
                );
                res.json({ success: true, ticketId, type: ticketType });
            } catch (dbErr) {
                res.status(400).json({ error: 'Ticket already generated for this payment.' });
            }
        } else {
            res.status(400).json({ error: 'Payment verification failed.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error verifying payment.' });
    }
});

// --- LOGIN FOR ADMIN PAGE ---
app.post('/admin-login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Incorrect Password' });
    }
});

// --- VERIFY TICKET AT THE GATE (SECURED) ---
app.post('/check-ticket', async (req, res) => {
    const { ticketId, password } = req.body;

    // Security Check: Block unauthorized requests
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ status: 'ERROR', message: 'Unauthorized: Bad Password' });
    }

    try {
        const result = await pool.query(`SELECT * FROM tickets WHERE ticket_id = $1`, [ticketId]);
        const row = result.rows[0];

        if (!row) return res.json({ status: 'FAKE', message: 'Fake Ticket! Not found in system.' });
        if (row.status === 'used') return res.json({ status: 'USED', message: `Already Scanned at ${row.used_time}` });

        const usedTime = new Date().toLocaleString();
        await pool.query(`UPDATE tickets SET status = 'used', used_time = $1 WHERE ticket_id = $2`, [usedTime, ticketId]);
        
        res.json({ status: 'VALID', message: `Success! Admit 1 for ${row.type}`, type: row.type });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// --- START THE SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));