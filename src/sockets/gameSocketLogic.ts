import { WebSocket, WebSocketServer } from "ws";
import Redis from "ioredis";
import GameRepository from "../repositories/game";

type ParticipantAnswer = {
    question_id: number;
    answer: string;
}

type Answer = {
    a_id: number;
    qu_id: number;
    content: string;
}

type Question = {
    qu_id: number;
    content: string;
    correct_answer: string;
    answers?: Answer[];
}

export default class GameSocketHandler {
    private io: WebSocketServer;
    private rooms: Map<string, Set<WebSocket>> = new Map<string, Set<WebSocket>>();
    private redisClient: Redis;
    private gameRepository: GameRepository;
    private monitorInterval: NodeJS.Timeout | null = null;

    constructor(io: WebSocketServer, redisClient: Redis, gameRepository?: GameRepository) {
        this.io = io;
        this.redisClient = redisClient;

        if (!gameRepository) {
            throw new Error('GameRepository is required');
        }
        this.gameRepository = gameRepository;

        this.initialize();
        this.startScheduledGameMonitor();
    }

    /**
     * Background task that monitors games and sends START_GAME_READY when scheduled_at time arrives.
     * Uses Redis to persist started-game state so restarts don't re-trigger games.
     */
    private startScheduledGameMonitor() {
        this.monitorInterval = setInterval(async () => {
            try {
                const nowTime = Date.now();

                const games = await this.gameRepository.getAllGames();

                if (!games || games.length === 0) return;

                for (const game of games) {
                    const scheduledTime = new Date(game.scheduled_at).getTime();
                    const expiresTime = new Date(game.expires_at).getTime();

                    if (scheduledTime > nowTime || expiresTime <= nowTime) continue;

                    const startedKey = `game:started:${game.game_id}`;
                    const alreadyStarted = await this.redisClient.get(startedKey);
                    if (alreadyStarted) continue;

                    const ttlSeconds = Math.ceil((expiresTime - Date.now()) / 1000) + 60;
                    await this.redisClient.set(startedKey, '1', 'EX', ttlSeconds);

                    console.log(`[Scheduled Game Monitor] Game ${game.game_id} (PIN: ${game.gamePin}) starting now`);

                    this.broadcastToRoom(
                        game.gamePin,
                        GameSocketHandler.Events.START_GAME_READY,
                        { gameId: game.game_id, message: 'Game is ready to start!' }
                    );

                    this.autoStartQuestions(game.game_id, game.gamePin).catch(err => {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.error(`[Scheduled Game Monitor] autoStartQuestions failed for game ${game.game_id}:`, msg);
                    });
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.error('[Scheduled Game Monitor] Error checking scheduled games:', errorMsg);
            }
        }, 5000);
    }

    /**
     * Stop the background monitor (call on shutdown)
     */
    public stopScheduledGameMonitor() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    private initialize() {
        this.io.on('connection', (socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string }) => {
            socket.on('message', (data: WebSocket.RawData) => {
                try {
                    const message = JSON.parse(data.toString());

                    switch (message.type) {
                        case GameSocketHandler.Events.PLAYER_JOIN:
                            const joinPayload = message.payload || { gamePin: message.gamePin, gameId: message.gameId, nickname: message.nickname };
                            this.handleJoin(socket, joinPayload);
                            break;
                        case GameSocketHandler.Events.ANSWER:
                            this.handleAnswer(socket, message.payload);
                            break;
                        case GameSocketHandler.Events.START_QUESTIONS:
                            this.startQuestionLoop(socket, {
                                gameId: message.gameId,
                                questionDurationMs: message.questionDurationMs
                            });
                            break;
                        default:
                            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: `Unknown event type: ${message.type}` } }));
                    }
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                    console.error('Message parsing error:', errorMessage);
                    socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: `Invalid message format: ${errorMessage}` } }));
                }
            });

            socket.on('close', () => this.handleDisconnect(socket));
        });
    }

    private async handleJoin(socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string }, payload: any) {
        try {
            if (!payload?.nickname || typeof payload.nickname !== 'string') {
                socket.send(JSON.stringify({
                    type: GameSocketHandler.Events.ERROR,
                    payload: { message: 'nickname is required and must be a string' }
                }));
                return;
            }

            const nickname = payload.nickname.toUpperCase().trim();

            if (!nickname) {
                socket.send(JSON.stringify({
                    type: GameSocketHandler.Events.ERROR,
                    payload: { message: 'nickname cannot be empty' }
                }));
                return;
            }

            let gamePin = payload.gamePin;
            let gameId = payload.gameId;

            if (!gamePin && gameId) {
                const game = await this.gameRepository.getGameById(gameId);
                if (!game) {
                    socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Game not found' } }));
                    return;
                }
                gamePin = game.gamePin;
            }

            if (gamePin && !gameId) {
                const game = await this.gameRepository.getGameByPIN(gamePin);
                if (!game) {
                    socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Game not found' } }));
                    return;
                }
                gameId = game.game_id;
            }

            if (!gamePin || !gameId) {
                socket.send(JSON.stringify({
                    type: GameSocketHandler.Events.ERROR,
                    payload: { message: 'gamePin or gameId is required' }
                }));
                return;
            }

            if (socket.gamePin && socket.gamePin !== gamePin) {
                const oldRoom = this.rooms.get(socket.gamePin);
                if (oldRoom) {
                    oldRoom.delete(socket);
                    if (oldRoom.size === 0) this.rooms.delete(socket.gamePin);
                }
            }

            socket.gamePin = gamePin;
            socket.gameId = gameId;
            socket.nickname = nickname;

            if (!this.rooms.has(gamePin)) {
                this.rooms.set(gamePin, new Set());
            }
            this.rooms.get(gamePin)!.add(socket);

            socket.send(JSON.stringify({
                type: GameSocketHandler.Events.PLAYER_JOIN,
                payload: { success: true, nickname, gamePin, gameId }
            }));

            this.broadcastToRoom(gamePin, GameSocketHandler.Events.PLAYER_JOINED, { nickname }, socket);

            console.log(`${nickname} joined room ${gamePin} (gameId: ${gameId}), room size: ${this.rooms.get(gamePin)!.size}`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            socket.send(JSON.stringify({
                type: GameSocketHandler.Events.ERROR,
                payload: { message: `Error joining game: ${errorMsg}` }
            }));
        }
    }

    private async startQuestionLoop(
        socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string },
        payload: { gameId: number; questionDurationMs: number }
    ) {
        try {
            const { gameId, questionDurationMs } = payload;
            const gamePin = socket.gamePin;

            if (!gamePin) {
                socket.send(JSON.stringify({
                    type: GameSocketHandler.Events.ERROR,
                    payload: { message: 'Not joined to a game yet. Join a game first.' }
                }));
                return;
            }

            if (!gameId || !questionDurationMs) {
                socket.send(JSON.stringify({
                    type: GameSocketHandler.Events.ERROR,
                    payload: { message: 'Invalid payload. Expected: { gameId: number, questionDurationMs: number }' }
                }));
                return;
            }

            await this.runQuestionLoop(gameId, gamePin, questionDurationMs);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            socket.send(JSON.stringify({
                type: GameSocketHandler.Events.ERROR,
                payload: { message: `Error starting questions: ${errorMsg}` }
            }));
        }
    }

    private async autoStartQuestions(gameId: number, gamePin: string) {
        try {
            const game = await this.gameRepository.getGameById(gameId);
            if (!game) {
                console.error(`[autoStartQuestions] Game ${gameId} not found`);
                return;
            }

            const hashKey = `quiz:${gameId}:questions`;
            let rawQuestions = await this.redisClient.hgetall(hashKey);

            if (!rawQuestions || Object.keys(rawQuestions).length === 0) {
                console.warn(`[autoStartQuestions] No questions for game ${gameId}. Retrying in 2s...`);
                await this.sleep(2000);
                rawQuestions = await this.redisClient.hgetall(hashKey);
            }

            if (!rawQuestions || Object.keys(rawQuestions).length === 0) {
                console.error(`[autoStartQuestions] Still no questions for game ${gameId}.`);
                this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                    message: `Questions not initialized for game ${gameId}. Contact the host.`
                });
                return;
            }

            const questionDurationMs = 10000; // 10 seconds per question
            console.log(`[autoStartQuestions] Starting game ${gameId} with ${Object.keys(rawQuestions).length} questions`);

            await this.runQuestionLoop(gameId, gamePin, questionDurationMs);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[autoStartQuestions] Error for game ${gameId}:`, errorMsg);
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                message: `Error starting questions: ${errorMsg}`
            });
        }
    }

    private async runQuestionLoop(gameId: number, gamePin: string, questionDurationMs: number) {
        const cancelKey = `game:cancel:${gameId}`;
        const leaderboardKey = `game:leaderboard:${gamePin}`;

        try {
            await this.redisClient.del(leaderboardKey);

            const hashKey = `quiz:${gameId}:questions`;
            const rawQuestions = await this.redisClient.hgetall(hashKey);

            if (!rawQuestions || Object.keys(rawQuestions).length === 0) {
                console.error(`[runQuestionLoop] No questions found for game ${gameId}`);
                this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                    message: `No questions found for game ${gameId}. Make sure the game was initialized first.`
                });
                return;
            }

            const questionIds = Object.keys(rawQuestions);
            let remaining = questionIds.length;
            console.log(`[runQuestionLoop] Starting loop for game ${gameId}, ${questionIds.length} questions, ${questionDurationMs}ms each`);

            for (const questionId of questionIds) {
                const cancelled = await this.redisClient.get(cancelKey);
                if (cancelled) {
                    console.log(`[runQuestionLoop] Game ${gameId} cancelled, stopping loop`);
                    break;
                }

                try {
                    const question: Question = JSON.parse(rawQuestions[questionId]);

                    const windowStart = Date.now();
                    const windowEnd = windowStart + questionDurationMs;

                    const { correct_answer, ...safeQuestion } = question;

                    await this.redisClient.set(`game:window:${gameId}:start`, String(windowStart));
                    await this.redisClient.set(`game:window:${gameId}:end`, String(windowEnd));
                    await this.redisClient.set(`game:current_question:${gameId}`, String(questionId));

                    const prevAnswerKeys = await this.redisClient.keys(`game:answered:${gameId}:${questionId}:*`);
                    if (prevAnswerKeys.length > 0) {
                        await this.redisClient.del(...prevAnswerKeys);
                    }

                    console.log(`[runQuestionLoop] Broadcasting question ${questionId} to room ${gamePin} (remaining: ${remaining})`);
                    this.broadcastToRoom(gamePin, GameSocketHandler.Events.QUESTION, {
                        question: safeQuestion,
                        windowStart,
                        windowEnd,
                        remaining
                    });

                    remaining--;

                    await this.sleep(questionDurationMs);

                    const leaderboard = await this.getLeaderboard(gamePin);
                    this.broadcastToRoom(gamePin, GameSocketHandler.Events.LEADERBOARD, { leaderboard });
                } catch (questionErr) {
                    const msg = questionErr instanceof Error ? questionErr.message : String(questionErr);
                    console.error(`[runQuestionLoop] Error processing question ${questionId}:`, msg);
                }
            }

            console.log(`[runQuestionLoop] All questions completed for game ${gameId}`);
            const finalLeaderboard = await this.getLeaderboard(gamePin);
            
            try {
                const leaderboardJson = JSON.stringify(finalLeaderboard);
                const finalLeaderboardKey = `final_leaderboard:game:${gameId}`;
                await this.redisClient.set(finalLeaderboardKey, leaderboardJson, 'EX', 86400);
                console.log(`[runQuestionLoop] Saved final leaderboard for game ${gameId} to Redis`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[runQuestionLoop] Failed to save leaderboard for game ${gameId}:`, msg);
            }
            
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.GAME_OVER, { leaderboard: finalLeaderboard });

            await this.redisClient.del(leaderboardKey);

            // Clean up Redis game state
            await this.redisClient.del(
                `game:state:${gamePin}`,
                `game:players:${gamePin}`,
                `game:window:${gameId}:start`,
                `game:window:${gameId}:end`,
                `game:current_question:${gameId}`,
                cancelKey
            );

            this.rooms.delete(gamePin);

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[runQuestionLoop] Fatal error for game ${gameId}:`, errorMsg);
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                message: `Fatal error in question loop: ${errorMsg}`
            });
        }
    }

    private async handleAnswer(
        socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string },
        payload: ParticipantAnswer
    ) {
        if (!payload || typeof payload !== 'object') {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Invalid answer payload.' } }));
            return;
        }

        const { question_id, answer } = payload;
        const gamePin = socket.gamePin;
        const gameId = socket.gameId;
        const nickname = socket.nickname;

        if (!gamePin || !nickname || !gameId) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Not properly joined to a game.' } }));
            return;
        }

        if (question_id === undefined || question_id === null || !answer || typeof answer !== 'string') {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'question_id and answer are required.' } }));
            return;
        }
        const [windowStartRaw, windowEndRaw, currentQuestionRaw] = await Promise.all([
            this.redisClient.get(`game:window:${gameId}:start`),
            this.redisClient.get(`game:window:${gameId}:end`),
            this.redisClient.get(`game:current_question:${gameId}`)
        ]);

        if (!windowStartRaw || !windowEndRaw) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'No active question window.' } }));
            return;
        }

        const windowStart = parseInt(windowStartRaw);
        const windowEnd = parseInt(windowEndRaw);
        const now = Date.now();

        if (now > windowEnd) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Answer submitted after window closed.' } }));
            return;
        }

        if (currentQuestionRaw !== String(question_id)) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'This question is no longer active.' } }));
            return;
        }

        const dedupeKey = `game:answered:${gameId}:${question_id}:${nickname}`;
        const alreadyAnswered = await this.redisClient.get(dedupeKey);
        if (alreadyAnswered) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'You have already answered this question.' } }));
            return;
        }
        const ttl = Math.ceil((windowEnd - now) / 1000) + 5;
        await this.redisClient.set(dedupeKey, '1', 'EX', ttl);

        const hashKey = `quiz:${gameId}:questions`;
        const raw = await this.redisClient.hget(hashKey, String(question_id));
        if (!raw) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Question not found.' } }));
            return;
        }

        const question: Question = JSON.parse(raw);


        const isCorrect = answer.trim().toLowerCase() === question.correct_answer.trim().toLowerCase();

        const timeTakenSeconds = Math.max((now - windowStart) / 1000, 0.001);
        const windowDuration = (windowEnd - windowStart) / 1000;

        let score = 0;
        if (isCorrect) {
            const logDecay = (Math.log10(timeTakenSeconds) + 1) / timeTakenSeconds;
            const tiebreaker = windowDuration - timeTakenSeconds;
            score = Math.max(logDecay + tiebreaker, 0);
            score = Math.round(score * 100) / 100;
        }

        const leaderboardKey = `game:leaderboard:${gamePin}`;
        if (isCorrect) {
            await this.redisClient.zincrby(leaderboardKey, score, nickname);
        }

        const newTotalRaw = await this.redisClient.zscore(leaderboardKey, nickname);
        const newTotal = newTotalRaw ? parseFloat(newTotalRaw) : 0;

        const leaderboardPos = await this.redisClient.zscore(leaderboardKey, nickname)

        socket.send(JSON.stringify({
            type: GameSocketHandler.Events.ANSWER_RESULT,
            payload: {
                isCorrect,
                score,
                totalScore: newTotal,
                correctAnswer: isCorrect ? undefined : question.correct_answer,
                position: parseInt(leaderboardPos!) + 1
            }
        }));

        console.log(`Answer from ${nickname} in room ${gamePin} [q:${question_id}]: ${isCorrect ? 'correct' : 'wrong'} (+${score})`);
    }

    private async getLeaderboard(gamePin: string): Promise<{ nickname: string; score: number }[]> {
        const leaderboardKey = `game:leaderboard:${gamePin}`;
        const raw = await this.redisClient.zrevrange(leaderboardKey, 0, -1, 'WITHSCORES');
        const leaderboard: { nickname: string; score: number }[] = [];
        for (let i = 0; i < raw.length; i += 2) {
            leaderboard.push({ nickname: raw[i], score: parseFloat(raw[i + 1]) });
        }
        return leaderboard;
    }

    public broadcastToRoom(gamePin: string, event: string, payload: any, exclude?: WebSocket) {
        const clients = this.rooms.get(gamePin);

        if (!clients || clients.size === 0) {
            console.warn(`[broadcastToRoom] No clients in room ${gamePin} for event ${event}`);
            return;
        }

        const message = JSON.stringify({ type: event, payload });
        let sentCount = 0;
        clients.forEach(client => {
            if (client !== exclude && client.readyState === WebSocket.OPEN) {
                client.send(message);
                sentCount++;
            }
        });
        console.log(`[broadcastToRoom] Sent ${event} to ${sentCount}/${clients.size} clients in room ${gamePin}`);
    }

    private handleDisconnect(socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string }) {
        if (socket.gamePin && this.rooms.has(socket.gamePin)) {
            this.rooms.get(socket.gamePin)!.delete(socket);

            if (this.rooms.get(socket.gamePin)!.size === 0) {
                this.rooms.delete(socket.gamePin);
            }

            if (socket.nickname) {
                this.broadcastToRoom(socket.gamePin, GameSocketHandler.Events.PLAYER_LEFT, {
                    nickname: socket.nickname
                });
            }
        }
    }

    /**
     * Cancel a running game loop externally (e.g. host aborts the game)
     */
    public async cancelGame(gameId: number) {
        await this.redisClient.set(`game:cancel:${gameId}`, '1', 'EX', 3600);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static readonly Events = {
        PLAYER_JOIN: 'PLAYER_JOIN',
        PLAYER_JOINED: 'PLAYER_JOINED',
        PLAYER_LEFT: 'PLAYER_LEFT',
        START_QUESTIONS: 'START_QUESTIONS',
        START_GAME_READY: 'START_GAME_READY',
        QUESTION: 'QUESTION',
        ANSWER: 'ANSWER',
        ANSWER_RESULT: 'ANSWER_RESULT',
        LEADERBOARD: 'LEADERBOARD',
        GAME_OVER: 'GAME_OVER',
        ERROR: 'ERROR',
    } as const;
}