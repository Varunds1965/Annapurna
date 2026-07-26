# 🍛 Thali Plan

**Smart meal planning & kitchen management platform.** Fresh, home-style thalis from local kitchens — breakfast, lunch and dinner, delivered.

[![pipeline](https://gitlab.com/mycompany-group6424529/thali/badges/main/pipeline.svg)](https://gitlab.com/mycompany-group6424529/thali/-/pipelines)

## Features

- 🛍️ **Customer app (PWA)** — browse kitchens, meal-slot menus (breakfast / lunch / dinner), cart with coupons, OTP login, live order tracking, dark mode
- 👨‍🍳 **Kitchen dashboard** — self-service menu management with photo uploads, real-time order board
- 🛡️ **Admin dashboard** — kitchen approvals, analytics, coupons
- ⚡ **Real-time** — WebSocket broadcasts for new orders, status changes and payments
- 💳 **Payments** — Multiple gateways: Razorpay, PhonePe, Paytm, Stripe (international), UPI deep links, and Cash on Delivery (COD)
- 🔔 **Notifications** — email (Nodemailer) and WhatsApp/SMS (Twilio) order updates
- 📅 **Calendar** — Google Calendar prep-slot blocking per meal

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
 ├─ /api/payments       Unified payments (Razorpay, PhonePe, Paytm, Stripe, UPI, COD)
 ├─ /ws                 WebSocket (live orders)
 └─ /api/health         liveness + DB check
   │
   ▼
PostgreSQL (pg pool)
```

```
src/
├─ db/           pool, schema setup, seed
├─ middleware/   JWT auth, error handler
├─ routes/       auth, kitchens, orders, subscriptions, reviews, analytics
└─ services/     websocket, payment, notifications, otp, calendar
public/           customer.html · kitchen.html · admin.html · kitchen-register.html (PWA)
```

## Getting started

### Prerequisites

- Node.js 20+, PostgreSQL 14+ (or Docker)

### Local development

```bash
git clone https://gitlab.com/mycompany-group6424529/thali.git
cd thali
npm ci
cp .env.example .env      # fill in your values
npm run setup-db          # create schema
npm run seed              # optional sample data
npm run dev               # http://localhost:3000
```

| URL | App |
|---|---|
| `/` | Customer app |
| `/kitchen.html` | Kitchen dashboard |
| `/admin.html` | Admin dashboard |
| `/kitchen-register.html` | Kitchen onboarding |

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT`, `HOST` | Server bind (default `3000`, `0.0.0.0`) |
| `DB_*` / `DATABASE_URL` | PostgreSQL connection |
| `JWT_SECRET` | Token signing secret |
| `CORS_ORIGIN` | Allowed origin |
| `UPI_VPA`, `UPI_MERCHANT_NAME` | UPI payment details |
| `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX` | PhonePe integration |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay integration |
| `PAYTM_MERCHANT_ID`, `PAYTM_MERCHANT_KEY`, `PAYTM_WEBSITE` | Paytm integration |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Stripe (international customers) |
| SMTP / Twilio creds | Notifications & OTP |
| `google-credentials.json` | Calendar integration |

> ⚠️ Never commit `.env` or `google-credentials.json` — both are git-ignored.

## Deployment

```bash
docker-compose up -d --build
```

The image runs as the unprivileged `node` user and exposes a `/api/health` healthcheck used by Docker and orchestrators.

## CI/CD

Every push to `main` runs: **test** → **SAST + secret detection** → **Docker build & push** to the GitLab Container Registry (`:latest` + commit SHA tags) → deploy instructions.

## License

ISC
