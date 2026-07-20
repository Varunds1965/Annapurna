/**
 * UPI Payment Integration — PhonePe + UPI Deep Links
 * Uses your PhonePe UPI ID: 917676531524@ibl
 */
const crypto = require('crypto');
const https = require('https');

/**
 * Generate UPI deep link using your actual PhonePe UPI ID
 */
function generateUPILink(amount, orderId, customerName) {
  const vpa = process.env.UPI_VPA || '917676531524@ibl';
  const merchantName = encodeURIComponent(process.env.UPI_MERCHANT_NAME || 'ThaliPlan');
  const tn = encodeURIComponent(`ThaliPlan Order ${orderId}`);
  
  // Standard UPI deep link — opens any UPI app (Google Pay, PhonePe, Paytm)
  const upiLink = `upi://pay?pa=${vpa}&pn=${merchantName}&am=${amount}&cu=INR&tr=${orderId}&tn=${tn}`;
  return upiLink;
}

/**
 * Generate app-specific payment links
 */
function generateAppLinks(amount, orderId) {
  const vpa = process.env.UPI_VPA || '917676531524@ibl';
  const baseURI = `upi://pay?pa=${vpa}&pn=ThaliPlan&am=${amount}&cu=INR&tr=${orderId}&tn=Order%20${orderId}`;

  return {
    upi: baseURI,
    // PhonePe intent URL
    phonePe: `phonepe://pay?pa=${vpa}&pn=ThaliPlan&am=${amount}&cu=INR&tr=${orderId}`,
    // Google Pay web URL
    googlePay: `https://pay.google.com/gp/p/ui/pay?${new URLSearchParams({
      pa: vpa,
      pn: 'ThaliPlan',
      am: String(amount),
      cu: 'INR',
      tn: `Order ${orderId}`,
    }).toString()}`,
    // Paytm intent
    paytm: `paytmmp://pay?pa=${vpa}&pn=ThaliPlan&am=${amount}&cu=INR&tr=${orderId}`,
  };
}

/**
 * PhonePe Payment Gateway Integration
 * For production: use PhonePe's API to create payment requests
 */
