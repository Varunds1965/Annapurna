const { Client } = require('pg');

const dbClient = new Client({
  user: 'postgres',
  password: 'Varun121@',
  host: 'localhost',
  port: 5432,
  database: 'postgres' 
});

async function createTable() {
  try {
    // 1. Connect to the database
    await dbClient.connect();
    console.log('Connected to database...');

    // 2. The SQL instruction to create the table
    const sqlCommand = `
      CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          customer_name VARCHAR(100),
          thali_type VARCHAR(50),
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. Send the instruction
    await dbClient.query(sqlCommand);
    console.log('Success! The "orders" table has been created.');

  } catch (err) {
    console.error('Error creating table:', err.stack);
  } finally {
    // 4. Close the connection when done
    await dbClient.end();
  }
}

createTable();