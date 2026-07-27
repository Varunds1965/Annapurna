const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const BASE = process.env.TEST_URL || 'http://localhost:3000';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Orders API', () => {
  it('POST /api/orders requires authentication', async () => {
    const res = await request('POST', '/api/orders', {
      kitchenId: 'home-kitchen',
      itemsByMeal: { Lunch: [{ name: 'Dal', price: 50, qty: 1 }] },
      total: 50,
    });
    assert.strictEqual(res.status, 401);
  });

  it('PATCH /api/orders/:id/status requires auth', async () => {
    const res = await request('PATCH', '/api/orders/fake-order/status', { status: 'confirmed' });
    assert.strictEqual(res.status, 401);
  });

  it('DELETE /api/orders/:id requires admin auth', async () => {
    const res = await request('DELETE', '/api/orders/fake-order');
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/orders/my-orders requires customer auth', async () => {
    const res = await request('GET', '/api/orders/my-orders');
    assert.strictEqual(res.status, 401);
  });
});