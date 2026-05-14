# Qwizza

A high-concurrency real-time quiz platform designed to replicate the Kahoot experience for 1,000 simultaneous players.

The primary goal of this project is to solve the "800-user bottleneck." Most clones struggle with lag and connection drops at scale; Qwizza aims to use a lean Node.js architecture and Redis-backed state to ensure the game remains responsive even when 1,000+ students answer at the exact same millisecond.

## Technical Strategy

* **Raw WebSockets:** Built using `ws` instead of Socket.io to eliminate protocol overhead and maximize throughput.
* **The "First to Answer" Problem:** Uses **Redis Sorted Sets (ZSETs)** to handle scoring. Scores are stored as floats: `Points + (TimeRemaining / TotalDuration)`, allowing Redis to handle millisecond-level tie-breaking automatically.
* **Hybrid Data Flow:** Real-time game state lives in **Redis** for sub-millisecond latency. A background worker checkpoints this data to **PostgreSQL** to ensure the game can be recovered if the server restarts.

## Key Decisions

* **Manual Dependency Injection:** Services are wired manually in `server.ts` to keep the execution path explicit and fast.
* **Drizzle ORM:** Used for a lightweight, type-safe interface with PostgreSQL without the performance tax of heavier ORMs.
* **NanoID:** Generated 5-character alphanumeric Game PINs (collision-checked via Redis `SADD`) and 21-character session IDs for reliable player reconnection.

## Project Structure

```text
drizzle.config.ts        # Drizzle configuration
package.json             # Project manifest and scripts
README.md                # Project overview and docs
drizzle/                 # SQL migrations and raw SQL helpers
src/                     # Application source
├── index.ts             # App entry (or server.ts)
├── db/                  # Drizzle schema and DB helpers (schema.ts)
├── controllers/         # Express HTTP handlers
├── services/            # Business logic and use-cases
├── repositories/        # Data access (Postgres/Redis)
├── routes/              # Route definitions and routers
├── middleware/          # Auth, validation, error handlers
└── utils/               # Small helpers and shared utilities

```

## Setup & Running

1. **Infrastructure:** `docker-compose up -d` (Spin up Postgres and Redis)
2. **Install:** `npm install`
3. **Database:** `npx drizzle-kit push`
4. **Start:** `npm run dev`

## Load testing — what we did and why
Below is a concise, human-readable timeline of the changes I made while bringing Qwizza from an early k6 prototype to a stable 500‑VU run.

### Starting point — an end-to-end k6 script

I started with a single k6 script that exercised the entire flow (host signup/login, create game/quiz/questions, initialize, then spawn players that join and answer over WebSockets).

What happened:
- Setup often timed out, especially during the `POST /games` step when I tried running many users.

Why that mattered:
- Timeouts meant the test couldn't reliably exercise the real-time code paths I wanted to validate.

---

### Fix 1 — make the DB connection stable and observable

What I changed:
- Increased Postgres pool size and adjusted timeouts in `src/index.ts`.
- Added a way to inspect the pool during runtime for debugging.

Impact:
- The server stopped failing on simple connections, but we still saw latency and occasional hangs during heavy setup.

---

### Fix 2 — speed up slow queries with indexes

What I changed:
- Added indexes for the hot fields that were showing up in slow queries (game pins, nicknames, user email, quiz/question relationships).

Impact:
- Selects for games, users, quizzes and questions became much faster under load.

---

### Fix 3 — move reads to Redis where appropriate

What I changed:
- Cache `getGameByPIN` results in Redis.
- Replace DB uniqueness checks for nicknames with an atomic Redis `SADD`.
- Add short-lived caching for user email lookups (including caching misses).

Why:
- Redis is orders of magnitude faster for small lookups and atomic operations. This reduced round-trips and contention on Postgres.

Impact:
- Player join handling became lighter and more predictable.

---

### Fix 4 — make writes asynchronous (worker)

Problem:
- During peak join activity the database received many concurrent nickname inserts, causing bursts and increased latency.

What I changed:
- Enqueue nickname writes to a Redis list from the HTTP path.
- Add a background worker (`src/workers/nickname_writer.ts`) that drains the queue and persists nicknames to Postgres.

Important detail:
- The first worker implementation shared the app Redis client and used blocking pops — that inadvertently blocked other Redis commands. We fixed it by giving the worker its own Redis connection.

Impact:
- The app no longer blocks on BRPOP and the write bursts are smoothed by the worker.

---

### Fix 5 — make the worker robust and efficient

What I changed:
- Batch up nickname writes in the worker (small batches flushed every second or when full), with a safe fallback to individual retries.

Impact:
- Lowered the number of DB transactions under bursts and improved throughput.

---

### Fix 6 — harden the test script and test data

Problem:
- The original k6 script created a new, random email for every join request. That caused many cache misses and extra DB lookups.

What I changed:
- Use a stable per‑VU email (`vu${__VU}@load.test`) so each virtual user reuses the same identity across the test.
- Add `scripts/precreate_k6_users.ts` to pre-insert test users into Postgres before a run (useful for large VU counts).
- Make the optional user lookup in `addPlayer` tolerant — if the DB lookup fails I continue without attaching a `user_id` (join still works).

Impact:
- Dramatically reduced transient 500s originating from concurrent user lookups; the test became far more repeatable.

---

### Diagnostics added along the way

To see what was happening in real time we added small, temporary helpers:
- debug endpoints (pool/queue/db-test/pg-activity) to inspect Postgres and Redis state
- logging around `createGame` and other critical paths so long operations are visible in the server logs

These were intended for staging only and can be removed or guarded by an environment flag before shipping to production.

---

### Final outcome (short)

- 100 VU: stable, near-zero failures.
- 500 VU: stable, checks passed, almost no failures (0.05% HTTP failures), median request latencies around 5–6s, p95 near 10s.

What this means: the system is reliable at 500 concurrent players for the tested scenario. The remaining work is mostly about lowering latency and optimizing tail behavior (p95/p99).

---

### Quick commands (how to reproduce the load test)

Precreate 500 users:
```powershell
$env:K6_USERS=500; npm run precreate:k6
```

Run the load test at the default target (now 500 players):
```powershell
k6 run tests/k6/qwizza_k6_test.js
```

Or override the number of players on the fly:
```powershell
k6 run -e PLAYER_VUS=300 tests/k6/qwizza_k6_test.js
```

---
