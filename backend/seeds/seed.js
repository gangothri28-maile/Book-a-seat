const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/config/db');

async function seed() {
  console.log('[Seed] Seeding SeatSurge database with initial records...');

  // 1. Seed Users
  const passwordAdminHash = await bcrypt.hash('Admin@123456', 10);
  const passwordCustomerHash = await bcrypt.hash('Password@123', 10);

  const users = [
    {
      id: 'usr_admin_001',
      name: 'Alexander Vance (System Admin)',
      email: 'admin@seatsurge.com',
      password_hash: passwordAdminHash,
      role: 'admin'
    },
    {
      id: 'usr_cust_001',
      name: 'Alice Sterling',
      email: 'alice@seatsurge.com',
      password_hash: passwordCustomerHash,
      role: 'customer'
    },
    {
      id: 'usr_cust_002',
      name: 'Bob Montgomery',
      email: 'bob@seatsurge.com',
      password_hash: passwordCustomerHash,
      role: 'customer'
    },
    {
      id: 'usr_cust_003',
      name: 'Charlie Dupont',
      email: 'charlie@seatsurge.com',
      password_hash: passwordCustomerHash,
      role: 'customer'
    }
  ];

  for (const user of users) {
    const existing = await db.query('SELECT * FROM users WHERE email = $1', [user.email]);
    if (existing.rows.length === 0) {
      await db.query(
        'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
        [user.id, user.name, user.email, user.password_hash, user.role]
      );
      console.log(`[Seed] Created user: ${user.email} (${user.role})`);
    }
  }

  // 2. Seed Event
  const eventId = 'evt_symphony_2026';
  const existingEvent = await db.query('SELECT * FROM events WHERE id = $1', [eventId]);
  if (existingEvent.rows.length === 0) {
    await db.query(
      `INSERT INTO events (id, title, description, venue, event_date, sale_start_time, total_seats, banner_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        eventId,
        'Neon Nocturne – The Global EDM & Symphony Experience 2026',
        'A breathtaking live auditory voyage fusing orchestral strings, modular analog synthesizers, and immersive holographic acoustics. Experience the most anticipated flash-sale live performance of the year.',
        'Royal Walnut Grand Amphitheatre, San Francisco, CA',
        '2026-12-15T20:00:00.000Z',
        new Date().toISOString(),
        60,
        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80'
      ]
    );
    console.log(`[Seed] Created event: ${eventId}`);
  }

  // 3. Seed 60 Seats (Rows A through F, 10 seats each)
  const rows = [
    { row: 'A', category: 'VIP', price: 250.00 },
    { row: 'B', category: 'VIP', price: 250.00 },
    { row: 'C', category: 'Premium', price: 150.00 },
    { row: 'D', category: 'Premium', price: 150.00 },
    { row: 'E', category: 'Standard', price: 80.00 },
    { row: 'F', category: 'Standard', price: 80.00 }
  ];

  const existingSeats = await db.query('SELECT * FROM seats WHERE event_id = $1', [eventId]);
  if (existingSeats.rows.length === 0) {
    for (const r of rows) {
      for (let num = 1; num <= 10; num++) {
        const seatId = `seat_${r.row.toLowerCase()}_${num}`;
        let status = 'available';

        // Pre-book seats A1 and A2 for seed demonstration
        if (r.row === 'A' && (num === 1 || num === 2)) {
          status = 'booked';
        }

        await db.query(
          `INSERT INTO seats (id, event_id, seat_row, seat_number, category, price, status, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [seatId, eventId, r.row, num, r.category, r.price, status, 0]
        );
      }
    }
    console.log(`[Seed] Created 60 seats for event ${eventId}`);

    // Create seed booking for pre-booked seats A1 & A2
    const seedBookingId = 'bk_seed_vip_001';
    await db.query(
      `INSERT INTO bookings (id, booking_reference, user_id, event_id, total_amount, status, qr_code_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        seedBookingId,
        'SURGE-VIP-88291',
        'usr_cust_001',
        eventId,
        500.00,
        'confirmed',
        'SEATSURGE:VERIFY:SURGE-VIP-88291:EVT-2026:A1-A2'
      ]
    );

    await db.query(
      `INSERT INTO booking_seats (id, booking_id, seat_id, price_at_booking)
       VALUES ($1, $2, $3, $4)`,
      ['bs_seed_001', seedBookingId, 'seat_a_1', 250.00]
    );

    await db.query(
      `INSERT INTO booking_seats (id, booking_id, seat_id, price_at_booking)
       VALUES ($1, $2, $3, $4)`,
      ['bs_seed_002', seedBookingId, 'seat_a_2', 250.00]
    );

    await db.query(
      `INSERT INTO payments (id, booking_id, user_id, amount, payment_method, idempotency_key, status, transaction_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'pay_seed_001',
        seedBookingId,
        'usr_cust_001',
        500.00,
        'Credit Card',
        'idemp_seed_vip_001',
        'successful',
        'TXN_SEAT_992147'
      ]
    );
    console.log('[Seed] Created initial verified booking for A1, A2');
  }

  console.log('[Seed] Seeding completed successfully!');
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Seed] Error during seeding:', err);
      process.exit(1);
    });
}

module.exports = seed;
