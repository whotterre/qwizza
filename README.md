# Qwizza

A high-concurrency real-time quiz platform designed to replicate the Kahoot experience for 1,000+ simultaneous players.

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
3. **Database:** `npx drizzle-kit push:pg`
4. **Start:** `npm run dev`
