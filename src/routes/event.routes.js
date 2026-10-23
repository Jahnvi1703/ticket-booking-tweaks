import express from "express";
import prisma from "../lib/prisma.js";
import redis from "../lib/redis.js"
import { requireAuth, restrictTo } from "../middlewares/auth.js";
import { emailQueue } from "../lib/emailQueue.js";
import { soldOutEvents } from "../lib/l1Cache.js";

const router=express.Router();

// 1. Create Event (Organizer Only)
router.post("/", requireAuth, restrictTo("ORGANIZER") ,async(req, res)=>{
    try{
        const activeOrgId= req.user.id;
    const {name, price, description, totalSeats}= req.body;

    //check required fields allowing price to be 0 for free events
    if(!name || price ===undefined|| price===null || !description){
        return res.status(400).json({success:false, message:"Missing required fields!"})
    }

    const parsedPrice= Number(price);
   if(isNaN(parsedPrice) || parsedPrice<0){
    return res.status(400).json({success:false, message:"Price must be a valid non negative number"})
   }

    const parsedSeats = totalSeats ? Number(totalSeats) : 100;
    if (isNaN(parsedSeats) || parsedSeats <= 0) {
      return res.status(400).json({ success: false, message: "Total seats must be a positive number" });
    }

    // 1. Persist the event in MySQL
    const newEvent= await prisma.event.create({
        data:{
            name , price:parsedPrice , description, organizerId:activeOrgId, totalSeats: parsedSeats,
        availSeats: parsedSeats
        }
    })

   // 2. Eagerly seed the inventory in Redis RAM
const seatKey = `event:${newEvent.id}:availSeats`;
await redis.set(seatKey, parseInt(newEvent.availSeats, 10));
console.log(`[REDIS INVENTORY INITIALIZED] ${seatKey} = ${newEvent.availSeats}`);

    // 3. Invalidate public listing cache
    await redis.del("all_events");
   console.log("[REDIS CACHE INVALIDATED] cleared 'all_events' key")


    return res.status(201).json({success:true, message:"Event created successfully", data:newEvent})
    }catch(err){
  return res.status(500).json({success:false, message:err.message})
    }
})


// 2. Get All Events (Cache-Aside Pattern)
router.get("/", requireAuth, async (req, res) => {
  try {
    const CACHE_KEY = "all_events";

    // 1. Check if cached data exists in Redis
    const cachedEvents = await redis.get(CACHE_KEY);

    if (cachedEvents) {
      console.log("[REDIS CACHE HIT] returning events from redis cache");
      return res.status(200).json({
        success: true,
        source: "cache",
        data: JSON.parse(cachedEvents), // Parse string back into JSON array
      });
    }

    // 2. Cache miss: Fetch from MySQL via Prisma
    console.log("[CACHE MISS] fetching events from MySQL database");
    const events = await prisma.event.findMany({
      include: {
        organizer: {
          select: { name: true, email: true },
        },
      },
    });
    

    // 3. Store in Redis as a JSON string with 60-second expiration
    await redis.set(CACHE_KEY, JSON.stringify(events), "EX", 60);

    return res.status(200).json({
      success: true,
      message: "events returned successfully",
      source: "database",
      data: events,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get Single Event Details
router.get("/:id", requireAuth, async(req,res)=>{
    try{
   const evnId = Number(req.params.id);

   if(isNaN(evnId)){
    return res.status(400).json({success:false, message:"Invalid event id format"})
   }

   const recordEvn= await prisma.event.findUnique({
    where:{id:evnId},
    include:{
        organizer:{
            select:{name:true, email:true}
        }
    }
   })

   if(!recordEvn){
    return res.status(404).json({success:false, message:"Event not found"})
   }

   return res.status(200).json({success:true, message:"Event returned successfuly", data:recordEvn})
    }catch(err){
return res.status(500).json({success:false, error:err.message})
    }
})


// 4. Update Event (Organizer Only)
router.patch("/:id", requireAuth, restrictTo("ORGANIZER"), async (req, res) => {
  try {
    const evnId = Number(req.params.id);
    if (isNaN(evnId)) {
      return res.status(400).json({ success: false, message: "Invalid event id format" });
    }

    const { name, price, description, totalSeats } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;

    if (price !== undefined) {
      const parsedPrice = Number(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ success: false, message: "Price should be a valid non-negative number" });
      }
      updateData.price = parsedPrice;
    }

    // Handle seat reallocation
    if (totalSeats !== undefined) {
      const parsedSeats = Number(totalSeats);
      if (isNaN(parsedSeats) || parsedSeats <= 0) {
        return res.status(400).json({ success: false, message: "Total seats must be a positive integer" });
      }

      const existingEvent = await prisma.event.findUnique({
        where: { id: evnId, organizerId: req.user.id },
        include: { _count: { select: { tickets: true } } },
      });

      if (!existingEvent) {
        return res.status(404).json({
          success: false,
          message: "Event not found or you are not authorized to update this event",
        });
      }

      const ticketsSold = existingEvent._count.tickets;
      if (parsedSeats < ticketsSold) {
        return res.status(400).json({
          success: false,
          message: `Cannot reduce total seats to ${parsedSeats}. Already sold: ${ticketsSold} tickets.`,
        });
      }

      updateData.totalSeats = parsedSeats;
      updateData.availSeats = parsedSeats - ticketsSold;
    }

    // 1. Update in MySQL
    const updEvent = await prisma.event.update({
      where: { id: evnId, organizerId: req.user.id },
      data: updateData,
    });

    // 2. CRITICAL FIX: Synchronize Redis inventory if seats changed
   if (totalSeats !== undefined) {
  const seatKey = `event:${evnId}:availSeats`;
  await redis.set(seatKey, parseInt(updEvent.availSeats, 10));

  if (updEvent.availSeats > 0) {
    soldOutEvents.delete(evnId); // Re-open L1 gate if seats were added
  }
}

    // 3. Invalidate listing cache
    await redis.del("all_events");

    // 4. Offload email broadcast to BullMQ
    await emailQueue.add("event-update", {
  eventId: updEvent.id,
  eventName: updEvent.name,
});

    return res.status(200).json({
      success: true,
      message: "Event updated successfully and notifications queued",
      data: updEvent,
    });
  } catch (err) {
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Event not found or you are not authorized to update this event",
      });
    }

    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;