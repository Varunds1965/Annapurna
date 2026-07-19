/**
 * Thali Plan — Database Schema Setup
 * Run: node src/db/setup.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./pool');

async function setupDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Kitchens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS kitchens (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('veg', 'nonveg')),
        active BOOLEAN DEFAULT false,
        rating_text VARCHAR(100) DEFAULT 'New partner',
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Menu items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        kitchen_id VARCHAR(50) REFERENCES kitchens(id),
        name VARCHAR(200) NOT NULL,
        ingredients TEXT[] DEFAULT '{}',
        slots VARCHAR(20)[] DEFAULT '{}',
        price NUMERIC(10,2) NOT NULL,
        cal NUMERIC(10,2) DEFAULT 0,
        protein NUMERIC(10,2) DEFAULT 0,
        fat NUMERIC(10,2) DEFAULT 0,
        calcium NUMERIC(10,2) DEFAULT 0,
        vd NUMERIC(10,2) DEFAULT 0,
        b12 NUMERIC(10,2) DEFAULT 0,
        iron NUMERIC(10,2) DEFAULT 0,
        tags TEXT[] DEFAULT '{}',
        season INTEGER[] DEFAULT NULL,
        prep_extra_min INTEGER DEFAULT 0,
        tier VARCHAR(20) DEFAULT 'basic' CHECK (tier IN ('basic', 'premium')),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Orders table — expanded schema matching API
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY,
        customer_name VARCHAR(200) NOT NULL,
        customer_email VARCHAR(200),
        customer_mobile VARCHAR(15),
        kitchen_id VARCHAR(50) REFERENCES kitchens(id),
        items_by_meal JSONB NOT NULL DEFAULT '{}',
        total NUMERIC(10,2) NOT NULL,
        payment_method VARCHAR(20) DEFAULT 'cod' CHECK (payment_method IN ('upi', 'cod')),
        paid BOOLEAN DEFAULT false,
        payment_id VARCHAR(200),
        status VARCHAR(30) DEFAULT 'placed' CHECK (status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
        placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        preparing_at TIMESTAMP,
        out_for_delivery_at TIMESTAMP,
        delivered_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        notes TEXT,
        calendar_event_id VARCHAR(500)
      );
    `);

    // 4. Order status timeline
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_timeline (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id),
        status VARCHAR(30) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        note TEXT
      );
    `);

    // 5. Customers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE,
        mobile VARCHAR(15) UNIQUE NOT NULL,
        avatar TEXT,
        age INTEGER,
        weight NUMERIC(10,2),
        height NUMERIC(10,2),
        gender VARCHAR(10),
        goal VARCHAR(30),
        disliked_foods TEXT,
        deficiencies TEXT[] DEFAULT '{}',
        tier VARCHAR(20) DEFAULT 'basic',
        diet_pref VARCHAR(20) DEFAULT 'veg',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Payment transactions log
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id),
        amount NUMERIC(10,2) NOT NULL,
        method VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
        transaction_id VARCHAR(200),
        gateway_response JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Kitchen schedule / blocked slots (for calendar)
    await client.query(`
      CREATE TABLE IF NOT EXISTS kitchen_schedule (
        id SERIAL PRIMARY KEY,
        kitchen_id VARCHAR(50) REFERENCES kitchens(id),
        order_id VARCHAR(100) REFERENCES orders(id),
        meal_slot VARCHAR(20) NOT NULL,
        blocked_from TIMESTAMP NOT NULL,
        blocked_until TIMESTAMP NOT NULL,
        event_id VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default kitchen
    await client.query(`
      INSERT INTO kitchens (id, name, type, active, rating_text, lat, lng)
      VALUES ('home-kitchen', 'Home Kitchen (near your hostel)', 'veg', true, 'New partner', 12.9716, 77.5946)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✓ Database setup complete — all tables created');
    console.log('✓ Default kitchen seeded: home-kitchen');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database setup failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase().catch((err) => {
  console.error(err);
  process.exit(1);
});
