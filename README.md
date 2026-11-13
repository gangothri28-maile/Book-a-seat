<<<<<<< HEAD
# SeatSurge – Flash-Sale Ticketing Platform
### Problem Statement PS07: High-Concurrency Flash-Sale Ticketing Architecture

[![Test Status](https://img.shields.io/badge/Tests-100%25%20Passing-brightgreen)](#automated-test-suite)
[![Architecture](https://img.shields.io/badge/Architecture-Dual--Engine%20ACID-gold)](#dual-engine-database--redis-architecture)
[![Frontend](https://img.shields.io/badge/Frontend-Single--File%20Vanilla%20JS-orange)](#frontend-specifications)
[![Throughput](https://img.shields.io/badge/Throughput-1835%20req%2Fsec-blue)](#load-test-benchmark)

SeatSurge is a full-stack, enterprise-grade flash-sale ticket booking platform built to handle thousands of concurrent users attempting to secure tickets for high-demand live events simultaneously without double bookings, unfair ticket allocation, or server degradation.

---

## 1. Key Architectural Features

1. **Zero Double-Booking Guarantee (Distributed Concurrency Control)**:
   - Combines atomic Redis distributed reservation locks (`SET seat:hold:<id> <userId> NX EX 300`) with database transaction isolation and unique constraints (`uq_booking_seat`).
   - If two or more users attempt to hold or purchase the exact same seat simultaneously, exactly one succeeds and all other requests are safely rejected with `HTTP 409 Conflict`.

2. **Fair Virtual Waiting Room (FIFO Admission Queue)**:
   - Server-side managed queue using Redis FIFO lists and Sorted Sets.
   - Dynamic real-time position updates, estimated wait time, and queue progress indicators streamed via Socket.IO.
   - Server-enforced admission control tokens (`adm_<token>`) prevent users from bypassing the queue via client-side manipulation.

3. **Temporary Seat Holds & Background Expiration**:
   - Holds seats for 5 minutes (300 seconds) during checkout.
   - Background expiration daemon sweeps active holds every 5 seconds, automatically releasing expired holds back to the arena and broadcasting real-time `seats:released` events via Socket.IO.

4. **AI-Based Behavioral Bot Detection Engine**:
   - Multi-signal telemetry collector measuring cursor tortuosity (linearity), velocity standard deviation, click interval cadence, form fill timing, and request frequencies.
   - Calculates an explainable behavioral risk score from 0 to 100 with granular signal attribution.
   - Dynamically triggers in-app human verification challenges for high-risk sessions and restricts critical threats.

5. **Payment Simulation & Idempotency**:
   - Idempotent payment processing using cryptographic `idempotency_key` verification.
   - Multi-scenario simulation: successful authorization, bank decline (402), and user cancellation (400).
   - Generates unique, verifiable cryptographic booking references and offline-rendered QR codes.

6. **Premium Polished Walnut Wood UI Theme**:
   - Single-file Vanilla HTML5/CSS3/JavaScript implementation (`frontend/index.html`).
   - Deep Walnut (`#3B1D0C`), Rich Brown (`#6B3410`), Warm Chestnut (`#8B4A1C`), Amber Orange (`#B8692A`), Honey Gold (`#D9954A`), and Cream (`#F6E7D3`).
   - HTML5 Canvas cursor sparkle particle system with smooth delayed glowing tracker.
   - Glassmorphic 3D hover-tilt cards, floating ambient light blobs, pill-shaped glowing buttons, and responsive layout.

---

## 2. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Pure HTML5, CSS3, Vanilla JavaScript (ES6+), HTML5 Canvas API, Fetch API, Socket.IO Client. **Strictly single-file: `frontend/index.html`** (Zero frameworks, zero external CSS/JS bundles). |
| **Backend** | Node.js (v18+), Express.js, Socket.IO (v4) |
| **Persistent Database** | PostgreSQL 16 (production) with dual-engine automatic fallback to embedded persistent ACID storage engine (`seatsurge_db.json`) for instant zero-dependency local runs |
| **Distributed Coordination** | Redis 7 (production) with dual-engine automatic fallback to embedded high-performance in-memory Redis Coordinator |
| **Security & Auth** | JSON Web Tokens (JWT), BCrypt password hashing, sliding-window rate limiting, idempotency checks |
| **Testing** | Node.js assert test suites for concurrency, queue fairness, bot telemetry, and load testing |

---

## 3. Folder Structure

```text
SeatSurge/
├── frontend/
│   └── index.html                # Single-file frontend (All HTML, CSS & Vanilla JS)
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── env.js            # Environment variable configuration
│   │   │   ├── db.js             # Dual-engine PostgreSQL / ACID storage adapter
│   │   │   └── redis.js          # Dual-engine Redis / In-Memory coordinator
│   │   ├── routes/
│   │   │   ├── auth.js           # Authentication endpoints (/api/auth)
│   │   │   ├── event.js          # Event catalog endpoints (/api/events)
│   │   │   ├── queue.js          # Waiting room endpoints (/api/queue)
│   │   │   ├── seats.js          # Seat map and hold endpoints (/api/seats)
│   │   │   ├── payment.js        # Checkout and payment endpoints (/api/payments)
│   │   │   ├── bookings.js       # Customer bookings history (/api/bookings)
│   │   │   ├── bot.js            # Behavioral telemetry & verification (/api/bot)
│   │   │   └── admin.js          # Admin monitoring & controls (/api/admin)
│   │   ├── controllers/          # Express route controllers
│   │   ├── services/
│   │   │   ├── seatHoldService.js# Concurrency hold & expiration worker
│   │   │   ├── queueService.js   # FIFO queue & admission scheduler
│   │   │   └── paymentService.js # Idempotent payment & booking engine
│   │   ├── bot-detection/
│   │   │   └── botDetectionEngine.js # Explainable behavioral scoring engine
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js # JWT auth & role guards
│   │   │   └── rateLimiter.js    # Rate limiting middleware
│   │   ├── sockets/
│   │   │   └── socketHandler.js  # Real-time WebSocket event broadcaster
│   │   └── server.js             # Express application & HTTP server
│   │
│   ├── migrations/
│   │   └── schema.sql            # PostgreSQL relational database DDL
│   ├── seeds/
│   │   └── seed.js               # Seed script for users, event & 60 seats
│   ├── tests/
│   │   ├── concurrency.test.js   # Simultaneous race condition test
│   │   ├── queue.test.js         # FIFO queue ordering & duplicate check
│   │   ├── bot.test.js           # Behavioral telemetry scoring test
│   │   ├── load-test.js          # Benchmark load testing script
│   │   └── run-all-tests.js      # Comprehensive master test runner
│   ├── package.json
│   └── .env
│
├── .env.example
├── docker-compose.yml            # PostgreSQL 16 & Redis 7 container definition
└── README.md
```

---

## 4. Prerequisites

- **Node.js**: Version 18.0.0 or higher (`node -v`)
- **npm**: Version 9.0.0 or higher (`npm -v`)
- *(Optional)* **Docker & Docker Compose**: If you wish to run dedicated PostgreSQL and Redis containers.

> **Zero-Dependency Quick Start**: If PostgreSQL and Redis are not installed or running locally, SeatSurge **automatically engages its embedded persistent ACID storage engine and embedded Redis coordinator**. It works 100% out of the box with zero external setup required!

---

## 5. Installation & Setup

### Step 1: Navigate to backend and install dependencies
```bash
cd backend
npm install
```

### Step 2: Seed the Database
Populates the admin account, demo customer accounts, seed event ("Neon Nocturne 2026"), and 60 arena seats:
```bash
npm run seed
```

### Step 3: (Optional) Run with Docker for PostgreSQL & Redis
```bash
docker-compose up -d
```

---

## 6. How to Run the Application

### Start the SeatSurge Server
```bash
npm start
```
The server will output:
```text
=======================================================
  🚀 SeatSurge Flash-Sale Ticketing Server Active!
  🌐 Frontend & API running at: http://localhost:4000
  🔒 Database Engine: embedded (or postgres)
  ⚡ Real-Time Engine: Socket.IO connected
=======================================================
```

Open your web browser and navigate to:
**`http://localhost:4000`**

---

## 7. Demo User Credentials

The seed script creates the following pre-configured demo accounts:

| Role | Name | Email | Password |
|---|---|---|---|
| **System Admin** | Alexander Vance | `admin@seatsurge.com` | `Admin@123456` |
| **Customer 1** | Alice Sterling | `alice@seatsurge.com` | `Password@123` |
| **Customer 2** | Bob Montgomery | `bob@seatsurge.com` | `Password@123` |
| **Customer 3** | Charlie Dupont | `charlie@seatsurge.com` | `Password@123` |

> In the Sign In modal, you can also click the quick **"Alice (Customer)"** or **"Admin (Vance)"** buttons to authenticate with a single click.

---

## 8. Automated Test Suite

SeatSurge includes comprehensive automated tests that verify concurrency safety, double-booking prevention, FIFO waiting room mechanics, and AI bot risk scoring.

### Run All Tests
```bash
npm run test:all
```

### Run Individual Test Suites
- **Race Condition & Concurrency Test**:
  ```bash
  npm run test:concurrency
  ```
  *Fires 2 simultaneous requests at the exact same millisecond for the identical seat (`seat_c_5`). Proves that exactly 1 user succeeds, the other receives `409 Conflict`, unauthorized payments are rejected with `403 Forbidden`, and duplicate payments are blocked by idempotency.*

- **Virtual Waiting Room & FIFO Test**:
  ```bash
  npm run test:queue
  ```
  *Verifies strict FIFO ordering, prevents duplicate queue entries for the same session, and verifies leaving the queue.*

- **Behavioral Bot Detection Test**:
  ```bash
  npm run test:bot
  ```
  *Tests natural human mouse movements and click cadences (scores <30 Low Risk) vs scripted high-speed bot injection (scores 100 Critical Risk with 7 explainable behavioral flags).*

---

## 9. Load Test Benchmark

Run the included high-concurrency load testing script against the live server:
```bash
node tests/load-test.js
```

### Measured Benchmark Results
```text
===============================================================
🚀 RUNNING SEATSURGE LOAD TEST: 200 requests, Concurrency: 25
===============================================================

📊 LOAD TEST RESULTS:
   - Total Requests Sent : 200
   - Successful Responses: 200 (100.0%)
   - Failed Responses    : 0
   - Total Elapsed Time  : 0.11s
   - Measured Throughput : 1,835 req/sec
   - Latency (Avg)       : 12.8 ms
   - Latency (p50)       : 9 ms
   - Latency (p95)       : 42 ms
   - Latency (p99)       : 43 ms
===============================================================
```

---

## 10. REST API Documentation

### Authentication
- `POST /api/auth/register` – Register customer account (`{ name, email, password }`)
- `POST /api/auth/login` – Authenticate user (`{ email, password }`)
- `GET /api/auth/me` – Current authenticated user profile
- `POST /api/auth/logout` – Clear session

### Events
- `GET /api/events` – List all active events with live seat availability counters
- `GET /api/events/:id` – Retrieve event details and seat category breakdown

### Virtual Waiting Room
- `POST /api/queue/join` – Join fair FIFO waiting room (`{ sessionId, eventId }`)
- `GET /api/queue/status` – Retrieve live queue position and estimated wait time
- `POST /api/queue/leave` – Voluntarily leave the waiting room

### Seats & Concurrency Holds
- `GET /api/seats?eventId=:id` – Interactive seat map with live status (`available`, `held`, `booked`)
- `POST /api/seats/hold` – Atomically hold selected seats for 5 minutes (`{ eventId, seatIds, sessionId }`)
- `POST /api/seats/release` – Release an active seat reservation

### Payments & Booking Confirmation
- `GET /api/payments/checkout/:holdId` – Retrieve hold order summary and remaining countdown
- `POST /api/payments/confirm` – Process payment simulation with idempotency (`{ holdId, paymentMethod, idempotencyKey, simulationOutcome }`)
- `GET /api/bookings` – Retrieve authenticated customer's confirmed booking history
- `GET /api/bookings/:id` – Retrieve booking receipt and verifiable QR code payload

### AI Behavioral Bot Detection
- `POST /api/bot/telemetry` – Ingest behavioral telemetry (`mouseMoves`, `clickIntervals`, `formFillDurationMs`)
- `POST /api/bot/verify-challenge` – Submit human verification math captcha response
- `GET /api/bot/status` – Inspect session risk score and restriction status

### Admin Center
- `GET /api/admin/dashboard` – Real-time metrics (users, queue, seats, revenue, suspicious sessions)
- `GET /api/admin/bot-activity` – Detailed behavioral sessions log with explainable signals
- `GET /api/admin/bookings` – Real-time booking transactions ledger
- `POST /api/admin/queue/admit-next` – Manually admit next batch of users from waiting room
- `POST /api/admin/sessions/block` – Restrict or unblock a suspicious session
- `POST /api/admin/seats/reset` – Reset arena seat map for live demo presentations

---

## 11. Dual-Engine Database & Redis Architecture

SeatSurge features an innovative dual-engine architecture designed for hackathon evaluators:
1. **Production Mode**: When PostgreSQL (`DATABASE_URL`) and Redis (`REDIS_URL`) are reachable, SeatSurge utilizes `pg.Pool` connection pooling with row-level locks and `ioredis` for distributed state.
2. **Embedded Standalone Mode**: If PostgreSQL or Redis are not detected locally, SeatSurge seamlessly engages its file-backed, ACID-compliant storage engine (`seatsurge_db.json`) and high-performance in-memory Redis coordinator without crashing. Every API, concurrency test, and real-time WebSocket works identically in both modes.

---

## 12. Known Limitations & Production Enhancements

1. **Payment Simulation**: For the hackathon demonstration, a simulated payment gateway is implemented with real-time success/failure/cancellation branches and idempotency locks. In production, this can be linked to Stripe or Razorpay webhooks.
2. **Single Event Scope**: The seed data initializes one featured flash-sale event with 60 seats (VIP, Premium, Standard). The database schema and controllers are architected to support multi-event and multi-venue scaling.
3. **SMS/Email Notifications**: Booking confirmations are currently presented directly in the UI with printable/downloadable QR passes and stored in user history. Integration with SendGrid/Twilio would be the next step for transactional notifications.
=======
# Book-a-seat
>>>>>>> b5436bee8130bb6a195d5986f790c41d67d60265
