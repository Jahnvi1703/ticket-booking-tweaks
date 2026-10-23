import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 4,
  connectTimeout: 20000,
});

redisConnection.on("connect", () => {
  console.log("[REDIS] Connected successfully");
});

redisConnection.on("error", (err) => {
  console.error("[REDIS ERROR]", err.message);
});


export default redisConnection;