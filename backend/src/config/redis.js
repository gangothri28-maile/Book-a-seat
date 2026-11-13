const Redis = require('ioredis');
const env = require('./env');

class InMemoryRedis {
  constructor() {
    this.store = new Map();
    this.ttls = new Map();
    this.lists = new Map();
    this.sortedSets = new Map();
    this.isFallback = true;
    console.log('[Redis] Initialized Embedded High-Performance In-Memory Redis Coordinator');
  }

  _checkExpiry(key) {
    if (this.ttls.has(key)) {
      const expiresAt = this.ttls.get(key);
      if (Date.now() > expiresAt) {
        this.store.delete(key);
        this.ttls.delete(key);
        this.lists.delete(key);
        this.sortedSets.delete(key);
        return true;
      }
    }
    return false;
  }

  async get(key) {
    if (this._checkExpiry(key)) return null;
    return this.store.get(key) || null;
  }

  async set(key, value, ...args) {
    let ex = null;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX' && args[i + 1]) {
        ex = parseInt(args[i + 1], 10);
        i++;
      } else if (arg === 'NX') {
        nx = true;
      }
    }

    this._checkExpiry(key);

    if (nx && this.store.has(key)) {
      return null; // Atomic NX failure: key already exists!
    }

    this.store.set(key, String(value));
    if (ex) {
      this.ttls.set(key, Date.now() + ex * 1000);
    } else {
      this.ttls.delete(key);
    }
    return 'OK';
  }

  async del(key) {
    this._checkExpiry(key);
    const existed = this.store.delete(key) || this.lists.delete(key) || this.sortedSets.delete(key);
    this.ttls.delete(key);
    return existed ? 1 : 0;
  }

  async ttl(key) {
    if (this._checkExpiry(key)) return -2;
    if (!this.store.has(key) && !this.lists.has(key)) return -2;
    if (!this.ttls.has(key)) return -1;
    const remaining = Math.ceil((this.ttls.get(key) - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async keys(pattern) {
    const matched = [];
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    for (const key of [...this.store.keys(), ...this.lists.keys()]) {
      if (!this._checkExpiry(key) && regex.test(key)) {
        matched.push(key);
      }
    }
    return matched;
  }

  // FIFO Queue List Operations
  async rpush(key, ...values) {
    if (!this.lists.has(key)) this.lists.set(key, []);
    const list = this.lists.get(key);
    list.push(...values.map(String));
    return list.length;
  }

  async lpop(key) {
    if (!this.lists.has(key)) return null;
    const list = this.lists.get(key);
    if (list.length === 0) return null;
    return list.shift();
  }

  async llen(key) {
    if (!this.lists.has(key)) return 0;
    return this.lists.get(key).length;
  }

  async lrange(key, start, stop) {
    if (!this.lists.has(key)) return [];
    const list = this.lists.get(key);
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }

  async lrem(key, count, value) {
    if (!this.lists.has(key)) return 0;
    const list = this.lists.get(key);
    const initialLen = list.length;
    const target = String(value);
    const filtered = list.filter(item => item !== target);
    this.lists.set(key, filtered);
    return initialLen - filtered.length;
  }

  // Sorted Set Operations for Queue Rankings
  async zadd(key, score, member) {
    if (!this.sortedSets.has(key)) this.sortedSets.set(key, new Map());
    const zset = this.sortedSets.get(key);
    zset.set(String(member), Number(score));
    return 1;
  }

  async zrank(key, member) {
    if (!this.sortedSets.has(key)) return null;
    const zset = this.sortedSets.get(key);
    const sorted = [...zset.entries()].sort((a, b) => a[1] - b[1]);
    const index = sorted.findIndex(([m]) => m === String(member));
    return index >= 0 ? index : null;
  }

  async zrem(key, member) {
    if (!this.sortedSets.has(key)) return 0;
    return this.sortedSets.get(key).delete(String(member)) ? 1 : 0;
  }

  async zcard(key) {
    if (!this.sortedSets.has(key)) return 0;
    return this.sortedSets.get(key).size;
  }

  // Atomic Lua script emulator for multi-seat hold lock
  async eval(script, numkeys, ...args) {
    // If script is a multi-seat hold script
    if (script.includes('HOLD_SEATS')) {
      const keys = args.slice(0, numkeys);
      const [userId, ttl] = args.slice(numkeys);
      for (const k of keys) {
        if (this.store.has(k) && !this._checkExpiry(k)) {
          return 0; // At least one seat already held!
        }
      }
      for (const k of keys) {
        await this.set(k, userId, 'EX', ttl, 'NX');
      }
      return 1;
    }
    return 1;
  }

  async flushall() {
    this.store.clear();
    this.ttls.clear();
    this.lists.clear();
    this.sortedSets.clear();
    return 'OK';
  }
}

let redisClient;

try {
  const client = new Redis(env.REDIS_URL, {
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Do not hang or spam logs if Redis is offline
    lazyConnect: true
  });

  client.connect().then(() => {
    console.log('[Redis] Connected to live Redis instance at', env.REDIS_URL);
    redisClient = client;
  }).catch(() => {
    console.log('[Redis] Live Redis offline. Using embedded In-Memory Redis Coordinator.');
    redisClient = new InMemoryRedis();
  });

  client.on('error', () => {
    if (!redisClient || redisClient instanceof InMemoryRedis) return;
    console.log('[Redis] Redis connection error. Falling back to embedded In-Memory Redis.');
    redisClient = new InMemoryRedis();
  });

  // Default to InMemory until connection resolves
  redisClient = new InMemoryRedis();
} catch (e) {
  redisClient = new InMemoryRedis();
}

// Proxy wrapper so any call resolves to the active client
const redisProxy = new Proxy({}, {
  get(target, prop) {
    return (...args) => {
      const active = redisClient || new InMemoryRedis();
      if (typeof active[prop] === 'function') {
        return active[prop](...args);
      }
      return undefined;
    };
  }
});

module.exports = redisProxy;
