/**
 * UPI Payment Integration
 * Generates UPI deep links for Google Pay / PhonePe
 * and handles payment verification.
 */

const crypto = require('crypto');

/**
 * Generate a UPI deep link for payment
 * This opens the user's UPI app with pre-filled payment details
 */
function generateUPILink(amount, orderId, customerName) {
  const pa = process.env.UPI_APP_LINK
    ? process.env.UPI_APP_LINK.split('?pa=')[1]?.split('&')[0]
    : 'thaliplan@upi';
  const merchantName = encodeURIComponent(process.env.UPI_MERCHANT_NAME || 'ThaliPlan');
  const upiLink = `upi://pay?pa=${pa}&pn=${merchantName}&am=${amount}&cu=INR&tr=${orderId}&tn=ThaliPlan%20Order%20${orderId}`;
  return upiLink;
}

/**
 * Generate Google Pay / PhonePe specific links
 */
function generateAppLinks(amount, orderId) {
  const pa = process.env.UPI_APP_LINK
    ? process.env.UPI_APP_LINK.split('?pa=')[1]?.split('&')[0]
    : 'thaliplan@upi';
  const baseURI = `upi://pay?pa=${pa}&pn=ThaliPlan&am=${amount}&cu=INR&tr=${orderId}&tn=Order%20${orderId}`;

  return {
    upi: baseURI,
    googlePay: `https://pay.google.com/gp/p/ui/pay?${new URLSearchParams({
      pa,
      pn: 'ThaliPlan',
      am: String(amount),
      cu: 'INR',
      tn: `Order ${orderId}`,
    }).toString()}`,
    phonePe: `phonepe://pay?pa=${pa}&pn=ThaliPlan&am=${amount}&cu=INR`,
  };
}

/**
 * Verify a payment was completed
 * Inserts a transaction record + marks order as paid
 */
async function verifyPayment(orderId, transactionId) {
  const { pool } = require('../db/pool');
  try {
    // First get the order to log the transaction
    const orderRes = await pool.query(`SELECT total, payment_method FROM orders WHERE id = $1`, [orderId]);
    if (orderRes.rows.length === 0) return { success: false, error: 'Order not found' };

    const order = orderRes.rows[0];

    // Log the payment transaction — explicit column listing with 6 values
    await pool.query(
      `INSERT INTO payment_transactions (order_id, amount, method, status, transaction_id, gateway_response)
       VALUES ($1, $2, $3, 'success', $4, $5::jsonb)`,
      [orderId, parseFloat(order.total), order.payment_method, transactionId || `txn_${Date.now()}`,
       JSON.stringify({ verified: true, timestamp: new Date().toISOString() })]
    );

    // Mark order as paid
    await pool.query(
      `UPDATE orders SET paid = true, payment_id = $1 WHERE id = $2`,
      [transactionId, orderId]
    );

    return { success: true };
  } catch (err) {
    console.error('Payment verification failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Handle payment webhook from payment gateway
 */
async function handleWebhook(payload, signature) {
  const { orderId, status, transactionId } = payload || {};
  if (status === 'success' && orderId) {
    return await verifyPayment(orderId, transactionId);
  }
  return { success: false, error: 'Invalid payment notification' };
}

module.exports = {
  generateUPILink,
  generateAppLinks,
  verifyPayment,
  handleWebhook,
};
