const fs = require('fs');
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    results.push(`✗ ${name}: ${e.message}`);
  }
}

// Test core dependencies
test('dotenv', () => require('dotenv'));
test('express', () => require('express'));
test('cors', () => require('cors'));
test('helmet', () => require('helmet'));
test('morgan', () => require('morgan'));
test('ws', () => require('ws'));
test('pg', () => require('pg'));
test('bcryptjs', () => require('bcryptjs'));
test('jsonwebtoken', () => require('jsonwebtoken'));
test('uuid', () => require('uuid'));
test('multer', () => require('multer'));
test('nodemailer', () => require('nodemailer'));
test('express-rate-limit', () => require('express-rate-limit'));

// Test project modules
test('db/pool', () => require('./src/db/pool'));
test('middleware/errorHandler', () => require('./src/middleware/errorHandler'));
test('middleware/auth', () => require('./src/middleware/auth'));
test('services/websocket', () => { const m = require('./src/services/websocket'); if (typeof m.initWebSocket !== 'function') throw new Error('initWebSocket not a function'); });
test('services/otp', () => { const m = require('./src/services/otp'); if (typeof m.sendOTP !== 'function') throw new Error('sendOTP not a function'); });
test('services/payment', () => { const m = require('./src/services/payment'); if (typeof m.createPhonePePayment !== 'function') throw new Error('createPhonePePayment not a function'); });
test('services/foodClassifier', () => { const m = require('./src/services/foodClassifier'); if (typeof m.classifyFood !== 'function') throw new Error('classifyFood not a function'); });
test('services/nutritionEngine', () => { const m = require('./src/services/nutritionEngine'); if (typeof m.computeTargets !== 'function') throw new Error('computeTargets not a function'); });
test('services/imageGeneration', () => { const m = require('./src/services/imageGeneration'); if (typeof m.generateFoodImage !== 'function') throw new Error('generateFoodImage not a function'); });
test('services/calendar', () => { const m = require('./src/services/calendar'); if (typeof m.blockMealPrepSlot !== 'function') throw new Error('blockMealPrepSlot not a function'); });
test('services/notifications', () => { const m = require('./src/services/notifications'); if (typeof m.sendOrderConfirmationEmail !== 'function') throw new Error('sendOrderConfirmationEmail not a function'); });

// Test routes
test('routes/auth', () => require('./src/routes/auth'));
test('routes/orders', () => require('./src/routes/orders'));
test('routes/kitchens', () => require('./src/routes/kitchens'));
test('routes/analytics', () => require('./src/routes/analytics'));
test('routes/coupons', () => require('./src/routes/coupons'));
test('routes/reviews', () => require('./src/routes/reviews'));
test('routes/delivery', () => require('./src/routes/delivery'));
test('routes/subscriptions', () => require('./src/routes/subscriptions'));

// Test server module
test('server.js', () => require('./server.js'));

fs.writeFileSync('test_results.txt', results.join('\n'), 'utf8');
console.log(results.join('\n'));
console.log(`\n${results.filter(r => r.startsWith('✓')).length}/${results.length} passed`);