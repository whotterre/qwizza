# Qwizza K6 Load Test Guide

This guide explains how to run the k6 load test against qwizza to simulate 1,000 concurrent quiz players.

## Pre-requisites

1. **k6 installed**: https://k6.io/docs/get-started/installation/
2. **Qwizza service running** with:
   - `DATABASE_URL` pointing to Postgres (with tables created via `npm run migrate`)
   - `JWT_SECRET` set
   - `REDIS_URL` configured
   - Service running on `http://localhost:3000` (or set `BASE_URL` env var)

3. **Node modules installed**: `npm install`

## Quick Start

### 1. Start the Qwizza Server

In one terminal:

```powershell
$env:DATABASE_URL = "postgres://user:pass@host:5432/db?sslmode=require"
$env:JWT_SECRET = "your_jwt_secret"
$env:REDIS_URL = "rediss://user:pass@host:6379"

npm run dev
```

Wait for:
```
Service live on port 3000
Connected to Redis at ...
```

### 2. Run Smoke Test (10 VUs, 30 seconds)

In another terminal:

```powershell
$env:BASE_URL = "http://localhost:3000"

k6 run --vus 10 --duration 30s tests/k6/qwizza_k6_test.js
```

**Expected output**: Players connect, join game, answer random questions, see leaderboard updates. Check for:
- `✓ host signup 201`, `✓ host login 200`
- `✓ host ws connected`
- `✓ player ws connected`
- Metrics: `answer_latency_ms`, `correct_answers`, `wrong_answers`

### 3. Run Full Load Test (1,000 VUs, 90 seconds)

```powershell
$env:BASE_URL = "http://localhost:3000"

k6 run tests/k6/qwizza_k6_test.js
```

**Test flow:**
1. **Setup phase** (host creates game, quiz, 20 questions, initializes)
2. **Host joins** WebSocket at T+8s
3. **Players ramp up** (1,000 VUs over 90s) in parallel:
   - Register with unique email
   - Join game via REST
   - Connect WebSocket
   - Wait for questions
4. **Questions broadcast** (host sends 20 questions at ~3s each)
5. **Players submit answers** (A–D random) with latency tracked
6. **Final leaderboard** sent, game closes

## Metrics Collected

- **answer_latency_ms**: Time from sending answer to receiving confirmation (Trend)
- **correct_answers**: Counter of correct submissions
- **wrong_answers**: Counter of incorrect submissions
- **HTTP metrics**: Signup, login, game creation, quiz setup
- **WebSocket metrics**: Connection success, message delivery

## Output / Results

k6 prints a summary at the end:

```
█ TOTAL RESULTS
  answer_latency_ms...: avg=45ms  min=2ms  med=38ms  max=150ms  p(95)=95ms
  correct_answers......: 4532
  wrong_answers........: 5123
  http_req_duration...: avg=523ms
  ✓ host signup 201
  ✓ host login 200
  ✓ host ws connected
  ✓ player ws connected
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Qwizza API/WebSocket endpoint |
| `DATABASE_URL` | (from .env) | Postgres connection string |
| `JWT_SECRET` | (from .env) | Token signing secret |
| `REDIS_URL` | (from .env) | Redis connection for game state |

## Troubleshooting

### "host signup failed 500"
- Ensure `npm run migrate` was run and tables exist
- Check database credentials in `DATABASE_URL`

### "Game not found" errors on players
- Ensure host setup phase completes (check host logs)
- Server may be too slow; try with fewer VUs first

### WebSocket connection fails
- Ensure WebSocket server is listening (check `npm run dev` output)
- Verify `BASE_URL` is correct and reachable

### SSL certificate errors
Append to `DATABASE_URL`:
```
?sslmode=require
```

## Customizing the Test

Edit [tests/k6/qwizza_k6_test.js](tests/k6/qwizza_k6_test.js):

- **Question count**: Change loop in `setup()` from `i <= 20` to desired number
- **Question duration**: Adjust `questionDurationMs` in `host()` function
- **Player count**: Change `options.scenarios.players.vus` 
- **Test duration**: Change `options.scenarios.players.duration`
- **Answer options**: Add/remove from `choiceLetters` array in `player()` function

## Example: Reduce to 100 VUs for testing

```js
export const options = {
  scenarios: {
    players: {
      executor: 'constant-vus',
      vus: 100,  // Change from 1000
      duration: '30s',
      exec: 'player'
    },
    // ... rest stays the same
  }
};
```

Then run:
```powershell
k6 run tests/k6/qwizza_k6_test.js
```