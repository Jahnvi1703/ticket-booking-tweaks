import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import prisma from "./prisma.js";
import redis from "./redis.js"; // Reuse main connection for producer
import { sendBookingEmail, sendEventUpdateEmail } from "./email.js";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  family: 4,             // Force IPv4
  connectTimeout: 20000, // 20s
};

// Only the worker needs a dedicated blocking connection
const emailWorkerRedis = new Redis(redisUrl, redisOptions);
emailWorkerRedis.on("error", (err) => console.error("[EMAIL WORKER REDIS ERROR]", err.message));

// Producer Queue shares the primary non-blocking client
export const emailQueue = new Queue("email-queue", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 50,
  },
});

export const emailWorker = new Worker(
  "email-queue",
  async (job) => {
    if (job.name === "booking-confirmation") {
      const { email, eventName } = job.data;
      await sendBookingEmail(email, eventName);
      console.log(`[EMAIL SENT] Booking confirmation to ${email}`);
    }

    if (job.name === "event-update") {
      const { eventId, eventName } = job.data;

      const tickets = await prisma.ticket.findMany({
        where: { eventId },
        include: { customer: { select: { email: true } } },
      });

      const uniqueEmails = [
        ...new Set(tickets.map((t) => t.customer?.email).filter(Boolean)),
      ];

      console.log(`[EMAIL BROADCAST] Dispatching updates for '${eventName}' to ${uniqueEmails.length} attendees.`);

      for (const email of uniqueEmails) {
        try {
          await sendEventUpdateEmail(email, eventName);
          console.log(`[EMAIL SENT] Event update to ${email}`);
        } catch (err) {
          console.error(`[EMAIL ERROR] Failed to send update to ${email}:`, err.message);
        }
      }
    }
  },
  {
    connection: emailWorkerRedis,
    concurrency: 1,
    lockDuration: 60000,
    limiter: {
      max: 2,
      duration: 1000,
    },
  }
);

emailWorker.on("failed", (job, err) => {
  console.error(`[EMAIL WORKER ERROR] Job ${job?.id} failed:`, err.message);
});