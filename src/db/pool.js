/**
 * Database Pool — NEVER hardcode credentials
 */
const { Pool } = require('pg');

if (!process.env.DB_PASSWORD && !process.env.DATABASE_URL) {
  console.error('FATAL: DB_PASSWORD or DATABASE_URL must be set in .env');
  process.exit(1);
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      }
    : {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'thaliplan',
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT || '5432'),
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

module.exports = { pool };