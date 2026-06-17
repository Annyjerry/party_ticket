require('dotenv').config();
const nodemailer = require('nodemailer');

console.log("Testing email with user:", process.env.EMAIL_USER);

// Let's use the explicit Google SMTP settings, which are much more reliable
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER, // Sending it to yourself
    subject: '🚨 Server Test Email',
    text: 'If you are reading this, Nodemailer is working perfectly!'
};

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.log('❌ FAILED TO SEND EMAIL!');
        console.log('Exact Error Message:', error.message);
    } else {
        console.log('✅ EMAIL SENT SUCCESSFULLY!');
        console.log('Server Response:', info.response);
    }
});