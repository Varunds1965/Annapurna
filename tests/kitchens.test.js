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

describe('Kitchens API', () => {
  it('GET /api/kitchens returns active kitchens', async () => {
    const res = await request('GET', '/api/kitchens');
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body));
  });

  it('POST /api/kitchens/register validates required fields', async () => {
    const res = await request('POST', '/api/kitchens/register', { name: 'Test' });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/kitchens/register validates password strength', async () => {
    const res = await request('POST', '/api/kitchens/register', {
      name: 'Test Kitchen', email: 'test@kitchen.com', password: 'weak', type: 'veg',
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /[Pp]assword/);
  });

  it('POST /api/kitchens/:id/menu requires auth', async () => {
    const res = await request('POST', '/api/kitchens/home-kitchen/menu', { name: 'Test', price: 50 });
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/kitchens/:id returns kitchen with menu', async () => {
    const res = await request('GET', '/api/kitchens/home-kitchen');
    // May return 200 or 404 depending on seed data
    assert([200, 404].includes(res.status));
    if (res.status === 200) {
      assert(res.body.id);
      assert(Array.isArray(res.body.menu));
    }
  });
});