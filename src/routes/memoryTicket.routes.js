import express from "express";
import { redisConnection } from "../lib/redis.js";
import { ticketQueue } from "../lib/bullQueue.js";
import { requireAuth, restrictTo } from "../middlewares/auth.js";
import { soldOutEvents } from "../lib/l1Cache.js";

const router = express.Router();

const LUA_RESERVE_TICKET = `
  local seatKey = KEYS[1]
  local val = redis.call('get', seatKey)

  if not val then
    return -2 -- Key not initialized
  end

  local seats = tonumber(val)
  if not seats then
    return -2 -- Value is not a valid number
  end

  if seats > 0 then
    local newSeats = math.floor(seats - 1)
    redis.call('set', seatKey, tostring(newSeats))
    return 1  -- Reserved successfully
  else
    return 0  -- Sold out
  end
`;

router.post("/", requireAuth, restrictTo("CUSTOMER"), async (req, res) => {
  try {
    const { eventId } = req.body;
    const parsedEvnId = Number(eventId);

    if (!parsedEvnId || isNaN(parsedEvnId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID format" });
    }

    // =========================================================================
    // TIER 1: L1 In-Process Memory Gate (0.01ms - Bypasses Network Entirely)
    // =========================================================================
    if (soldOutEvents.has(parsedEvnId)) {
      return res.status(409).json({ success: false, message: "Event is sold out" });
    }

    const seatKey = `event:${parsedEvnId}:availSeats`;

    // =========================================================================
    // TIER 2: L2 Atomic Redis Lua Reservation (Single-Threaded RAM)
    // =========================================================================
    const result = await redisConnection.eval(LUA_RESERVE_TICKET, 1, seatKey);

    if (result === -2) {
      return res.status(500).json({
        success: false,
        message: "Event inventory not initialized in memory",
      });
    }

    // When Redis reports sold out, close the Tier 1 gate for all subsequent requests
    if (result === 0) {
      soldOutEvents.add(parsedEvnId);
      return res.status(409).json({ success: false, message: "Event is sold out" });
    }

    // =========================================================================
    // TIER 3: Asynchronous BullMQ Queue Persistence
    // =========================================================================
    await ticketQueue.add("persist-ticket", {
      eventId: parsedEvnId,
      customerId: req.user.id,
      userEmail: req.user.email,
    });

    return res.status(202).json({
      success: true,
      message: "Ticket reserved successfully. Confirmation processing.",
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;