// 4. Orders table — FIXED payment_method CHECK to include all gateways
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
    payment_method VARCHAR(20) DEFAULT 'cod' CHECK (payment_method IN ('upi', 'cod', 'phonepe', 'razorpay', 'stripe', 'paytm')),
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

// 15. Delivery OTPs — FIXED: added UNIQUE constraint on order_id
await client.query(`
  CREATE TABLE IF NOT EXISTS delivery_otps (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE UNIQUE,
    customer_mobile VARCHAR(15),
    customer_email VARCHAR(200),
    customer_name VARCHAR(200),
    otp VARCHAR(6) NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration to fix existing databases:
await client.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check`);
await client.query(`ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('upi', 'cod', 'phonepe', 'razorpay', 'stripe', 'paytm'))`);

// Add unique constraint on delivery_otps if table already exists
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_otps_order_id_key') THEN
      ALTER TABLE delivery_otps ADD CONSTRAINT delivery_otps_order_id_key UNIQUE (order_id);
    END IF;
  END $$;
`);