/**
 * Thali Plan — Database Schema Setup (Production Ready)
 * Run: node src/db/setup.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./pool');

async function setupDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Kitchens table (enhanced)
    await client.query(`
      CREATE TABLE IF NOT EXISTS kitchens (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE,
        password VARCHAR(200),
        phone VARCHAR(15),
        type VARCHAR(20) NOT NULL CHECK (type IN ('veg', 'nonveg')),
        active BOOLEAN DEFAULT false,
        rating_text VARCHAR(100) DEFAULT 'New partner',
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        address TEXT,
        opening_time TIME DEFAULT '07:00',
        closing_time TIME DEFAULT '22:00',
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Menu items table (enhanced)
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id SERIAL PRIMARY KEY,
        kitchen_id VARCHAR(50) REFERENCES kitchens(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        description TEXT,
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
        category VARCHAR(50) DEFAULT 'Other',
        allergens TEXT[] DEFAULT '{}',
        season INTEGER[] DEFAULT NULL,
        prep_extra_min INTEGER DEFAULT 0,
        tier VARCHAR(20) DEFAULT 'basic' CHECK (tier IN ('basic', 'premium')),
        active BOOLEAN DEFAULT true,
        photo_url TEXT,
        available_from TIME DEFAULT '07:00',
        available_to TIME DEFAULT '22:00',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Customers table (enhanced) — must exist before `orders`, which references it
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE,
        mobile VARCHAR(15) UNIQUE NOT NULL,
        password VARCHAR(200),
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
        loyalty_points INTEGER DEFAULT 0,
        referral_code VARCHAR(20),
        referred_by VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Orders table
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(100) PRIMARY KEY,
        customer_name VARCHAR(200) NOT NULL,
        customer_email VARCHAR(200),
        customer_mobile VARCHAR(15),
        customer_id INTEGER REFERENCES customers(id),
        kitchen_id VARCHAR(50) REFERENCES kitchens(id),
        items_by_meal JSONB NOT NULL DEFAULT '{}',
        total NUMERIC(10,2) NOT NULL,
        payment_method VARCHAR(20) DEFAULT 'cod' CHECK (payment_method IN ('upi', 'cod', 'phonepe')),
        paid BOOLEAN DEFAULT false,
        payment_id VARCHAR(200),
        status VARCHAR(30) DEFAULT 'placed' CHECK (status IN ('placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
        placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        preparing_at TIMESTAMP,
        out_for_delivery_at TIMESTAMP,
        delivered_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        delivery_lat DOUBLE PRECISION,
        delivery_lng DOUBLE PRECISION,
        delivery_eta TIMESTAMP,
        delivery_address TEXT,
        notes TEXT,
        calendar_event_id VARCHAR(500)
      );
    `);

    // 5. Order status timeline
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_timeline (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        note TEXT
      );
    `);

    // 6. Payment transactions log
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        method VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
        transaction_id VARCHAR(200),
        gateway_response JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 7. Kitchen schedule / blocked slots
    await client.query(`
      CREATE TABLE IF NOT EXISTS kitchen_schedule (
        id SERIAL PRIMARY KEY,
        kitchen_id VARCHAR(50) REFERENCES kitchens(id) ON DELETE CASCADE,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        meal_slot VARCHAR(20) NOT NULL,
        blocked_from TIMESTAMP NOT NULL,
        blocked_until TIMESTAMP NOT NULL,
        event_id VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. Subscriptions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id VARCHAR(100) PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(200) NOT NULL,
        customer_email VARCHAR(200),
        customer_mobile VARCHAR(15),
        kitchen_id VARCHAR(50) REFERENCES kitchens(id),
        meals TEXT[] DEFAULT '{}',
        days TEXT[] DEFAULT '{}',
        tier VARCHAR(20) DEFAULT 'basic',
        weekly_price NUMERIC(10,2) DEFAULT 0,
        start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 9. Subscription auto-orders log
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_orders (
        id SERIAL PRIMARY KEY,
        subscription_id VARCHAR(100) REFERENCES subscriptions(id) ON DELETE CASCADE,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        scheduled_date DATE NOT NULL,
        meal VARCHAR(20),
        generated BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 10. Item reviews table
    await client.query(`
      CREATE TABLE IF NOT EXISTS item_reviews (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(200),
        item_name VARCHAR(200) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        photo_url TEXT,
        kitchen_id VARCHAR(50) REFERENCES kitchens(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 11. Coupons table
    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
        discount_value NUMERIC(10,2) NOT NULL,
        min_order NUMERIC(10,2) DEFAULT 0,
        max_discount NUMERIC(10,2),
        usage_limit INTEGER DEFAULT 100,
        used_count INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 12. Loyalty points log
    await client.query(`
      CREATE TABLE IF NOT EXISTS loyalty_log (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        points INTEGER NOT NULL,
        reason VARCHAR(200),
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 13. Delivery tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_tracking (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        status VARCHAR(50),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 14. Delivery partners (for GPS tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_partners (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        phone VARCHAR(15) UNIQUE NOT NULL,
        password VARCHAR(200) NOT NULL,
        vehicle_type VARCHAR(50) DEFAULT 'bike',
        vehicle_number VARCHAR(50),
        current_lat DOUBLE PRECISION,
        current_lng DOUBLE PRECISION,
        status VARCHAR(30) DEFAULT 'available' CHECK (status IN ('available', 'busy', 'offline')),
        is_active BOOLEAN DEFAULT true,
        earnings NUMERIC(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 15. Delivery assignments (linking partners to orders)
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_assignments (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
        partner_id INTEGER REFERENCES delivery_partners(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        picked_up_at TIMESTAMP,
        delivered_at TIMESTAMP,
        status VARCHAR(30) DEFAULT 'assigned' CHECK (status IN ('assigned', 'picked_up', 'delivered'))
      );
    `);

    // ─── Migrations for columns added after initial release ───
    // Safe to re-run: ADD COLUMN IF NOT EXISTS is a no-op if already present.
    // These also matter for anyone whose `kitchens`/`orders`/etc. tables were
    // created by an older version of this project — CREATE TABLE IF NOT EXISTS
    // above is a no-op for a table that already exists, so a database created
    // before a column was added would otherwise be stuck without it.
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS email VARCHAR(200) UNIQUE;`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS password VARCHAR(200);`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS phone VARCHAR(15);`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS rating_text VARCHAR(100) DEFAULT 'New partner';`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS address TEXT;`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS opening_time TIME DEFAULT '07:00';`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS closing_time TIME DEFAULT '22:00';`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
    await client.query(`ALTER TABLE kitchens ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_eta TIMESTAMP;`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Other';`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allergens TEXT[] DEFAULT '{}';`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS available_from TIME DEFAULT '07:00';`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS available_to TIME DEFAULT '22:00';`);
    await client.query(`ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Allow email-only signup: mobile is no longer mandatory, as long as
    // at least one of mobile/email is present (enforced by the CHECK below).
    await client.query(`ALTER TABLE customers ALTER COLUMN mobile DROP NOT NULL;`);
    const constraintCheck = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'customers_mobile_or_email_chk'`
    );
    if (constraintCheck.rows.length === 0) {
      await client.query(`ALTER TABLE customers ADD CONSTRAINT customers_mobile_or_email_chk CHECK (mobile IS NOT NULL OR email IS NOT NULL);`);
    }

    // Seed default kitchen
    await client.query(`
      INSERT INTO kitchens (id, name, type, active, rating_text, lat, lng, email)
      VALUES ('home-kitchen', 'Home Kitchen (near your hostel)', 'veg', true, 'New partner', 12.9716, 77.5946, 'kitchen@thaliplan.com')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Seed default admin coupon
    await client.query(`
      INSERT INTO coupons (code, description, discount_type, discount_value, min_order, max_discount, usage_limit)
      VALUES ('WELCOME50', 'Welcome! Get ₹50 off your first order', 'fixed', 50, 200, 50, 1000)
      ON CONFLICT (code) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✓ Database setup complete — all tables created');
    console.log('✓ Default kitchen seeded: home-kitchen');
    console.log('✓ Default coupon seeded: WELCOME50');
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