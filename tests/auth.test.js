const { describe, it, before, after } = require('node:test');
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

describe('Auth API', () => {
  it('POST /api/auth/send-otp requires valid channel', async () => {
    const res = await request('POST', '/api/auth/send-otp', { mobile: '9876543210' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /channel/);
  });

  it('POST /api/auth/send-otp validates mobile format', async () => {
    const res = await request('POST', '/api/auth/send-otp', { mobile: '123', channel: 'mobile' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /10-digit/);
  });

  it('POST /api/auth/send-otp validates email format', async () => {
    const res = await request('POST', '/api/auth/send-otp', { email: 'bad', channel: 'email' });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /email/);
  });

  it('POST /api/auth/send-otp succeeds with valid email', async () => {
    const res = await request('POST', '/api/auth/send-otp', { email: 'test@example.com', name: 'Test User', channel: 'email' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  it('POST /api/auth/verify-otp rejects without OTP request', async () => {
    const res = await request('POST', '/api/auth/verify-otp', { email: 'nobody@example.com', channel: 'email', otp: '123456' });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/auth/kitchen/login rejects missing fields', async () => {
    const res = await request('POST', '/api/auth/kitchen/login', { email: 'x@y.com' });
    assert.strictEqual(res.status, 400);
  });

  it('POST /api/auth/kitchen/login rejects wrong password', async () => {
    const res = await request('POST', '/api/auth/kitchen/login', { email: 'kitchen@thaliplan.com', password: 'wrong' });
    assert.strictEqual(res.status, 401);
  });

  it('POST /api/auth/admin/login rejects invalid creds', async () => {
    const res = await request('POST', '/api/auth/admin/login', { email: 'fake@admin.com', password: 'wrong' });
    assert.strictEqual(res.status, 401);
  });

  it('GET /api/auth/me requires auth', async () => {
    const res = await request('GET', '/api/auth/me');
    assert.strictEqual(res.status, 401);
  });
});