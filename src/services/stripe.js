/**
 * Stripe Payment Integration
 * Raw HTTPS calls to the Stripe REST API (no SDK dependency).
 */
const https = require('https');

async function refundStripePayment(paymentIntentId, amount = null) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { success: false, error: 'Stripe not configured' };

  // Stripe refund API expects form-urlencoded, not JSON
  const formParams = new URLSearchParams({ payment_intent: paymentIntentId });
  if (amount) formParams.append('amount', Math.round(amount * 100).toString());
  const postBody = formParams.toString();

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: '/v1/refunds',
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
          const refund = JSON.parse(body);
          if (res.statusCode === 200 && refund.id) {
            resolve({ success: true, refundId: refund.id, status: refund.status, amount: refund.amount / 100 });
          } else {
            resolve({ success: false, error: refund.error?.message || 'Stripe refund failed' });
          }
        } catch {
          resolve({ success: false, error: 'Invalid response from Stripe' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.write(postBody);
    req.end();
  });
}

module.exports = { refundStripePayment };
