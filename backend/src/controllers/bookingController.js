const db = require('../config/db');

exports.getMyBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const bookingsRes = await db.query(
      'SELECT b.*, e.title as event_title, e.venue, e.event_date FROM bookings b LEFT JOIN events e ON b.event_id = e.id WHERE b.user_id = $1 ORDER BY b.created_at DESC',
      [userId]
    );

    const bookings = await Promise.all(
      bookingsRes.rows.map(async bk => {
        const seatsRes = await db.query(
          'SELECT bs.price_at_booking, s.id, s.seat_row, s.seat_number, s.category FROM booking_seats bs JOIN seats s ON bs.seat_id = s.id WHERE bs.booking_id = $1',
          [bk.id]
        );
        return {
          ...bk,
          seats: seatsRes.rows.map(s => ({
            id: s.id,
            label: `${s.seat_row}${s.seat_number}`,
            row: s.seat_row,
            number: s.seat_number,
            category: s.category,
            price: s.price_at_booking
          }))
        };
      })
    );

    return res.json({ success: true, bookings });
  } catch (err) {
    console.error('[Booking] GetMyBookings error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve bookings history.' });
  }
};

exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const bookingRes = await db.query(
      'SELECT b.*, e.title as event_title, e.venue, e.event_date FROM bookings b LEFT JOIN events e ON b.event_id = e.id WHERE b.id = $1',
      [id]
    );

    if (bookingRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found.' });
    }

    const booking = bookingRes.rows[0];

    // Only owner or admin can view
    if (booking.user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    const seatsRes = await db.query(
      'SELECT bs.price_at_booking, s.id, s.seat_row, s.seat_number, s.category FROM booking_seats bs JOIN seats s ON bs.seat_id = s.id WHERE bs.booking_id = $1',
      [booking.id]
    );

    booking.seats = seatsRes.rows.map(s => ({
      id: s.id,
      label: `${s.seat_row}${s.seat_number}`,
      row: s.seat_row,
      number: s.seat_number,
      category: s.category,
      price: s.price_at_booking
    }));

    return res.json({ success: true, booking });
  } catch (err) {
    console.error('[Booking] GetBookingById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve booking.' });
  }
};
