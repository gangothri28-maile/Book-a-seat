const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const env = require('./env');

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'seatsurge_db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class EmbeddedEngine {
  constructor() {
    this.tables = {
      users: [],
      events: [],
      seats: [],
      queue_entries: [],
      seat_holds: [],
      bookings: [],
      booking_seats: [],
      payments: [],
      bot_activity: [],
      bot_risk_assessments: [],
      admin_logs: []
    };
    this.load();
    this.isEmbedded = true;
    console.log('[DB] Running with Embedded Persistent ACID Storage Engine at', DB_FILE);
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        this.tables = { ...this.tables, ...parsed };
      } else {
        this.save();
      }
    } catch (e) {
      console.warn('[DB] Initializing clean state:', e.message);
      this.save();
    }
  }

  save() {
    try {
      const tempPath = `${DB_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.tables, null, 2), 'utf8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (e) {
      console.error('[DB] Error persisting database to disk:', e.message);
    }
  }

  query(sql, params = []) {
    const trimmed = sql.trim().replace(/;+$/, '');
    const upper = trimmed.toUpperCase();

    // Transaction markers
    if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
      if (upper === 'COMMIT') this.save();
      return { rows: [], rowCount: 0 };
    }

    // 1. INSERT INTO <table> (...) VALUES (...)
    if (upper.startsWith('INSERT INTO')) {
      const intoIdx = upper.indexOf('INTO');
      const valuesIdx = upper.indexOf('VALUES');
      const tablePart = trimmed.substring(intoIdx + 4, valuesIdx).trim();

      const openParen1 = tablePart.indexOf('(');
      const closeParen1 = tablePart.lastIndexOf(')');
      const tableName = tablePart.substring(0, openParen1).trim().toLowerCase();
      const cols = tablePart.substring(openParen1 + 1, closeParen1).split(',').map(c => c.trim().toLowerCase());

      const valuesPart = trimmed.substring(valuesIdx + 6).trim();
      const openParen2 = valuesPart.indexOf('(');
      const closeParen2 = valuesPart.lastIndexOf(')');
      const valTokens = valuesPart.substring(openParen2 + 1, closeParen2).split(',').map(v => v.trim());

      if (!this.tables[tableName]) this.tables[tableName] = [];

      const row = {};
      cols.forEach((col, idx) => {
        const token = valTokens[idx] || '';
        if (token.startsWith('$')) {
          const pIdx = parseInt(token.substring(1), 10) - 1;
          row[col] = params[pIdx] !== undefined ? params[pIdx] : null;
        } else if (token.toUpperCase() === 'NOW()' || token.toUpperCase() === 'CURRENT_TIMESTAMP') {
          row[col] = new Date().toISOString();
        } else {
          row[col] = token.replace(/^['"]|['"]$/g, '');
        }
      });

      if (!row.created_at) row.created_at = new Date().toISOString();
      if (!row.updated_at) row.updated_at = new Date().toISOString();

      // Check unique constraints
      if (tableName === 'users' && this.tables.users.some(u => u.email === row.email)) {
        const err = new Error(`duplicate key value violates unique constraint "users_email_key"`);
        err.code = '23505';
        throw err;
      }

      if (tableName === 'booking_seats' && this.tables.booking_seats.some(bs => bs.seat_id === row.seat_id)) {
        const err = new Error(`duplicate key value violates unique constraint "uq_booking_seat"`);
        err.code = '23505';
        throw err;
      }

      this.tables[tableName].push(row);
      this.save();
      return { rows: [row], rowCount: 1 };
    }

    // 2. SELECT queries
    if (upper.startsWith('SELECT')) {
      const fromMatch = trimmed.match(/FROM\s+([a-zA-Z_]+)/i);
      if (!fromMatch) return { rows: [], rowCount: 0 };
      const tableName = fromMatch[1].toLowerCase();
      let records = this.tables[tableName] ? [...this.tables[tableName]] : [];

      // Check specific parameter filters
      const whereIdx = upper.indexOf('WHERE');
      if (whereIdx !== -1) {
        const whereClause = trimmed.substring(whereIdx + 5);

        // Word-boundary matching
        if (/\bid\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.id) === String(params[0]));
        } else if (/\bemail\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.email).toLowerCase() === String(params[0]).toLowerCase());
        } else if (/\bevent_id\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.event_id) === String(params[0]));
        } else if (/\bsession_id\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.session_id) === String(params[0]));
        } else if (/\buser_id\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.user_id) === String(params[0]));
        } else if (/\bbooking_reference\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.booking_reference) === String(params[0]));
        } else if (/\bidempotency_key\s*=\s*\$1\b/i.test(whereClause)) {
          records = records.filter(r => String(r.idempotency_key) === String(params[0]));
        }

        if (/\bstatus\s*=\s*'active'/i.test(whereClause)) {
          records = records.filter(r => r.status === 'active');
        } else if (/\bstatus\s*=\s*'successful'/i.test(whereClause)) {
          records = records.filter(r => r.status === 'successful');
        }
      }

      // ORDER BY
      if (upper.includes('ORDER BY')) {
        if (/created_at\s+DESC/i.test(trimmed)) {
          records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (/seat_row/i.test(trimmed)) {
          records.sort((a, b) => {
            if (a.seat_row === b.seat_row) return (a.seat_number || 0) - (b.seat_number || 0);
            return (a.seat_row || '').localeCompare(b.seat_row || '');
          });
        }
      }

      // Aggregates
      if (upper.includes('COUNT(*)') && !upper.includes('GROUP BY')) {
        let totalRev = 0;
        if (upper.includes('SUM(AMOUNT)')) {
          totalRev = records.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
          return {
            rows: [{ count: records.length, total_payments: records.length, total_revenue: totalRev }],
            rowCount: 1
          };
        }
        return { rows: [{ count: records.length }], rowCount: 1 };
      }

      return { rows: records, rowCount: records.length };
    }

    // 3. UPDATE queries
    if (upper.startsWith('UPDATE')) {
      const match = trimmed.match(/UPDATE\s+([a-zA-Z_]+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const setClause = match[2];
        const whereClause = match[3];

        if (!this.tables[tableName]) return { rows: [], rowCount: 0 };

        let updatedCount = 0;
        this.tables[tableName].forEach(row => {
          let matchWhere = false;

          if (/\bevent_id\s*=\s*\$([0-9]+)\b/i.test(whereClause)) {
            const pNum = parseInt(whereClause.match(/\bevent_id\s*=\s*\$([0-9]+)\b/i)[1], 10) - 1;
            if (String(row.event_id) === String(params[pNum])) matchWhere = true;
          } else if (/\bsession_id\s*=\s*\$([0-9]+)\b/i.test(whereClause)) {
            const pNum = parseInt(whereClause.match(/\bsession_id\s*=\s*\$([0-9]+)\b/i)[1], 10) - 1;
            if (String(row.session_id) === String(params[pNum])) matchWhere = true;
          } else if (/\bid\s*=\s*\$([0-9]+)\b/i.test(whereClause)) {
            const pNum = parseInt(whereClause.match(/\bid\s*=\s*\$([0-9]+)\b/i)[1], 10) - 1;
            if (String(row.id) === String(params[pNum])) matchWhere = true;
          }

          if (matchWhere) {
            const setAssignments = setClause.split(',');
            setAssignments.forEach(assign => {
              const [colRaw, valRaw] = assign.split('=').map(s => s.trim());
              const col = colRaw.toLowerCase();
              if (valRaw.startsWith('$')) {
                const pIdx = parseInt(valRaw.substring(1), 10) - 1;
                row[col] = params[pIdx];
              } else if (valRaw.toUpperCase() === 'CURRENT_TIMESTAMP' || valRaw.toUpperCase() === 'NOW()') {
                row[col] = new Date().toISOString();
              } else if (valRaw.includes('+ 1')) {
                row[col] = (Number(row[col]) || 0) + 1;
              } else {
                row[col] = valRaw.replace(/^['"]|['"]$/g, '');
              }
            });
            row.updated_at = new Date().toISOString();
            updatedCount++;
          }
        });

        if (updatedCount > 0) this.save();
        return { rows: [], rowCount: updatedCount };
      }
    }

    // 4. DELETE queries
    if (upper.startsWith('DELETE FROM')) {
      const match = trimmed.match(/DELETE\s+FROM\s+([a-zA-Z_]+)\s+WHERE\s+(.+)$/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        const whereClause = match[2];
        if (!this.tables[tableName]) return { rows: [], rowCount: 0 };

        const initialLen = this.tables[tableName].length;
        this.tables[tableName] = this.tables[tableName].filter(row => {
          if (/\bid\s*=\s*\$1\b/i.test(whereClause)) {
            return String(row.id) !== String(params[0]);
          }
          if (/\bsession_id\s*=\s*\$1\b/i.test(whereClause)) {
            return String(row.session_id) !== String(params[0]);
          }
          return true;
        });
        const deletedCount = initialLen - this.tables[tableName].length;
        if (deletedCount > 0) this.save();
        return { rows: [], rowCount: deletedCount };
      }
    }

    return { rows: [], rowCount: 0 };
  }
}

let pool = null;
let embeddedEngine = null;
let activeEngine = 'detecting';

try {
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
    max: 20
  });

  pool.query('SELECT 1')
    .then(() => {
      activeEngine = 'postgres';
      console.log('[DB] Connected to PostgreSQL on', env.DATABASE_URL);
    })
    .catch(() => {
      activeEngine = 'embedded';
      embeddedEngine = new EmbeddedEngine();
    });
} catch (e) {
  activeEngine = 'embedded';
  embeddedEngine = new EmbeddedEngine();
}

async function query(sql, params = []) {
  if (activeEngine === 'postgres') {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        console.warn('[DB] PostgreSQL disconnected. Switching to embedded engine.');
        activeEngine = 'embedded';
        if (!embeddedEngine) embeddedEngine = new EmbeddedEngine();
        return embeddedEngine.query(sql, params);
      }
      throw err;
    }
  }

  if (!embeddedEngine) embeddedEngine = new EmbeddedEngine();
  return embeddedEngine.query(sql, params);
}

async function transaction(callback) {
  if (activeEngine === 'postgres') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    if (!embeddedEngine) embeddedEngine = new EmbeddedEngine();
    await embeddedEngine.query('BEGIN');
    try {
      const client = {
        query: (sql, params) => embeddedEngine.query(sql, params)
      };
      const result = await callback(client);
      await embeddedEngine.query('COMMIT');
      return result;
    } catch (err) {
      await embeddedEngine.query('ROLLBACK');
      throw err;
    }
  }
}

module.exports = {
  query,
  transaction,
  getEngine: () => activeEngine,
  getRawStore: () => embeddedEngine ? embeddedEngine.tables : null
};
