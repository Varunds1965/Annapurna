const { Client } = require('pg');

// Remember to replace 'your_actual_password' with your PostgreSQL password
const dbClient = new Client({
  user: 'postgres',
  password: 'Varun121@',
  host: 'localhost',
  port: 5432,
  database: 'postgres' 
});

dbClient.connect()
  .then(() => console.log('Connected to PostgreSQL successfully!'))
  .catch(err => console.error('Database connection error:', err.stack));

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection (Replace with your PostgreSQL credentials)
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'thaliplan',
    password: 'Varun121@',
    port: 5432,
});

// 1. Send OTP API
app.post('/api/send-otp', (req, res) => {
    // In a live app, call Twilio/MSG91 here
    res.json({ success: true, message: 'OTP Sent via API' });
});

// 2. Place Order API
app.post('/api/orders', async (req, res) => {
    const { id, customerName, kitchenId, itemsByMeal, total, paymentMethod, paid, status, placedAt } = req.body;
    try {
        await pool.query(
            `INSERT INTO orders (id, customer_name, kitchen_id, items_by_meal, total, payment_method, paid, status, placed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, customerName, kitchenId, itemsByMeal, total, paymentMethod, paid, status, placedAt]
        );
        // Here you would trigger Google Calendar API to block prep time
        res.json({ success: true, message: 'Order created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 3. Get Orders for Kitchen API
app.get('/api/orders/:kitchenId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM orders WHERE kitchen_id = $1 ORDER BY placed_at DESC`,
            [req.params.kitchenId]
        );
        // Format DB columns to match frontend JSON expectations
        const formattedOrders = result.rows.map(row => ({
            id: row.id,
            customerName: row.customer_name,
            kitchenId: row.kitchen_id,
            itemsByMeal: row.items_by_meal,
            total: parseFloat(row.total),
            paymentMethod: row.payment_method,
            paid: row.paid,
            status: row.status,
            placedAt: row.placed_at,
            deliveredAt: row.delivered_at
        }));
        res.json(formattedOrders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 4. Mark Order Delivered API
app.post('/api/orders/:orderId/deliver', async (req, res) => {
    try {
        await pool.query(
            `UPDATE orders SET status = 'delivered', delivered_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [req.params.orderId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 5. Mark Order Paid API
app.post('/api/orders/:orderId/pay', async (req, res) => {
    try {
        await pool.query(`UPDATE orders SET paid = true WHERE id = $1`, [req.params.orderId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));