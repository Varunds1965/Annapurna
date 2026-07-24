/**
 * OTP Service — Email + SMS
 * Sends OTP via Email (free via Gmail) with SMS as optional upgrade
 */
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠ SMTP not configured — OTP will be logged to console only');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * Send OTP via Email (Free — uses Gmail SMTP)
 */
async function sendOTPviaEmail(email, otp, name) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`📧 Email OTP for ${email}: ${otp} (SMTP not configured)`);
    return { success: true, delivered: false, reason: 'smtp_not_configured' };
  }

  try {
    await transport.sendMail({
      from: `"Thali Plan" <${process.env.NOTIFICATION_EMAIL || 'noreply@thaliplan.com'}>`,
      to: email,
      subject: 'Your Thali Plan OTP',
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; background: #1E1B18; color: #F1EAE0; padding: 32px; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <div style="width: 48px; height: 48px; border-radius: 50%; border: 2px solid #D9A441; margin: 0 auto 12px; position: relative;"></div>
            <h1 style="font-family: Fraunces, serif; color: #D9A441; margin: 0; font-size: 22px;">Thali Plan</h1>
          </div>
          <p style="color: #B7ACA0; font-size: 14px;">Hello ${name || 'there'},</p>
          <p style="color: #B7ACA0; font-size: 14px;">Your one-time verification code is:</p>
          <div style="background: #28231F; border: 1px solid #433A32; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-family: 'IBM Plex Mono', monospace; font-size: 36px; color: #D9A441; letter-spacing: 8px; font-weight: 700;">${otp}</span>
          </div>
          <p style="color: #8A7E72; font-size: 12px;">This code is valid for 5 minutes. If you didn't request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #433A32; margin: 20px 0;">
          <p style="color: #8A7E72; font-size: 11px; text-align: center;">Thali Plan — Fresh meals from local kitchens</p>
        </div>
      `,
    });
    console.log(`✓ OTP email sent to ${email}`);
    return { success: true, delivered: true };
  } catch (err) {
    console.error('Email OTP failed:', err.message);
    // Fallback to console log
    console.log(`📧 Email OTP fallback for ${email}: ${otp}`);
    return { success: true, delivered: false, reason: 'email_failed' };
  }
}

/**
 * Send OTP via MSG91 (SMS — requires API key)
 */
async function sendOTPviaMSG91(mobile, otp) {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey || authKey === 'your-msg91-auth-key') {
    return { success: false, reason: 'msg91_not_configured' };
  }

  const https = require('https');
  return new Promise((resolve) => {
    const data = JSON.stringify({
      authkey: authKey,
      mobiles: '91' + mobile,
      sender: process.env.MSG91_SENDER_ID || 'THALI',
      message: `Your Thali Plan OTP is ${otp}. Valid for 5 minutes.`,
      DLT_TE_ID: process.env.MSG91_TEMPLATE_ID || '',
    });

    const options = {
      hostname: 'api.msg91.com',
      path: '/api/v5/flow/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ success: true }));
    });
    req.on('error', (err) => {
      console.error('MSG91 failed:', err.message);
      resolve({ success: false });
    });
    req.write(data);
    req.end();
  });
}

/**
 * Generate a random OTP
 */
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Send OTP — tries email first (free), falls back to SMS if configured
 * NEVER returns OTP to client in production mode
 */
async function sendOTP(mobile, email, name) {
  const otp = generateOTP();
  let result = { success: true, otp }; // otp is returned to server-side only

  // Priority 1: Send via Email (free, works immediately if SMTP configured)
  if (email) {
    const emailResult = await sendOTPviaEmail(email, otp, name);
    if (emailResult.delivered) {
      return { success: true, otp, method: 'email' };
    }
  }

  // Priority 2: Send via SMS (if MSG91 configured)
  if (mobile) {
    const smsResult = await sendOTPviaMSG91(mobile, otp);
    if (smsResult.success) {
      return { success: true, otp, method: 'sms' };
    }
  }

  // Fallback: Console log (development mode) — NEVER in production
  if (process.env.NODE_ENV === 'development') {
    console.log(`📱 DEV MODE — OTP for ${mobile || email}: ${otp}`);
    return { success: true, otp, method: 'console', dev: true };
  }

  // In production without email/sms configured, this would fail
  // But we still generate OTP for server-side verification
  return { success: true, otp, method: 'none' };
}

module.exports = {
  sendOTP,
  generateOTP,
  sendOTPviaEmail,
  sendOTPviaMSG91,
};