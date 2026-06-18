require('dotenv').config();
const express = require('express');
const { Pool } = require('pg'); 
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const nodemailer = require('nodemailer'); // <--- NEW EMAIL TOOL

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// --- DATABASE SETUP ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } 
});

pool.query(`CREATE TABLE IF NOT EXISTS tickets (
    ticket_id VARCHAR(50) PRIMARY KEY,
    type VARCHAR(50),
    status VARCHAR(20) DEFAULT 'valid',
    used_time VARCHAR(100),
    reference VARCHAR(100) UNIQUE,
    email VARCHAR(200)
)`).then(() => {
    return pool.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS email VARCHAR(200)`);
}).catch(err => console.error("Database Setup Error:", err));

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


// --- GENERATE TICKET & SEND EMAIL ---
app.post('/verify-payment', async (req, res) => {
    // We now receive the user's email from the frontend
    const { reference, ticketType, email } = req.body; 

    try {
        const paystackRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
        });

        if (paystackRes.data.data.status === 'success') {
            const prefix = ticketType.substring(0, 3).toUpperCase();
            const randomString = crypto.randomBytes(3).toString('hex').toUpperCase();
            const ticketId = `${prefix}-${randomString}`;

            try {
                // 1. Save to Database
                await pool.query(
                    `INSERT INTO tickets (ticket_id, type, reference, email) VALUES ($1, $2, $3, $4)`, 
                    [ticketId, ticketType, reference, email]
                );

                // 2. Send the Email
                const partyVenue = "Perly gate residence -Party House paradise"; // Update your venue here!
                
                const mailOptions = {
                    from: `"Party with sadly happy" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: '🎫 Your Official Party Ticket & Venue Details',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                            <h2 style="color: #000; text-align: center;">Payment Successful!</h2>
                            <p>Thank you for purchasing your ticket to <strong>Party with sadly happy</strong>.</p>
                            
                            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
                                <p style="margin: 0; color: #555;">Your Ticket ID</p>
                                <h1 style="margin: 5px 0; color: #000; letter-spacing: 2px;">${ticketId}</h1>
                                <p style="margin: 0; font-weight: bold; color: #ff6c2d;">${ticketType.toUpperCase()} PASS</p>
                            </div>

                            <h3 style="border-bottom: 1px solid #ddd; padding-bottom: 5px;">Event Details</h3>
                            <p><strong>Date:</strong> July 5, 2026</p>
                            <p><strong>Venue:</strong> ${partyVenue}</p>
                            
                            <p style="color: #777; font-size: 0.9em; text-align: center; margin-top: 30px;">
                                <strong>Please screenshot this or copy the Ticket ID and save it securely.</strong> Do not share this Ticket ID with anyone.
                            </p>
                        </div>
                    `
                };

                // Send email in the background (does not make the user wait)
                transporter.sendMail(mailOptions, (err, info) => {
                    if (err) console.error("Email failed to send:", err);
                });

                // 3. Respond to the Frontend
                res.json({ success: true, ticketId, type: ticketType, venue: partyVenue });

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

// --- ADMIN LOGIN ---
app.post('/admin-login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false, message: 'Incorrect Password' });
});

// --- VERIFY TICKET (GATE) ---
app.post('/check-ticket', async (req, res) => {
    const { ticketId, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });

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

// --- RECOVER LOST TICKET BY REFERENCE ---
app.post('/search-reference', async (req, res) => {
    const { reference, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(401).json({ status: 'ERROR', message: 'Unauthorized' });

    try {
        const result = await pool.query(`SELECT ticket_id, type, status, email FROM tickets WHERE reference = $1`, [reference]);
        const row = result.rows[0];

        if (!row) return res.json({ found: false, message: 'No ticket found.' });
        res.json({ found: true, ticketId: row.ticket_id, type: row.type, status: row.status, email: row.email });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));