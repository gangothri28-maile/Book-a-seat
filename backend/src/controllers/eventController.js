const db = require('../config/db');

exports.getEvents = async (req, res) => {
  try {
    const eventsRes = await db.query('SELECT * FROM events ORDER BY event_date ASC');
    const events = eventsRes.rows;

    // Attach real-time available seats count
    for (const evt of events) {
      const seatsRes = await db.query(
        'SELECT status, count(*) as count FROM seats WHERE event_id = $1 GROUP BY status',
        [evt.id]
      );
      const counts = { available: 0, held: 0, booked: 0 };
      seatsRes.rows.forEach(r => {
        counts[r.status] = parseInt(r.count, 10);
      });
      evt.seat_counts = counts;
      evt.available_seats = counts.available || 0;
    }

    return res.json({ success: true, events });
  } catch (err) {
    console.error('[Event] GetEvents error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load events.' });
  }
};

exports.getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const eventRes = await db.query('SELECT * FROM events WHERE id = $1', [id]);

    if (eventRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Event not found.' });
    }

    const event = eventRes.rows[0];

    const seatsRes = await db.query(
      'SELECT status, count(*) as count FROM seats WHERE event_id = $1 GROUP BY status',
      [event.id]
    );
    const counts = { available: 0, held: 0, booked: 0 };
    seatsRes.rows.forEach(r => {
      counts[r.status] = parseInt(r.count, 10);
    });
    event.seat_counts = counts;
    event.available_seats = counts.available || 0;

    return res.json({ success: true, event });
  } catch (err) {
    console.error('[Event] GetEventById error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve event.' });
  }
};
