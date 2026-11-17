import express from "express";
import { redisConnection } from "../lib/redis.js";
import { ticketQueue } from "../lib/bullQueue.js";
import { requireAuth, restrictTo } from "../middlewares/auth.js";
import { soldOutEvents } from "../lib/l1Cache.js";

const router = express.Router();

// Set PROFILE_STEPS=true in .env when measuring hop latencies; keep false during 10k k6 runs
const PROFILE_STEPS = process.env.PROFILE_STEPS === "true";

router.post("/", requireAuth, restrictTo("CUSTOMER"), async (req, res) => {
  const tStart = PROFILE_STEPS ? performance.now() : 0;

  try {
    const { eventId } = req.body;
    const parsedEvnId = Number(eventId);

    if (!parsedEvnId || isNaN(parsedEvnId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID format" });
    }

    // =========================================================================
    // TIER 1: L1 IN-PROCESS MEMORY GATE (Local RAM - Zero Network Calls)
    // =========================================================================
    if (soldOutEvents.has(parsedEvnId)) {
      if (PROFILE_STEPS) {
        console.log(`[L1 HIT] Total: ${(performance.now() - tStart).toFixed(3)}ms`);
      }
      return res.status(409).json({ success: false, status: "sold_out" });
    }

    const seatKey = `event:${parsedEvnId}:availSeats`;

    // =========================================================================
    // TIER 2: L2 REDIS ATOMIC RESERVATION (Executes via EVALSHA)
    // =========================================================================
    const tRedis = PROFILE_STEPS ? performance.now() : 0;
    const result = await redisConnection.reserveTicket(seatKey);
    const redisMs = PROFILE_STEPS ? (performance.now() - tRedis).toFixed(2) : 0;

    if (result === -2) {
      return res.status(500).json({
        success: false,
        message: "Event inventory not initialized in memory",
      });
    }

    // Latch Tier 1 L1 gate once Redis confirms 0 remaining seats
    if (result === 0) {
      soldOutEvents.add(parsedEvnId);
      if (PROFILE_STEPS) {
        console.log(
          `[L2 SOLD OUT -> L1 LATCHED] Redis: ${redisMs}ms | Total: ${(performance.now() - tStart).toFixed(2)}ms`
        );
      }
      return res.status(409).json({ success: false, status: "sold_out" });
    }

    // =========================================================================
    // TIER 3: BULLMQ ASYNCHRONOUS PERSISTENCE
    // =========================================================================
    const tQueue = PROFILE_STEPS ? performance.now() : 0;
    await ticketQueue.add("persist-ticket", {
      eventId: parsedEvnId,
      customerId: req.user.id,
      userEmail: req.user.email,
    });
    const queueMs = PROFILE_STEPS ? (performance.now() - tQueue).toFixed(2) : 0;

    if (PROFILE_STEPS) {
      console.log(
        `[BOOKING WIN] Redis: ${redisMs}ms | BullMQ: ${queueMs}ms | Total: ${(performance.now() - tStart).toFixed(2)}ms`
      );
    }

    return res.status(202).json({
      success: true,
      status: "queued",
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
