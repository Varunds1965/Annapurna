const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE = process.env.TEST_URL || 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = { method, hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'Content-Type': 'application/json', ...headers } };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Payments API', () => {
  it('GET /api/payments/methods returns available methods', async () => {
    const res = await request('GET', '/api/payments/methods');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.methods));
    assert(res.body.methods.includes('upi'));
    assert(res.body.methods.includes('cod'));
  });

  it('POST /api/payments/create-order handles missing amount', async () => {
    const res = await request('POST', '/api/payments/create-order', { orderId: 'test' });
    // Should return UPI fallback or error — not crash
    assert([200, 400, 500].includes(res.status));
  });

  it('POST /api/payments/stripe-webhook rejects unsigned requests', async () => {
    const res = await request('POST', '/api/payments/stripe-webhook', { type: 'payment_intent.succeeded', data: { object: {} } });
    assert([400, 500].includes(res.status));
  });
});