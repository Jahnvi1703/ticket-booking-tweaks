 # High-Concurrency Distributed Event Booking System

A distributed backend service built with **Node.js, Express, Prisma ORM, MySQL (Aiven Cloud), Redis (ioredis / Redis Cloud), and BullMQ**.

Designed to handle high-concurrency ticket drops and flash sales with **strict inventory consistency (zero overselling)**, sub-millisecond in-memory gating, asynchronous persistence, and rate-limited background notification processing.

---

## 🏛️ System Architecture

The application decouples the high-contention booking intake path from disk persistence and third-party email API calls:

```text
[ Incoming Flash Crowd (Concurrent Booking Traffic) ]
                          │
                          ▼
           ┌───────────────────────────────┐
           │    Express API Gateway        │
           │    (Stateless Intake Layer)   │
           └──────────────┬────────────────┘
                          │
                Atomic Redis Lua Script
                (<0.5ms Evaluation in RAM)
                          │
           ┌──────────────┴──────────────┐
           │                             │
    Seats <= 0                      Seats > 0
           │                             │
           ▼                             ▼
   HTTP 409 Conflict             HTTP 202 Accepted
  (Fail-Fast in RAM)             (Enqueued to BullMQ)
 [MySQL NEVER Touched]           [Zero DB Reads in Route]
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │     BullMQ Redis Queue    │
                           │  ('ticket-persistence')   │
                           └─────────────┬─────────────┘
                                         │
                              Worker Concurrency: 1
                            (Sequential Queue Draining)
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │   MySQL Transaction (ACID)│
                           │  - Decrement seats in DB  │
                           │  - Insert confirmed ticket│
                           └─────────────┬─────────────┘
                                         │
                                         ▼
                           ┌───────────────────────────┐
                           │    BullMQ Email Queue     │
                           │  Rate-limited: 2 req/sec  │
                           │  (Resend API Dispatcher)  │
                           └───────────────────────────┘ 


```
## Key Architectural Decisions and Engineering Trade-Offs

1. In-Memory Atomic Inventory Gating (Redis + Lua Script)
The Problem: In standard relational architectures, concurrent requests attempt to decrement the same availSeats row in MySQL. Under heavy traffic, this triggers InnoDB exclusive row locks (X-locks), lock wait timeouts (1205), transaction deadlocks (P2034), and connection pool starvation.

The Solution: Inventory gating runs inside an atomic Redis Lua script evaluated entirely in RAM. Because Redis is single-threaded, race conditions are mathematically eliminated:

If seats > 0, the script decrements the inventory counter in RAM and returns 1.

If seats <= 0, the script returns 0, and the Express handler immediately responds with HTTP 409 Sold out.

Database Isolation: Over 99% of losing requests are rejected at the memory tier without executing any read or write queries against MySQL.

2. Asynchronous Persistence and Connection Protection (BullMQ)
The Problem: Relational disk writes take between 5ms and 20ms. Forcing the client HTTP connection to await database writes under extreme concurrency exhausts server sockets and database connection limits (connection_limit=15).

The Solution: The client receives an immediate HTTP 202 Accepted after the Lua script succeeds. Booking persistence is delegated to a BullMQ worker queue (ticket-persistence).

Sequential Queue Draining: The persistence worker runs at concurrency: 1 with an extended transaction timeout (maxWait: 10000ms, timeout: 20000ms). This processes winning reservations sequentially against MySQL, preventing row deadlocks while keeping connection pool usage flat.

3. Decoupled, Rate-Limited Background Tasks
Background Task 1 (Booking Confirmation Email): Dispatched only after the MySQL transaction commits. The email task is enqueued to email-queue and processed by a dedicated worker configured with a token-bucket rate limiter (limiter: { max: 2, duration: 1000 }). This prevents HTTP 429 Too Many Requests errors from third-party email providers (Resend).

Background Task 2 (Event Update Broadcast): When an organizer updates event metadata, PATCH /api/events/:id queries the attendees and enqueues an asynchronous broadcast job, preventing large attendee lists from blocking the organizer's API request.

Fault Isolation: Email dispatch failures never roll back an already-confirmed ticket in MySQL.

4. Eager Inventory Pre-Warming (Thundering Herd Defense)
Lazy-loading inventory from MySQL on the first user request risks a Cache Stampede, where concurrent requests hit a cold key simultaneously and overwhelm the database.

Inventory keys (event:<id>:availSeats) are eagerly initialized in Redis RAM when an organizer creates an event (POST /api/events) or modifies seat counts (PATCH /api/events/:id).

5. Read Acceleration (Cache-Aside Pattern)
GET /api/events implements the Cache-Aside pattern using Redis with a 60-second TTL.

Event creations and updates actively execute redis.del("all_events") to purge stale cache entries immediately.

API Reference and Endpoints
Authentication and Roles
```
POST /api/auth/register - Create an account (CUSTOMER or ORGANIZER).

POST /api/auth/login - Authenticate and retrieve a signed JWT.

Events (Role-Gated)
POST /api/events - [ORGANIZER] Create an event. Eagerly seeds event:<id>:availSeats in Redis and invalidates the public catalog cache.

GET /api/events - [ALL] Browse all events via the Cache-Aside read layer.

GET /api/events/:id - [ALL] Retrieve specific event metadata.

PATCH /api/events/:id - [ORGANIZER] Update event details or capacity. Synchronizes Redis inventory and triggers asynchronous attendee notifications.

Ticket Bookings and Concurrency Benchmarking
POST /api/memoryTickets - [CUSTOMER] Optimized Endpoint. Atomic Redis Lua inventory decrement -> HTTP 202 Accepted -> Asynchronous BullMQ persistence -> Rate-limited email.

POST /api/leanTickets - [CUSTOMER] Baseline Naive Endpoint. Direct relational database transaction with synchronous email processing in the request loop (used for comparative constraint demonstration).

```
Stress-Testing and Performance Methodology
Load testing is performed using autocannon to evaluate system stability and verify zero overselling under high concurrency.

Baseline Benchmark (Finding the Initial Constraint)
Executes concurrent requests against the direct database and synchronous email path:

```
npx autocannon -m POST -c 100 -a 1000 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -b "{\"eventId\": <EVENT_ID>}" \
  <DEPLOYED_URL>/api/leanTickets
```

Optimized Benchmark (Demonstrating Scaled Throughput)
Executes concurrent requests against the in-memory Lua gating and asynchronous queue path:

```
npx autocannon -m POST -c 500 -a 5000 \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -b "{\"eventId\": <EVENT_ID>}" \
  <DEPLOYED_URL>/api/memoryTickets
  ```
(Live execution metrics, breaking point observations, and delta comparisons are demonstrated on the deployed URL in the video walkthrough).

Environment Configuration
Set the following environment variables in your deployment environment:

Code snippet
PORT=5000
NODE_ENV=production

#### MySQL Database (Aiven Cloud / Remote)
DATABASE_URL="mysql://<USER>:<PASSWORD>@<HOST>:<PORT>/<DATABASE>?ssl-mode=REQUIRED&connection_limit=15&pool_timeout=10"

#### Redis Datastore (Redis Cloud / Remote)
REDIS_URL="redis://<USER>:<PASSWORD>@<HOST>:<PORT>"

#### Security
JWT_SECRET="your-jwt-secret-key"

#### Email Delivery
RESEND_API_KEY="re_your_api_key_here"
💡 