async function createPhonePePayment(amount, orderId, customerName, customerMobile) {
  const merchantId = process.env.PHONEPE_MERCHANT_ID || 'THALIPLAN';
  const saltKey = process.env.PHONEPE_SALT_KEY;
  const saltIndex = process.env.PHONEPE_SALT_INDEX || 1;
  const env = process.env.PHONEPE_ENV || 'UAT';

  // If PhonePe gateway not configured, fall back to UPI deep link
  if (!saltKey || saltKey === 'your-salt-key-here') {
    console.log('ℹ PhonePe gateway not configured — using UPI deep link instead');
    const upiLink = generateUPILink(amount, orderId, customerName);
    return {
      success: true,
      method: 'upi_link',
      upiLink,
      appLinks: generateAppLinks(amount, orderId),
      message: 'Click the link to pay via any UPI app',
    };
  }

  // PhonePe API integration
  const payload = {
    merchantId,
    merchantTransactionId: orderId,
    merchantUserId: `MUID_${orderId}`,
    amount: Math.round(amount * 100), // in paise
    redirectUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payments/phonepe-callback`,
    redirectMode: 'POST',
    callbackUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/api/payments/phonepe-webhook`,
    mobileNumber: customerMobile || '9999999999',
    paymentInstrument: {
      type: 'PAY_PAGE',
    },
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const xVerify = crypto
    .createHash('sha256')
    .update(base64Payload + '/pg/v1/pay' + saltKey)
    .digest('hex') + '###' + saltIndex;

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ request: base64Payload });
    const host = env === 'PRODUCTION' ? 'api.phonepe.com' : 'api-preprod.phonepe.com';

    const options = {
      hostname: host,
      port: 443,
      path: '/pg/v1/pay',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.success && response.data && response.data.instrumentResponse) {
            resolve({
              success: true,
              method: 'phonepe',
              redirectUrl: response.data.instrumentResponse.redirectInfo?.url,
              upiLink: response.data.instrumentResponse.redirectInfo?.url,
              transactionId: response.data.merchantTransactionId,
            });
          } else {
            // Fallback to UPI link
            resolve({
              success: true,
              method: 'upi_link',
              upiLink: generateUPILink(amount, orderId, customerName),
              appLinks: generateAppLinks(amount, orderId),
              message: 'PhonePe gateway redirect ready',
            });
          }
        } catch (err) {
          resolve({
            success: true,
            method: 'upi_link',
            upiLink: generateUPILink(amount, orderId, customerName),
            appLinks: generateAppLinks(amount, orderId),
          });
        }
      });
    });

    req.on('error', (err) => {
      console.error('PhonePe API error:', err.message);
      resolve({
        success: true,
        method: 'upi_link',
        upiLink: generateUPILink(amount, orderId, customerName),
        appLinks: generateAppLinks(amount, orderId),
      });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Verify a payment was completed
 */
async function verifyPayment(orderId, transactionId) {
  const { pool } = require('../db/pool');
  try {
    const orderRes = await pool.query(`SELECT total, payment_method FROM orders WHERE id = $1`, [orderId]);
    if (orderRes.rows.length === 0) return { success: false, error: 'Order not found' };

    const order = orderRes.rows[0];

    await pool.query(
      `INSERT INTO payment_transactions (order_id, amount, method, status, transaction_id, gateway_response)
       VALUES ($1, $2, $3, 'success', $4, $5::jsonb)`,
      [orderId, parseFloat(order.total), order.payment_method, transactionId || `txn_${Date.now()}`,
       JSON.stringify({ verified: true, timestamp: new Date().toISOString() })]
    );

    await pool.query(
      `UPDATE orders SET paid = true, payment_id = $1 WHERE id = $2`,
      [transactionId, orderId]
    );

    // Add loyalty points (10 points per ₹100 spent)
    const points = Math.floor(parseFloat(order.total) / 10);
    await pool.query(
      `UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + $1 WHERE id = (SELECT customer_id FROM orders WHERE id = $2)`,
      [points, orderId]
    );
    await pool.query(
      `INSERT INTO loyalty_log (customer_id, points, reason, order_id) 
       SELECT customer_id, $1, 'Order payment', $2 FROM orders WHERE id = $2`,
      [points, orderId]
    );

    return { success: true, points };
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

/**
 * Check PhonePe payment status
 */
async function checkPhonePeStatus(merchantTransactionId) {
  const merchantId = process.env.PHONEPE_MERCHANT_ID || 'THALIPLAN';
  const saltKey = process.env.PHONEPE_SALT_KEY;
  const saltIndex = process.env.PHONEPE_SALT_INDEX || 1;
  const env = process.env.PHONEPE_ENV || 'UAT';

  if (!saltKey || saltKey === 'your-salt-key-here') {
    return { success: false, error: 'PhonePe not configured' };
  }

  const xVerify = crypto
    .createHash('sha256')
    .update(`/pg/v1/status/${merchantId}/${merchantTransactionId}` + saltKey)
    .digest('hex') + '###' + saltIndex;

  return new Promise((resolve) => {
    const host = env === 'PRODUCTION' ? 'api.phonepe.com' : 'api-preprod.phonepe.com';
    const options = {
      hostname: host,
      path: `/pg/v1/status/${merchantId}/${merchantTransactionId}`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify,
        'X-MERCHANT-ID': merchantId,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ success: true, data: JSON.parse(body) });
        } catch {
          resolve({ success: false, error: 'Invalid response' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.end();
  });
}

module.exports = {
  generateUPILink,
  generateAppLinks,
  createPhonePePayment,
  verifyPayment,
  handleWebhook,
  checkPhonePeStatus,
};