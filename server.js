require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Serve the frontend files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./tickets.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY,
        type TEXT,
        status TEXT DEFAULT 'valid',
        used_time TEXT,
        reference TEXT UNIQUE
    )`);
});

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

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

            db.run(`INSERT INTO tickets (ticket_id, type, reference) VALUES (?, ?, ?)`, 
                [ticketId, ticketType, reference], 
                function(err) {
                    if (err) return res.status(400).json({ error: 'Ticket already generated.' });
                    res.json({ success: true, ticketId, type: ticketType });
            });
        } else {
            res.status(400).json({ error: 'Payment verification failed.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error verifying payment.' });
    }
});

// --- VERIFY TICKET AT THE GATE ---
app.post('/check-ticket', (req, res) => {
    const { ticketId } = req.body;

    db.get(`SELECT * FROM tickets WHERE ticket_id = ?`, [ticketId], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!row) return res.json({ status: 'FAKE', message: 'Fake Ticket! Not found in system.' });
        if (row.status === 'used') return res.json({ status: 'USED', message: `Already Scanned at ${row.used_time}` });

        const usedTime = new Date().toLocaleString();
        db.run(`UPDATE tickets SET status = 'used', used_time = ? WHERE ticket_id = ?`, [usedTime, ticketId], (updateErr) => {
            if (updateErr) return res.status(500).json({ error: 'Failed to update ticket' });
            res.json({ status: 'VALID', message: `Success! Admit 1 for ${row.type}`, type: row.type });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));