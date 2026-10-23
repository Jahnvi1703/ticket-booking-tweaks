import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import prisma from "./prisma.js";
import redis from "./redis.js"; // Reuse primary non-blocking client for queue producer
import { emailQueue } from "./emailQueue.js";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 4,
  connectTimeout: 20000,
};

// Dedicated blocking socket strictly for the background worker
const workerRedis = new Redis(redisUrl, redisOptions);
workerRedis.on("error", (err) => console.error("[BULLMQ WORKER REDIS ERROR]", err.message));

// Producer Queue shares the non-blocking connection from redis.js
export const ticketQueue = new Queue("ticket-persistence", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

export const ticketWorker = new Worker(
  "ticket-persistence",
  async (job) => {
    const { eventId, customerId, userEmail } = job.data;

    // 1. Transactionally update seats and create the ticket record with 20s timeout
    const savedEvent = await prisma.$transaction(
      async (tx) => {
        const updatedEvent = await tx.event.update({
          where: { id: eventId },
          data: { availSeats: { decrement: 1 } },
          select: { name: true, price: true },
        });

        await tx.ticket.create({
          data: {
            name: updatedEvent.name,
            price: updatedEvent.price,
            customerId: customerId,
            eventId: eventId,
          },
        });

        return updatedEvent;
      },
      {
        maxWait: 10000,
        timeout: 20000, 
      }
    );

    console.log(`[WORKER] Successfully persisted ticket for ${userEmail} (Event: ${eventId})`);

    // 2. Dispatch asynchronous confirmation email without blocking
    try {
      await emailQueue.add("booking-confirmation", {
        email: userEmail,
        eventName: savedEvent.name,
      });
    } catch (emailErr) {
      console.error(`[EMAIL QUEUE ERROR] Could not dispatch email for ${userEmail}:`, emailErr.message);
    }
  },
  {
    connection: workerRedis,
    concurrency: 1,        // Sequential writes eliminate MySQL row-lock deadlocks
    lockDuration: 60000,   // Prevents lock expiry over remote network latency
    stalledInterval: 60000,
  }
);

ticketWorker.on("failed", (job, err) => {
  console.error(`[WORKER ERROR] Job ${job?.id} failed:`, err.message);
});