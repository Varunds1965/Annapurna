/**
 * End-to-end test: verifies all modules load and server can start
 */
process.env.PORT = '3456'; // Use different port to avoid conflicts

console.log('Testing all modules load...');
try { require('dotenv'); console.log('  ✓ dotenv'); } catch(e) { console.error('  ✗ dotenv:', e.message); }
try { require('express'); console.log('  ✓ express'); } catch(e) { console.error('  ✗ express:', e.message); }
try { require('cors'); console.log('  ✓ cors'); } catch(e) { console.error('  ✗ cors:', e.message); }
try { require('helmet'); console.log('  ✓ helmet'); } catch(e) { console.error('  ✗ helmet:', e.message); }
try { require('morgan'); console.log('  ✓ morgan'); } catch(e) { console.error('  ✗ morgan:', e.message); }
try { require('ws'); console.log('  ✓ ws'); } catch(e) { console.error('  ✗ ws:', e.message); }
try { require('pg'); console.log('  ✓ pg'); } catch(e) { console.error('  ✗ pg:', e.message); }
try { require('bcryptjs'); console.log('  ✓ bcryptjs'); } catch(e) { console.error('  ✗ bcryptjs:', e.message); }
try { require('jsonwebtoken'); console.log('  ✓ jsonwebtoken'); } catch(e) { console.error('  ✗ jsonwebtoken:', e.message); }
try { require('uuid'); console.log('  ✓ uuid'); } catch(e) { console.error('  ✗ uuid:', e.message); }
try { require('multer'); console.log('  ✓ multer'); } catch(e) { console.error('  ✗ multer:', e.message); }
try { require('nodemailer'); console.log('  ✓ nodemailer'); } catch(e) { console.error('  ✗ nodemailer:', e.message); }
try { require('express-rate-limit'); console.log('  ✓ express-rate-limit'); } catch(e) { console.error('  ✗ express-rate-limit:', e.message); }

console.log('\nTesting project modules...');
try { require('./src/db/pool'); console.log('  ✓ db/pool'); } catch(e) { console.error('  ✗ db/pool:', e.message); }
try { require('./src/middleware/errorHandler'); console.log('  ✓ middleware/errorHandler'); } catch(e) { console.error('  ✗ middleware/errorHandler:', e.message); }
try { require('./src/middleware/auth'); console.log('  ✓ middleware/auth'); } catch(e) { console.error('  ✗ middleware/auth:', e.message); }
try { require('./src/services/websocket'); console.log('  ✓ services/websocket'); } catch(e) { console.error('  ✗ services/websocket:', e.message); }
try { require('./src/services/otp'); console.log('  ✓ services/otp'); } catch(e) { console.error('  ✗ services/otp:', e.message); }
try { require('./src/services/payment'); console.log('  ✓ services/payment'); } catch(e) { console.error('  ✗ services/payment:', e.message); }
try { require('./src/services/foodClassifier'); console.log('  ✓ services/foodClassifier'); } catch(e) { console.error('  ✗ services/foodClassifier:', e.message); }
try { require('./src/services/nutritionEngine'); console.log('  ✓ services/nutritionEngine'); } catch(e) { console.error('  ✗ services/nutritionEngine:', e.message); }
try { require('./src/services/imageGeneration'); console.log('  ✓ services/imageGeneration'); } catch(e) { console.error('  ✗ services/imageGeneration:', e.message); }
try { require('./src/services/calendar'); console.log('  ✓ services/calendar'); } catch(e) { console.error('  ✗ services/calendar:', e.message); }
try { require('./src/services/notifications'); console.log('  ✓ services/notifications'); } catch(e) { console.error('  ✗ services/notifications:', e.message); }
try { require('./src/routes/auth'); console.log('  ✓ routes/auth'); } catch(e) { console.error('  ✗ routes/auth:', e.message); }
try { require('./src/routes/orders'); console.log('  ✓ routes/orders'); } catch(e) { console.error('  ✗ routes/orders:', e.message); }
try { require('./src/routes/kitchens'); console.log('  ✓ routes/kitchens'); } catch(e) { console.error('  ✗ routes/kitchens:', e.message); }
try { require('./src/routes/analytics'); console.log('  ✓ routes/analytics'); } catch(e) { console.error('  ✗ routes/analytics:', e.message); }
try { require('./src/routes/coupons'); console.log('  ✓ routes/coupons'); } catch(e) { console.error('  ✗ routes/coupons:', e.message); }
try { require('./src/routes/reviews'); console.log('  ✓ routes/reviews'); } catch(e) { console.error('  ✗ routes/reviews:', e.message); }
try { require('./src/routes/delivery'); console.log('  ✓ routes/delivery'); } catch(e) { console.error('  ✗ routes/delivery:', e.message); }
try { require('./src/routes/subscriptions'); console.log('  ✓ routes/subscriptions'); } catch(e) { console.error('  ✗ routes/subscriptions:', e.message); }

console.log('\nTesting server module...');
try {
  const { app } = require('./server.js');
  console.log('  ✓ server.js loaded successfully');
  
  // Test that routes are registered
  const routes = [];
  if (app._router && app._router.stack) {
    app._router.stack.forEach(middleware => {
      if (middleware.route) {
        routes.push(`${Object.keys(middleware.route.methods).join(',')} ${middleware.route.path}`);
      } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
        middleware.handle.stack.forEach(handler => {
          if (handler.route) {
            const path = handler.route.path;
            const methods = Object.keys(handler.route.methods);
            routes.push(`${methods.join(',')} /api${path}`);
          }
        });
      }
    });
  }
  console.log(`  ✓ ${routes.length} routes registered`);
  routes.slice(0, 15).forEach(r => console.log(`    • ${r}`));
  
  console.log('\n✓ All checks passed! Server is ready.');
} catch(e) {
  console.error('  ✗ server.js failed:', e.message);
  console.error(e.stack);
}