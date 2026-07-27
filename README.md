# 🍛 Thali Plan (Annapurna)

**AI-powered nutrition-based meal ordering platform.** Fresh, home-style thalis from local kitchens — breakfast, lunch and dinner, personalized to your health goals.

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

## Features

- 🛒 **Customer PWA** — browse kitchens, AI-personalized menus, cart with coupons, OTP login, live order tracking, dark mode, offline support
- 👨‍🍳 **Kitchen Dashboard** — self-service menu management with photo uploads, AI food image generation, real-time order board
- 🛡️ **Admin Dashboard** — kitchen approvals, analytics, coupons, delivery partner management
- ⚡ **Real-time** — WebSocket broadcasts with room-based channels for orders, status changes, payments, and GPS tracking
- 💳 **Payments** — Razorpay, PhonePe, Paytm, Stripe, UPI deep links, COD (with webhook signature verification)
- 🔔 **Notifications** — email (Nodemailer) + WhatsApp/SMS (Twilio) order updates
- 🏆 **Loyalty & Referrals** — earn points on every order, redeem for discounts, refer friends
- 🧬 **Nutrition Engine** — personalized menu scoring based on customer health profile
- 🚚 **Delivery Management** — partner registration, GPS tracking, OTP-verified delivery
- 📅 **Calendar** — Google Calendar prep-slot blocking per meal
- 🖼️ **Image Optimization** — automatic WebP conversion + thumbnails via Sharp

## Architecture

```
Browser (PWA)
   │  HTTPS / WSS
   ▼
Express 5 (server.js)
 ├─ /api/auth           OTP signup & login (JWT)
 ├─ /api/kitchens       kitchens & menus (multer photo uploads)
 ├─ /api/orders         order lifecycle + timeline
 ├─ /api/subscriptions  meal subscriptions
 ├─ /api/reviews        ratings & reviews
 ├─ /api/analytics      dashboards
 ├─ /api/payments       Unified payments (all gateways)
 ├─ /api/delivery       Partner management + GPS
 ├─ /api/loyalty        Points + redemption
 ├─ /api/referral       Referral system
 ├─ /ws                 WebSocket (room-based)
 └─ /api/health         Liveness + DB check
   │
   ▼
PostgreSQL 16
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (or Docker)

### Setup

```bash
git clone https://github.com/Varunds1965/Annapurna.git
cd Annapurna
npm ci
cp .env.example .env
# EDIT .env — set DB_PASSWORD, JWT_SECRET, ADMIN_PASSWORD at minimum
npm run validate-env    # Check your .env is correct
npm run setup-db        # Create schema
npm run seed            # Optional sample data
npm run dev             # http://localhost:3000
```

### Docker

```bash
cp .env.example .env    # Edit with your values
docker-compose up -d --build
```

### Tests

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
```

## Security

- JWT auth on all mutating endpoints
- Webhook signature verification (Stripe, Razorpay)
- Rate limiting on OTP + order creation
- Helmet CSP headers
- No hardcoded secrets (env validation on startup)
- Atomic operations for coupons/loyalty to prevent race conditions

## License

MIT — see [LICENSE](./LICENSE)