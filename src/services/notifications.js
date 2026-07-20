/**
 * Notification Service — Email + SMS
 * Sends order confirmations and status updates
 */

const nodemailer = require('nodemailer');

let transporter = null;
let twilioClient = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('⚠ SMTP not configured — email notifications disabled');
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

function getTwilio() {
  if (twilioClient) return twilioClient;
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('⚠ Twilio not configured — SMS notifications disabled');
    return null;
  }
  try {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    return twilioClient;
  } catch {
    return null;
  }
}

/**
 * Send order confirmation email
 */
/**
 * Normalize order fields — handles both camelCase (from in-memory) and snake_case (from DB)
 */
function normalizeOrder(order) {
  return {
    id: order.id,
    customer_name: order.customerName || order.customer_name,
    customer_email: order.customerEmail || order.customer_email,
    customer_mobile: order.customerMobile || order.customer_mobile,
    items_by_meal: order.itemsByMeal || order.items_by_meal || {},
    total: order.total,
    payment_method: order.paymentMethod || order.payment_method,
  };
}

async function sendOrderConfirmationEmail(order) {
  const transport = getTransporter();
  const n = normalizeOrder(order);
  if (!transport || !n.customer_email) return;

  const itemsHtml = Object.entries(n.items_by_meal || {})
    .map(([meal, items]) => `
      <h3 style="color: #D9A441; margin: 12px 0 4px;">${meal}</h3>
      <ul>${items.map(i => `<li>${i.name} × ${i.qty} — ₹${i.price * i.qty}</li>`).join('')}</ul>
    `).join('');

  const mailOptions = {
    from: `"Thali Plan" <${process.env.NOTIFICATION_EMAIL || 'noreply@thaliplan.com'}>`,
    to: n.customer_email,
    subject: `🧆 Order Confirmed #${n.id.slice(-8)} — Thali Plan`,
    html: `
      <div style="font-family: Inter, sans-serif; max-width: 540px; margin: 0 auto;">
        <div style="background: #1E1B18; color: #F1EAE0; padding: 28px; border-radius: 12px;">
          <h1 style="font-family: Fraunces, serif; color: #D9A441; margin: 0 0 6px;">Order placed 🎉</h1>
          <p style="color: #B7ACA0; font-size: 14px;">Thanks, ${n.customer_name}! Your kitchen is now preparing your meal.</p>
          <hr style="border: none; border-top: 1px solid #433A32; margin: 20px 0;">
          <p style="font-size: 13px; color: #8A7E72; font-family: 'IBM Plex Mono', monospace;">Order #${n.id.slice(-8)}</p>
          ${itemsHtml}
          <hr style="border: none; border-top: 1px solid #433A32; margin: 16px 0;">
          <div style="display: flex; justify-content: space-between; font-size: 16px; font-weight: 700;">
            <span>Total</span>
            <span style="color: #D9A441;">₹${n.total}</span>
          </div>
          <p style="color: #8A7E72; font-size: 12px; margin-top: 16px;">
            Payment: ${n.payment_method === 'upi' ? '✅ Paid via UPI' : '💵 Cash on delivery'}
          </p>
          <hr style="border: none; border-top: 1px solid #433A32; margin: 20px 0;">
          <p style="color: #B7ACA0; font-size: 12px; text-align: center;">
            Thali Plan — Custom meals from local kitchens
          </p>
        </div>
      </div>
    `,
  };

  try {
    await transport.sendMail(mailOptions);
    console.log(`✓ Confirmation email sent to ${n.customer_email}`);
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
}

/**
 * Send SMS notification via Twilio
 */
async function sendSMS(to, message) {
  const client = getTwilio();
  if (!client) return;

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    console.log(`✓ SMS sent to ${to}`);
  } catch (err) {
    console.error('SMS send failed:', err.message);
  }
}

/**
 * Send WhatsApp message via Twilio WhatsApp API
 * Falls back gracefully if WhatsApp sender is not configured
 */
async function sendWhatsApp(to, message) {
  const whatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!whatsappFrom) {
    console.log('ℹ WhatsApp sender not configured (set TWILIO_WHATSAPP_NUMBER in .env) — falling back to SMS');
    return await sendSMS(to, message);
  }

  const client = getTwilio();
  if (!client) return;

  try {
    await client.messages.create({
      from: `whatsapp:${whatsappFrom}`,
      body: message,
      to: `whatsapp:${to}`,
    });
    console.log(`✓ WhatsApp sent to ${to}`);
  } catch (err) {
    console.error('WhatsApp send failed:', err.message);
    // Fallback to SMS on failure
    console.log('ℹ Falling back to SMS');
    await sendSMS(to, message);
  }
}

/**
 * Send an order confirmation via WhatsApp
 */
async function sendOrderConfirmationWhatsApp(order) {
  const n = normalizeOrder(order);
  if (!n.customer_mobile) return;

  const itemsSummary = Object.entries(n.items_by_meal || {})
    .map(([meal, items]) => `${meal}: ${items.map(i => `${i.name} ×${i.qty}`).join(', ')}`)
    .join('\n');

  const message = `🧆 *Thali Plan Order Confirmed* #${n.id.slice(-8)}\n\nThanks ${n.customer_name}! Your kitchen is preparing your meal.\n\n${itemsSummary}\n\nTotal: ₹${n.total}\nPayment: ${n.payment_method === 'upi' ? '✅ Paid via UPI' : '💵 Cash on delivery'}\n\n— Thali Plan`;

  await sendWhatsApp(n.customer_mobile, message);
}

/**
 * Send status update notification — WhatsApp + Email + SMS
 */
async function sendStatusUpdate(order, newStatus) {
  const statusMessages = {
    confirmed: `🧆 ${order.customer_name}, your Thali Plan order #${order.id.slice(-8)} is confirmed! The kitchen will start prep soon.`,
    preparing: `👨‍🍳 ${order.customer_name}, your order #${order.id.slice(-8)} is being prepared now!`,
    out_for_delivery: `🛵 ${order.customer_name}, your meal is out for delivery!`,
    delivered: `✅ ${order.customer_name}, your order #${order.id.slice(-8)} has been delivered. Enjoy! — Thali Plan`,
  };

  const message = statusMessages[newStatus];
  if (!message) return;

  // Email
  if (order.customer_email) {
    const transport = getTransporter();
    if (transport) {
      try {
        await transport.sendMail({
          from: `"Thali Plan" <${process.env.NOTIFICATION_EMAIL || 'noreply@thaliplan.com'}>`,
          to: order.customer_email,
          subject: `🔄 Order Update #${order.id.slice(-8)}: ${newStatus.replace(/_/g, ' ')}`,
          html: `<div style="font-family: Inter, sans-serif; background: #1E1B18; color: #F1EAE0; padding: 24px; border-radius: 12px; max-width: 480px;"><p>${message}</p></div>`,
        });
      } catch {}
    }
  }

  // WhatsApp (with SMS fallback)
  if (order.customer_mobile) {
    await sendWhatsApp(order.customer_mobile, message);
  }
}

module.exports = {
  sendOrderConfirmationEmail,
  sendOrderConfirmationWhatsApp,
  sendStatusUpdate,
  sendSMS,
  sendWhatsApp,
};
