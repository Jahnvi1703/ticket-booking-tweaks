// src/lib/redis.js
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on("connect", () => {
  console.log("[REDIS] Connected successfully");
});

redisConnection.on("error", (err) => {
  console.error("[REDIS ERROR]", err.message);
});

// =============================================================================
// ATOMIC INVENTORY SCRIPT (EVALSHA Managed by ioredis)
// =============================================================================
const LUA_RESERVE_TICKET = `
  local seatKey = KEYS[1]
  local seats = tonumber(redis.call('get', seatKey) or '-1')

  if seats == -1 then
    return -2 -- Key not initialized
  elseif seats > 0 then
    redis.call('decr', seatKey)
    return 1  -- Reserved successfully
  else
    return 0  -- Sold out
  end
`;

// Registers custom method: redisConnection.reserveTicket(seatKey)
redisConnection.defineCommand("reserveTicket", {
  numberOfKeys: 1,
  lua: LUA_RESERVE_TICKET,
});

export default redisConnection;