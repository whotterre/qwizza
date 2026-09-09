# Qwizza

A real-time quiz platform designed to replicate the Kahoot experience for 1,000+ simultaneous players.

The primary goals of this project are to see how far Node.js can perform in a high traffic near real-time scenario and attempt to see replicate core functionality of the model app (Kahoots.it).


## Highlights
* **Lean WebSocket library:** Built using `ws` instead of Socket.io to eliminate protocol overhead and maximize throughput.
* **"First to Answer" Problem:** What happens when people get the correct answer at the same /almost the same time? 
We use **Redis Sorted Sets (ZSETs)** to handle scoring. Scores are stored as floats: `Points + (TimeRemaining / TotalDuration)`, allowing Redis to handle millisecond-level tie-breaking automatically.
* **Hybrid Data Flow:** Real-time game state lives in **Redis** for sub-millisecond latency. A background worker checkpoints this data to **PostgreSQL** to ensure the game can be recovered if the server restarts.

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
├── sockets              # WebSocket logic
├── repositories/        # Data access (Postgres/Redis)
├── routes/              # Route definitions and routers
├── middleware/          # Auth, validation, error handlers
└── utils/               # Small helpers and shared utilities

```

## Setup & Running

1. **Install:** `npm install`
2. **Database:** `npx drizzle-kit push:pg`
3. **Start:** `npm run dev`


# Recent updates (8th - 9th September)
Add delete quiz logic 
Fix nav buttons not showing during quizzes
Fix hydration of options button during quizzes
Adjust game PIN generation logic to generate only 6 digit PINs
Fix leaderboard not displaying at the end issue