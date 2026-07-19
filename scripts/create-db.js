const { Client } = require('pg');

const c = new Client({
  user: 'postgres',
  password: 'Varun121@',
  host: 'localhost',
  database: 'postgres',
  port: 5432,
});

c.connect()
  .then(() => c.query('CREATE DATABASE thaliplan'))
  .then(() => console.log('✓ Database thaliplan created'))
  .catch(e => {
    if (e.code === '42P04') console.log('Database thaliplan already exists');
    else console.error('Error:', e.message);
  })
  .finally(() => c.end());
