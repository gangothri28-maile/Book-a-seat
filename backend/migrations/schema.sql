-- SeatSurge PostgreSQL Relational Database Schema
-- Flash-Sale High Concurrency Ticketing Architecture

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    venue VARCHAR(200) NOT NULL,
    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
    sale_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    total_seats INT NOT NULL,
    banner_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seats (
    id VARCHAR(36) PRIMARY KEY,
    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    seat_row VARCHAR(5) NOT NULL,
    seat_number INT NOT NULL,
    category VARCHAR(20) NOT NULL CHECK (category IN ('VIP', 'Premium', 'Standard')),
    price DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'held', 'booked', 'unavailable')),
    version INT DEFAULT 0, -- Optimistic concurrency control counter
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_event_row_seat UNIQUE (event_id, seat_row, seat_number)
);

CREATE TABLE IF NOT EXISTS queue_entries (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sequence_number BIGINT NOT NULL,
    status VARCHAR(30) DEFAULT 'waiting' CHECK (status IN ('waiting', 'turn_approaching', 'access_granted', 'expired', 'removed', 'blocked')),
    admission_token VARCHAR(100),
    admitted_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_queue_session_event UNIQUE (session_id, event_id)
);

CREATE TABLE IF NOT EXISTS seat_holds (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    seat_ids TEXT NOT NULL, -- JSON-stringified array of seat IDs
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'converted', 'released')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
    id VARCHAR(36) PRIMARY KEY,
    booking_reference VARCHAR(50) UNIQUE NOT NULL,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_id VARCHAR(36) NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'refunded')),
    qr_code_ref VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_seats (
    id VARCHAR(36) PRIMARY KEY,
    booking_id VARCHAR(36) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    seat_id VARCHAR(36) NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
    price_at_booking DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_booking_seat UNIQUE (seat_id) -- Prevents any seat from ever appearing in two bookings
);

CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(36) PRIMARY KEY,
    booking_id VARCHAR(36) REFERENCES bookings(id) ON DELETE SET NULL,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    payment_method VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'successful', 'failed', 'cancelled')),
    transaction_ref VARCHAR(100) UNIQUE NOT NULL,
    provider_response JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_activity (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    ip_address VARCHAR(50),
    user_agent TEXT,
    event_type VARCHAR(50) NOT NULL,
    telemetry_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_risk_assessments (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    risk_score INT NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_category VARCHAR(20) NOT NULL CHECK (risk_category IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    explainable_signals JSONB NOT NULL,
    action_taken VARCHAR(30) NOT NULL CHECK (action_taken IN ('ALLOW', 'MONITOR', 'CHALLENGE_CAPTCHA', 'RESTRICT_BLOCKED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_logs (
    id VARCHAR(36) PRIMARY KEY,
    admin_id VARCHAR(36) REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    target_resource VARCHAR(100),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Essential Performance Indexes
CREATE INDEX IF NOT EXISTS idx_seats_event_status ON seats(event_id, status);
CREATE INDEX IF NOT EXISTS idx_seat_holds_expires ON seat_holds(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_queue_event_status ON queue_entries(event_id, status, sequence_number);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bot_assessments_session ON bot_risk_assessments(session_id, created_at DESC);
