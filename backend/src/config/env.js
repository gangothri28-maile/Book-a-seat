const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/seatsurge',
  PGUSER: process.env.PGUSER || 'postgres',
  PGPASSWORD: process.env.PGPASSWORD || 'postgres',
  PGHOST: process.env.PGHOST || 'localhost',
  PGPORT: parseInt(process.env.PGPORT || '5432', 10),
  PGDATABASE: process.env.PGDATABASE || 'seatsurge',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'seatsurge_super_secret_jwt_key_walnut_wood_2026',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  SEAT_HOLD_DURATION_SECONDS: parseInt(process.env.SEAT_HOLD_DURATION_SECONDS || '300', 10),
  QUEUE_MAX_CONCURRENT_USERS: parseInt(process.env.QUEUE_MAX_CONCURRENT_USERS || '5', 10),
  QUEUE_ADMISSION_BATCH_SIZE: parseInt(process.env.QUEUE_ADMISSION_BATCH_SIZE || '2', 10),
  QUEUE_ADMISSION_INTERVAL_MS: parseInt(process.env.QUEUE_ADMISSION_INTERVAL_MS || '10000', 10),
  BOT_CHALLENGE_THRESHOLD: parseInt(process.env.BOT_CHALLENGE_THRESHOLD || '60', 10),
  BOT_BLOCK_THRESHOLD: parseInt(process.env.BOT_BLOCK_THRESHOLD || '80', 10)
};
