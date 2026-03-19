import { WebSocket, WebSocketServer } from "ws";
import Redis from "ioredis";
import GameRepository from "../repositories/game";

type ParticipantAnswer = {
    question_id: number;
    answer: string;      
    windowStart: number;  
    windowEnd: number;     
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
    private startedGames: Set<number> = new Set();
    private monitorInterval: NodeJS.Timeout | null = null;

    constructor(io: WebSocketServer, redisClient: Redis, gameRepository?: GameRepository) {
        this.io = io;
        this.redisClient = redisClient;
        this.gameRepository = gameRepository!;
        this.initialize();
        if (this.gameRepository) {
            this.startScheduledGameMonitor();
        }
    }

    /**
     * Background task that monitors games and sends START_GAME_READY when scheduled_at time arrives
     */
    private startScheduledGameMonitor() {
        // Check every 5 seconds if any games should start
        this.monitorInterval = setInterval(async () => {
            try {
                const now = new Date();
                const nowTime = now.getTime();
                
                // Query all games that:
                // 1. Have scheduled_at <= current time
                // 2. Have expires_at > current time (game hasn't ended yet)
                // 3. Haven't already been triggered (not in startedGames set)
                const games = await this.gameRepository.getAllGames();
                
                if (!games || games.length === 0) return;

                for (const game of games) {
                    const scheduledTime = new Date(game.scheduled_at).getTime();
                    const expiresTime = new Date(game.expires_at).getTime();

                    // Check if game is currently active and hasn't been started yet
                    if (scheduledTime <= nowTime && expiresTime > nowTime && !this.startedGames.has(game.game_id)) {
                        this.startedGames.add(game.game_id);
                        
                        console.log(`[Scheduled Game Monitor] Game ${game.game_id} (PIN: ${game.gamePin}) is within active interval, starting now`);

                        // Broadcast START_GAME_READY to all players in this game
                        this.broadcastToRoom(
                            game.gamePin,
                            GameSocketHandler.Events.START_GAME_READY,
                            { 
                                gameId: game.game_id, 
                                message: 'Game is ready to start!' 
                            }
                        );

                        // Automatically start the question loop (don't await to prevent blocking)
                        this.autoStartQuestions(game.game_id, game.gamePin).catch(err => {
                            const msg = err instanceof Error ? err.message : String(err);
                            console.error(`[Scheduled Game Monitor] autoStartQuestions failed for game ${game.game_id}:`, msg);
                        });
                    }
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.error('[Scheduled Game Monitor] Error checking scheduled games:', errorMsg);
            }
        }, 5000); // Check every 5 seconds
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
                     console.log(message)
                    switch (message.type) {
                        case GameSocketHandler.Events.PLAYER_JOIN:
                            const joinPayload = message.payload || { gamePin: message.gamePin, gameId: message.gameId, nickname: message.nickname };
                            this.handleJoin(socket, joinPayload);
                            break;
                        case GameSocketHandler.Events.ANSWER:
                            this.handleAnswer(socket, message.payload);
                            break;
                        case GameSocketHandler.Events.START_QUESTIONS:
                            // START_QUESTIONS has gameId and questionDurationMs at top level
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
                    console.error('Message parsing error:', errorMessage, 'Data:', data.toString());
                    socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: `Invalid message format: ${errorMessage}` } }));
                }
            });

            socket.on('close', () => this.handleDisconnect(socket));
        });
    }


    private async handleJoin(socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string }, payload: any) {
        try {
            const { nickname: rawNickname } = payload;
            const nickname = rawNickname.toUpperCase().trim(); 

            // Support both gamePin and gameId
            let gamePin = payload.gamePin;
            let gameId = payload.gameId;

            // If only gameId provided, look up gamePin from database
            if (!gamePin && gameId && this.gameRepository) {
                const game = await this.gameRepository.getGameById(gameId);
                if (!game) {
                    socket.send(JSON.stringify({ 
                        type: GameSocketHandler.Events.ERROR, 
                        payload: { message: 'Game not found' } 
                    }));
                    return;
                }
                gamePin = game.gamePin;
            }

            // If only gamePin provided, look up gameId from database
            if (gamePin && !gameId && this.gameRepository) {
                const game = await this.gameRepository.getGameByPIN(gamePin);
                if (!game) {
                    socket.send(JSON.stringify({ 
                        type: GameSocketHandler.Events.ERROR, 
                        payload: { message: 'Game not found' } 
                    }));
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

            // Remove from old room if socket was previously in a different game
            if (socket.gamePin && socket.gamePin !== gamePin) {
                const oldRoom = this.rooms.get(socket.gamePin);
                if (oldRoom) {
                    oldRoom.delete(socket);
                }
            }

            socket.gamePin = gamePin;
            socket.gameId = gameId;
            socket.nickname = nickname;

            if (!this.rooms.has(gamePin)) {
                this.rooms.set(gamePin, new Set());
            }
            this.rooms.get(gamePin)!.add(socket);

            // Confirm join to the player
            socket.send(JSON.stringify({
                type: GameSocketHandler.Events.PLAYER_JOIN,
                payload: { success: true, nickname, gamePin, gameId }
            }));

            // Let everyone else in the room know
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.PLAYER_JOINED, { nickname }, socket);

            console.log(`${nickname} joined room ${gamePin} (gameId: ${gameId}), room now has ${this.rooms.get(gamePin)!.size} clients`);
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

    /**
     * Automatically start questions for a game with duration calculated from expiry time
     */
    private async autoStartQuestions(gameId: number, gamePin: string) {
        try {
            // Fetch game to get expires_at
            const game = await this.gameRepository.getGameById(gameId);
            if (!game) {
                console.error(`[autoStartQuestions] Game ${gameId} not found`);
                return;
            }

            // Fetch questions from Redis to count them
            const hashKey = `quiz:${gameId}:questions`;
            let rawQuestions = await this.redisClient.hgetall(hashKey);
            
            // If no questions found, try again after a short delay (in case initializeGame is still running)
            if (!rawQuestions || Object.keys(rawQuestions).length === 0) {
                console.warn(`[autoStartQuestions] No questions found for game ${gameId}. Retrying in 2 seconds...`);
                await this.sleep(2000);
                rawQuestions = await this.redisClient.hgetall(hashKey);
            }

            if (!rawQuestions || Object.keys(rawQuestions).length === 0) {
                console.error(`[autoStartQuestions] Still no questions found for game ${gameId}. Make sure initializeGame() was called.`);
                this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                    message: `Questions not initialized for game ${gameId}. Contact the host.`
                });
                return;
            }

            const questionCount = Object.keys(rawQuestions).length;
            const questionDurationMs = 10000; // 10 seconds per question

            console.log(`[autoStartQuestions] Starting game ${gameId} with ${questionCount} questions, ${questionDurationMs}ms per question`);

            // Run the question loop
            await this.runQuestionLoop(gameId, gamePin, questionDurationMs);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[autoStartQuestions] Error for game ${gameId}:`, errorMsg);
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                message: `Error starting questions: ${errorMsg}`
            });
        }
    }

    /**
     * Core question loop logic - runs questions and broadcasts them
     */
    private async runQuestionLoop(gameId: number, gamePin: string, questionDurationMs: number) {
        try {
            const hashKey = `quiz:${gameId}:questions`;

            // Fetch all question fields (IDs) from the Redis hash
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
                try {
                    const question: Question = JSON.parse(rawQuestions[questionId]);

                    const windowStart = Date.now();
                    const windowEnd = windowStart + questionDurationMs;

                    // Strip correct answer before broadcasting to players, but keep answers array
                    const { correct_answer, ...safeQuestion } = question;

                    // Store windowStart in Redis so handleAnswer can validate timing
                    await this.redisClient.set(
                        `current_question_start:${gameId}`,
                        String(windowStart)
                    );

                    console.log(`[runQuestionLoop] Broadcasting question ${questionId} to room ${gamePin} (remaining: ${remaining})`);
                    this.broadcastToRoom(gamePin, GameSocketHandler.Events.QUESTION, {
                        question: safeQuestion,
                        windowStart,
                        windowEnd,
                        remaining
                    });

                    remaining--;

                    // Wait for the question window to close before moving on
                    console.log(`[runQuestionLoop] Waiting ${questionDurationMs}ms for answers...`);
                    await this.sleep(questionDurationMs);

                    // Broadcast leaderboard snapshot after each question
                    const leaderboard = await this.getLeaderboard(gamePin);
                    this.broadcastToRoom(gamePin, GameSocketHandler.Events.LEADERBOARD, { leaderboard });
                } catch (questionErr) {
                    const msg = questionErr instanceof Error ? questionErr.message : String(questionErr);
                    console.error(`[runQuestionLoop] Error processing question ${questionId}:`, msg);
                }
            }

            // All questions done — end the game
            console.log(`[runQuestionLoop] All questions completed for game ${gameId}`);
            const finalLeaderboard = await this.getLeaderboard(gamePin);
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.GAME_OVER, { leaderboard: finalLeaderboard });

            // Clean up Redis game state
            await this.redisClient.del(`game:state:${gamePin}`);
            await this.redisClient.del(`game:players:${gamePin}`);
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`[runQuestionLoop] Fatal error for game ${gameId}:`, errorMsg, err);
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.ERROR, {
                message: `Fatal error in question loop: ${errorMsg}`
            });
        }
    }


    private async handleAnswer(
        socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string },
        payload: ParticipantAnswer
    ) {
        const { question_id, answer, windowStart, windowEnd } = payload;
        const gamePin = socket.gamePin;
        const gameId = socket.gameId;
        const nickname = socket.nickname;

        if (!gamePin || !nickname || !gameId) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Not properly joined to a game.' } }));
            return;
        }

        // 1. Fetch question from Redis (still has correct_answer)
        const hashKey = `quiz:${gameId}:questions`;
        const raw = await this.redisClient.hget(hashKey, String(question_id));
        if (!raw) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Question not found.' } }));
            return;
        }

        const question: Question = JSON.parse(raw);

        // 2. Check correctness
        const isCorrect = answer.trim().toLowerCase() === question.correct_answer.trim().toLowerCase();

        // 3. Compute score using a log-decay time-based formula
        //    n = seconds taken to answer, rewarding speed
        //    score = (log10(n) + 1) / n — lower n = higher score
        //    We add a small tiebreaker from the window duration
        const now = Date.now();
        const timeTakenSeconds = Math.max((now - windowStart) / 1000, 0.001); // avoid log(0)
        const windowDuration = (windowEnd - windowStart) / 1000;

        let score = 0;
        if (isCorrect) {
            const logDecay = (Math.log10(timeTakenSeconds) + 1) / timeTakenSeconds;
            const tiebreaker = windowDuration - timeTakenSeconds;
            score = Math.max(logDecay + tiebreaker, 0);
            score = Math.round(score * 100) / 100; // 2 d.p.
        }

        // 4. Update leaderboard in Redis (ZINCRBY adds to existing score)
        const leaderboardKey = `game:leaderboard:${gamePin}`;
        if (isCorrect) {
            await this.redisClient.zincrby(leaderboardKey, score, nickname);
        }

        // 5. Send result back to the answering player only
        const newTotalRaw = await this.redisClient.zscore(leaderboardKey, nickname);
        const newTotal = newTotalRaw ? parseFloat(newTotalRaw) : 0;

        socket.send(JSON.stringify({
            type: GameSocketHandler.Events.ANSWER_RESULT,
            payload: {
                isCorrect,
                score,
                totalScore: newTotal,
                correctAnswer: isCorrect ? undefined : question.correct_answer // reveal on wrong answer
            }
        }));

        console.log(`Answer from ${nickname} in room ${gamePin}: ${isCorrect ? 'correct' : 'wrong'} (+${score})`);
    }


    private async getLeaderboard(gamePin: string): Promise<{ nickname: string; score: number }[]> {
        const leaderboardKey = `game:leaderboard:${gamePin}`;

        const raw = await this.redisClient.zrevrange(leaderboardKey, 0, -1, 'WITHSCORES');

        const leaderboard: { nickname: string; score: number }[] = [];
        for (let i = 0; i < raw.length; i += 2) {
            leaderboard.push({
                nickname: raw[i],
                score: parseFloat(raw[i + 1])
            });
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
        console.log(`[broadcastToRoom] Sent ${event} to ${sentCount}/${clients.size} open clients in room ${gamePin}`);
    }

    private handleDisconnect(socket: WebSocket & { gamePin?: string; gameId?: number; nickname?: string }) {
        if (socket.gamePin && this.rooms.has(socket.gamePin)) {
            this.rooms.get(socket.gamePin)!.delete(socket);
            if (socket.nickname) {
                this.broadcastToRoom(socket.gamePin, GameSocketHandler.Events.PLAYER_LEFT, {
                    nickname: socket.nickname
                });
            }
        }
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