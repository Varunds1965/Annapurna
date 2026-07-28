# 🍛 Annapurna

**AI-powered nutrition-based meal ordering platform.** Fresh, home-style meals from local kitchens, personalized to your health goals.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Features

- 🛒 **Customer PWA**: browse kitchens, AI-personalized menus, cart with coupons, OTP login, live order tracking, dark mode, offline support
- 👨‍🍳 **Kitchen Dashboard**: self-service menu management with photo uploads, AI food image generation, real-time order board
- 🛡️ **Admin Dashboard**: kitchen approvals, analytics, coupons, delivery partner management
- ⚡ **Real-time updates**: WebSocket broadcasts with room-based channels for orders, status changes, payments, and GPS tracking
- 💳 **Payments**: Razorpay, PhonePe, Paytm, Stripe, UPI deep links, COD, and webhook signature verification
- 🔔 **Notifications**: email via Nodemailer plus WhatsApp/SMS via Twilio
- 🏆 **Loyalty and referrals**: earn points on every order, redeem rewards, and refer friends
- 🧬 **Nutrition engine**: personalized menu scoring based on customer health profiles
- 🚚 **Delivery management**: partner registration, GPS tracking, and OTP-verified delivery
- 📅 **Calendar**: Google Calendar prep-slot blocking per meal
- 🖼️ **Image optimization**: automatic WebP conversion and thumbnails via Sharp

## Architecture

```
Browser (Annapurna PWA)
   │  HTTPS / WSS
   ▼
Express API
 ├─ /api/auth           OTP signup and login with JWT
 ├─ /api/kitchens       kitchens and menus
 ├─ /api/orders         order lifecycle and timeline
 ├─ /api/subscriptions  meal subscriptions
 ├─ /api/reviews        ratings and reviews
 ├─ /api/analytics      dashboards
 ├─ /api/payments       unified payment endpoints
 ├─ /api/delivery       delivery partners and GPS
 ├─ /api/loyalty        rewards and redemption
 ├─ /api/referral       referral system
 ├─ /ws                 room-based real-time updates
 └─ /api/health         liveness and database health
   │
   ▼
PostgreSQL
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ or Docker

### Setup

```bash
git clone https://github.com/Varunds1965/Annapurna.git
cd Annapurna
npm ci
cp .env.example .env
# Edit .env: set DB_PASSWORD, JWT_SECRET, and ADMIN_PASSWORD at minimum
npm run validate-env
npm run setup-db
npm run seed                 # Optional sample data
npm run dev                  # http://localhost:3000
```

### Docker

```bash
cp .env.example .env       # Edit with real local values
docker-compose up -d --build
```

### Tests

```bash
npm test
npm run test:watch
```

## Production checklist

- Use a managed PostgreSQL database and a real HTTPS domain.
- Set `CORS_ORIGIN` to the exact production origin, never `*`.
- Use unique production secrets and payment webhook signing secrets.
- Run the database setup or migrations before the first production boot.
- Configure payment webhooks against the deployed HTTPS URL and test retries, failures, and refunds.
- Deploy staging first, then promote the same tested commit to production.
- Keep secrets in the hosting provider's secret manager, never in Git.

## Security

- JWT authentication on mutating endpoints
- Webhook signature verification for supported payment providers
- Rate limiting on OTP and order creation
- Helmet security headers
- No hardcoded secrets
- Atomic operations for coupons and loyalty

## License

MIT: see [LICENSE](./LICENSE)
