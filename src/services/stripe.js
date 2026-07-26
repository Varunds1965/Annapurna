/**
 * Stripe Payment Integration
 * For international customers - cards, Apple Pay, Google Pay
 */
const https = require('https');
const crypto = require('crypto');

async function createStripePaymentIntent(amount, orderId, customerName, customerEmail, customerMobile) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  // If Stripe not configured, return null
  if (!secretKey || secretKey === 'your-stripe-secret-key') {
    return { success: false, error: 'Stripe not configured' };
  }

  const amountInPaisa = Math.round(amount * 100); // Stripe uses smallest currency unit

  return new Promise((resolve) => {
    const formData = new URLSearchParams({
      amount: amountInPaisa.toString(),
      currency: 'inr',
      receipt: orderId,
      'metadata[thali_order_id]': orderId,
      'metadata[customer_name]': customerName || 'Customer',
      'metadata[customer_email]': customerEmail || '',
      'metadata[customer_mobile]': customerMobile || '',
    });

    const postBody = formData.toString();
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: '/v1/payment_intents',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const paymentIntent = JSON.parse(body);
          if (res.statusCode === 200 && paymentIntent.id) {
            resolve({
              success: true,
              method: 'stripe',
              clientSecret: paymentIntent.client_secret,
              paymentIntentId: paymentIntent.id,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              status: paymentIntent.status,
              publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
            });
          } else {
            resolve({
              success: false,
              error: paymentIntent.error?.message || 'Stripe payment intent creation failed',
            });
          }
        } catch (err) {
          resolve({ success: false, error: 'Invalid response from Stripe' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(postBody);
    req.end();
  });
}

async function verifyStripePayment(paymentIntentId) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return { success: false, error: 'Stripe not configured' };
  }

  return new Promise((resolve) => {
    https.get(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
      headers: {
        'Authorization': `Bearer ${secretKey}`,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const paymentIntent = JSON.parse(body);
          if (paymentIntent.status === 'succeeded') {
            resolve({
              success: true,
              amount: paymentIntent.amount / 100,
              currency: paymentIntent.currency,
              status: paymentIntent.status,
              paymentMethod: paymentIntent.payment_method_types?.[0],
            });
          } else {
            resolve({
              success: false,
              error: `Payment status: ${paymentIntent.status}`,
              status: paymentIntent.status,
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

async function refundStripePayment(paymentIntentId, amount = null) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return { success: false, error: 'Stripe not configured' };
  }

  const postData = amount
    ? JSON.stringify({ amount: Math.round(amount * 100) })
    : JSON.stringify({});

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: `/v1/refunds`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const refund = JSON.parse(body);
          if (res.statusCode === 200 && refund.id) {
            resolve({
              success: true,
              refundId: refund.id,
              status: refund.status,
              amount: refund.amount / 100,
            });
          } else {
            resolve({
              success: false,
              error: refund.error?.message || 'Stripe refund failed',
            });
          }
        } catch {
          resolve({ success: false, error: 'Invalid response from Stripe' });
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

async function createStripeRefund(paymentIntentId, amount = null) {
  // Refund a specific payment intent
  return await refundStripePayment(paymentIntentId, amount);
}

module.exports = {
  createStripePaymentIntent,
  verifyStripePayment,
  refundStripePayment,
  createStripeRefund,
};