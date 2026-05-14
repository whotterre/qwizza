import http from 'k6/http';
import { check, sleep } from 'k6';
import ws from 'k6/ws';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const PLAYER_VUS = Number(__ENV.PLAYER_VUS || 1000);
const PLAYER_DURATION = __ENV.PLAYER_DURATION || '90s';
const HOST_START_TIME = __ENV.HOST_START_TIME || '10s';

const answerLatency = new Trend('answer_latency_ms');
const correctAnswers = new Counter('correct_answers');
const wrongAnswers = new Counter('wrong_answers');

export const options = {
  setupTimeout: '180s',
  scenarios: {
    players: {
      executor: 'constant-vus',
      vus: PLAYER_VUS,
      duration: PLAYER_DURATION,
      exec: 'player'
    },
    host: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: HOST_START_TIME,
      exec: 'host'
    }
  }
};

function jsonHeaders(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export function setup() {
  // Create a host, game, quiz and 20 questions, then initialize the game.
  const hostEmail = `host+${Date.now()}@load.test`;
  const password = 'password123';

  let res = http.post(`${BASE}/user/signup`, JSON.stringify({ email: hostEmail, password, role: 'host' }), { headers: jsonHeaders() });
  if (res.status !== 201) {
    console.error('host signup failed', res.status, res.body);
    throw new Error('host signup failed');
  }

  res = http.post(`${BASE}/user/login`, JSON.stringify({ email: hostEmail, password }), { headers: jsonHeaders() });
  if (res.status !== 200) {
    console.error('host login failed', res.status, res.body);
    throw new Error('host login failed');
  }

  const loginBody = res.json();
  // token may be at top-level or nested under `user` depending on server response shape
  const token = (loginBody && (loginBody.token || (loginBody.user && loginBody.user.token))) || undefined;
  if (!token) {
    console.error('No token returned from login; response:', JSON.stringify(loginBody));
    throw new Error('No auth token available');
  }

  // create game scheduled a little in the future (ISO string)
  const scheduledAt = new Date(Date.now() + 30 * 1000).toISOString();
  res = http.post(`${BASE}/games`, JSON.stringify({ name: 'k6 load test', question_duration: 5, scheduled_at: scheduledAt }), { headers: jsonHeaders(token) });
  check(res, { 'create game 201': r => r.status === 201 });
  const game = res.json('game');
  const gamePin = game.gamePin || game.game_pin || game.gamePin;
  const gameId = game.game_id;
  const hostId = game.host_id;

  // add quiz
  res = http.post(`${BASE}/games/${gamePin}/quiz`, JSON.stringify({ title: 'Load Test Quiz' }), { headers: jsonHeaders(token) });
  check(res, { 'add quiz 201': r => r.status === 201 });
  const quiz = res.json('quiz');

  // craft 20 questions
  const items = [];
  for (let i = 1; i <= 20; i++) {
    const answers = [
      `Answer A (${i})`,
      `Answer B (${i})`,
      `Answer C (${i})`,
      `Answer D (${i})`
    ];
    const correct = answers[Math.floor(Math.random() * answers.length)];
    items.push({ content: `Question ${i} - What is ${i}?`, correct_answer: correct, answers });
  }

  res = http.post(`${BASE}/quizzes/${quiz.q_id}/questions`, JSON.stringify({ items }), { headers: jsonHeaders(token) });
  check(res, { 'add questions 201': r => r.status === 201 });

  // initialize game (loads questions into Redis)
  res = http.get(`${BASE}/game/initialize/${gamePin}`, { headers: jsonHeaders(token) });
  check(res, { 'initialize 200': r => r.status === 200 });

  return { base: BASE, gamePin, gameId, quizId: quiz.q_id, token, hostEmail, hostId };
}

export function teardown(data) {
  if (!data) return;

  const { base, hostId } = data;

  console.log(`\n=== CLEANUP ===`);
  console.log(`Deleting host user (ID: ${hostId})`);

  // Delete the host user (cascade will clean up games, quizzes, etc.)
  if (hostId) {
    const res = http.del(`${base}/user/${hostId}`, null, { headers: jsonHeaders() });
    if (res.status === 200) {
      console.log(`✓ Host user deleted successfully`);
    } else {
      console.log(`✗ Failed to delete host user: ${res.status}`);
    }
  }

  console.log(`=== CLEANUP COMPLETE ===\n`);
}

export function host(data) {
  const { base, gamePin, gameId } = data;
  const wsUrl = base.replace(/^http/, 'ws');

  const res = ws.connect(wsUrl, {}, function (socket) {
    socket.on('open', function () {
      // Host joins room (nickname can be arbitrary)
      socket.send(JSON.stringify({ type: 'PLAYER_JOIN', payload: { gamePin, nickname: 'HOST' } }));
    });

    socket.on('message', function (msg) {
      const parsed = JSON.parse(msg);
      // when players have joined, kick off questions after a short wait
      if (parsed.type === 'PLAYER_JOINED') {
        // wait a little to allow many players to connect
        setTimeout(() => {
          socket.send(JSON.stringify({ type: 'START_QUESTIONS', gameId: gameId, questionDurationMs: 3000 }));
        }, 5000);
      }
    });

    socket.setTimeout(function () {
      socket.close();
    }, 60000);
  });

  check(res, { 'host ws connected': r => r && r.status === 101 });
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function player(data) {
  const { base, gamePin } = data;
  // stable email per VU improves cache hit-rate and avoids hot-path DB misses
  const email = `vu${__VU}@load.test`;

  // stagger players over first 30s to avoid thundering herd
  sleep(Math.random() * 2);

  // create a player nickname (server generates nickname)
  const res = http.post(`${base}/games/${gamePin}/players`, JSON.stringify({ email }), { headers: jsonHeaders() });
  if (res.status !== 201) {
    console.log(`Player ${email} failed to register:`, res.status, res.body);
    return;
  }
  const resBody = res.json();
  let nickname = resBody.player;
  
  // Handle different response shapes
  if (!nickname && typeof resBody === 'string') {
    nickname = resBody;
  }
  if (!nickname && resBody.nickname) {
    nickname = resBody.nickname;
  }
  
  // Ensure it's a string
  if (nickname && typeof nickname === 'object') {
    nickname = nickname.name || nickname.n_id || JSON.stringify(nickname);
  }
  if (!nickname || typeof nickname !== 'string') {
    console.log(`No valid nickname for ${email}; response:`, JSON.stringify(resBody));
    return;
  }

  // register the nickname into the live game (redis)
  const joinRes = http.post(`${base}/game/join/${gamePin}`, JSON.stringify({ nickname }), { headers: jsonHeaders() });
  if (joinRes.status !== 200) {
    console.log(`Player ${nickname} failed to join:`, joinRes.status, joinRes.body);
    return;
  }

  const wsUrl = base.replace(/^http/, 'ws');

  const r = ws.connect(wsUrl, {}, function (socket) {
    socket.on('open', function () {
      socket.send(JSON.stringify({ type: 'PLAYER_JOIN', payload: { gamePin, nickname } }));
    });

    socket.on('message', function (msg) {
      try {
        const message = JSON.parse(msg);

        if (message.type === 'QUESTION') {
          const q = message.payload.question;
          const qid = q.qu_id || q.quId || q.id;
          const choiceLetters = ['A', 'B', 'C', 'D'];
          const chosen = randomChoice(choiceLetters);
          const before = Date.now();
          socket.send(JSON.stringify({ type: 'ANSWER', payload: { question_id: qid, answer: chosen } }));
          const after = Date.now();
          answerLatency.add(after - before);
        }

        if (message.type === 'ANSWER_RESULT') {
          const payload = message.payload || {};
          if (payload.isCorrect) correctAnswers.add(1); else wrongAnswers.add(1);
        }

        if (message.type === 'GAME_OVER') {
          socket.close();
        }
      } catch (e) {
        console.log('Error parsing message:', e);
      }
    });

    socket.on('close', function () {});
    socket.on('error', function (e) {
      console.log(`WebSocket error for ${nickname}:`, e);
    });

    socket.setTimeout(function () {
      socket.close();
    }, 70000);
  });

  check(r, { 'player ws connected': r => r && r.status === 101 });
}
