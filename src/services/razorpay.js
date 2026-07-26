/**
 * Razorpay Payment Integration
 * Supports UPI, cards, wallets, netbanking
 */
const crypto = require('crypto');
const https = require('https');

async function createRazorpayOrder(amount, orderId, customerName, customerEmail, customerMobile) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  // If Razorpay not configured, return null to fallback to other methods
  if (!keyId || !keySecret || keyId === 'your-razorpay-key-id') {
    return { success: false, error: 'Razorpay not configured' };
  }

  const amountInPaise = Math.round(amount * 100);

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  const postData = JSON.stringify({
    amount: amountInPaise,
    currency: 'INR',
    receipt: orderId,
    payment_capture: 1,
    notes: {
      customer_name: customerName || 'Customer',
      customer_email: customerEmail || '',
      customer_mobile: customerMobile || '',
      thali_order_id: orderId,
    },
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: '/v1/orders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (res.statusCode === 200 && response.id) {
            resolve({
              success: true,
              method: 'razorpay',
              orderId: response.id,
              amount: response.amount,
              currency: response.currency,
              status: response.status,
              keyId: keyId,
              // Frontend can use Razorpay Checkout with these details
            });
          } else {
            resolve({
              success: false,
              error: response.error?.description || 'Razorpay order creation failed',
            });
          }
        } catch (err) {
          resolve({ success: false, error: 'Invalid response from Razorpay' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

async function verifyRazorpayPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret) {
    return { success: false, error: 'Razorpay not configured' };
  }

  // Verify signature
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    return { success: false, error: 'Invalid payment signature' };
  }

  // Signature valid - fetch payment details
  const keyId = process.env.RAZORPAY_KEY_ID;
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

  return new Promise((resolve) => {
    https.get(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const payment = JSON.parse(body);
          if (payment.status === 'captured') {
            resolve({
              success: true,
              amount: payment.amount / 100,
              method: payment.method,
              status: payment.status,
            });
          } else {
            resolve({
              success: false,
              error: `Payment status: ${payment.status}`,
            });
          }
        } catch {
          resolve({ success: false, error: 'Failed to fetch payment details' });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

async function refundRazorpayPayment(razorpayPaymentId, amount = null) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return { success: false, error: 'Razorpay not configured' };
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const postData = amount ? JSON.stringify({ amount: Math.round(amount * 100) }) : '{}';

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.razorpay.com',
      port: 443,
      path: `/v1/payments/${razorpayPaymentId}/refund`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (res.statusCode === 200) {
            resolve({ success: true, refundId: response.id, status: response.status });
          } else {
            resolve({ success: false, error: response.error?.description || 'Refund failed' });
          }
        } catch {
          resolve({ success: false, error: 'Invalid response from Razorpay' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  refundRazorpayPayment,
};