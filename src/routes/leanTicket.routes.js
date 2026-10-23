import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, restrictTo } from "../middlewares/auth.js";
import redis from "../lib/redis.js";
import { sendBookingEmail } from "../lib/email.js"; // Direct email call (No BullMQ)

const router = express.Router();

router.post("/", requireAuth, restrictTo("CUSTOMER"), async (req, res) => {
  try {
    const { eventId } = req.body;
    const evnId = Number(eventId);

    if (isNaN(evnId)) {
      return res.status(400).json({ success: false, message: "Invalid event ID" });
    }

    // 1. Direct relational database transaction
    const ticket = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.event.updateMany({
        where: { id: evnId, availSeats: { gt: 0 } },
        data: { availSeats: { decrement: 1 } },
      });

      if (updateResult.count === 0) {
        throw new Error("SOLD_OUT");
      }

      const event = await tx.event.findUnique({
        where: { id: evnId },
        select: { name: true, price: true },
      });

      return await tx.ticket.create({
        data: {
          name: event.name,
          price: event.price,
          customerId: req.user.id,
          eventId: evnId,
        },
      });
    });

    // Invalidate event cache
    await redis.del("all_events");

    // 2. The Naive Flaw: Synchronous third-party email API call in the hot path
    // Under load, this blocks the HTTP response, exhausts connection pools, and trips Resend 429 limits
    await sendBookingEmail(req.user.email, ticket.name);

    return res.status(201).json({
      success: true,
      message: "Ticket booked successfully (lean direct)",
      data: ticket,
    });
  } catch (err) {
    if (err.message === "SOLD_OUT") {
      return res.status(409).json({ success: false, message: "Event tickets are sold out!" });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;