import { WebSocket, WebSocketServer } from "ws";
import Redis from "ioredis";

type ParticipantAnswer = {
    question_id: number;
    answer: string;      
    windowStart: number;  
    windowEnd: number;     
}

type Question = {
    qu_id: number;
    content: string;
    correct_answer: string;
}

export default class GameSocketHandler {
    private io: WebSocketServer;
    private rooms: Map<string, Set<WebSocket>> = new Map<string, Set<WebSocket>>();
    private redisClient: Redis;

    constructor(io: WebSocketServer, redisClient: Redis) {
        this.io = io;
        this.redisClient = redisClient;
        this.initialize();
    }

    private initialize() {
        this.io.on('connection', (socket: WebSocket & { gamePin?: string; nickname?: string }) => {
            socket.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    switch (message.type) {
                        case GameSocketHandler.Events.PLAYER_JOIN:
                            this.handleJoin(socket, message.payload);
                            break;
                        case GameSocketHandler.Events.ANSWER:
                            this.handleAnswer(socket, message.payload);
                            break;
                        case GameSocketHandler.Events.START_QUESTIONS:
                            this.startQuestionLoop(socket, message.payload);
                            break;
                    }
                } catch (err) {
                    socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Invalid message format' } }));
                }
            });

            socket.on('close', () => this.handleDisconnect(socket));
        });
    }


    private handleJoin(socket: WebSocket & { gamePin?: string; nickname?: string }, payload: { gamePin: string; nickname: string }) {
        const { gamePin, nickname } = payload;

        socket.gamePin = gamePin;
        socket.nickname = nickname;

        if (!this.rooms.has(gamePin)) {
            this.rooms.set(gamePin, new Set());
        }
        this.rooms.get(gamePin)!.add(socket);

        // Confirm join to the player
        socket.send(JSON.stringify({
            type: GameSocketHandler.Events.PLAYER_JOIN,
            payload: { success: true, nickname, gamePin }
        }));

        // Let everyone else in the room know
        this.broadcastToRoom(gamePin, GameSocketHandler.Events.PLAYER_JOINED, { nickname }, socket);

        console.log(`${nickname} joined room ${gamePin}`);
    }

    
    private async startQuestionLoop(
        socket: WebSocket & { gamePin?: string; nickname?: string },
        payload: { gameId: number; questionDurationMs: number }
    ) {
        const { gameId, questionDurationMs } = payload;
        const gamePin = socket.gamePin;
        if (!gamePin) return;

        const hashKey = `quiz:${gameId}:questions`;

        // Fetch all question fields (IDs) from the Redis hash
        const rawQuestions = await this.redisClient.hgetall(hashKey);
        if (!rawQuestions || Object.keys(rawQuestions).length === 0) {
            socket.send(JSON.stringify({
                type: GameSocketHandler.Events.ERROR,
                payload: { message: 'No questions found for this game.' }
            }));
            return;
        }

        const questionIds = Object.keys(rawQuestions);
        let remaining = questionIds.length;

        for (const questionId of questionIds) {
            const question: Question = JSON.parse(rawQuestions[questionId]);

            const windowStart = Date.now();
            const windowEnd = windowStart + questionDurationMs;

            // Strip correct answer before broadcasting to players
            const { correct_answer, ...safeQuestion } = question;

            // Store windowStart in Redis so handleAnswer can validate timing
            await this.redisClient.set(
                `current_question_start:${gameId}`,
                String(windowStart)
            );

            this.broadcastToRoom(gamePin, GameSocketHandler.Events.QUESTION, {
                question: safeQuestion,
                windowStart,
                windowEnd,
                remaining
            });

            remaining--;

            // Wait for the question window to close before moving on
            await this.sleep(questionDurationMs);

            // Broadcast leaderboard snapshot after each question
            const leaderboard = await this.getLeaderboard(gamePin);
            this.broadcastToRoom(gamePin, GameSocketHandler.Events.LEADERBOARD, { leaderboard });
        }

        // All questions done — end the game
        const finalLeaderboard = await this.getLeaderboard(gamePin);
        this.broadcastToRoom(gamePin, GameSocketHandler.Events.GAME_OVER, { leaderboard: finalLeaderboard });

        // Clean up Redis game state
        await this.redisClient.del(`game:state:${gamePin}`);
        await this.redisClient.del(`game:players:${gamePin}`);
    }


    private async handleAnswer(
        socket: WebSocket & { gamePin?: string; nickname?: string },
        payload: ParticipantAnswer
    ) {
        const { question_id, answer, windowStart, windowEnd } = payload;
        const gamePin = socket.gamePin;
        const nickname = socket.nickname;

        if (!gamePin || !nickname) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'Not joined to a game.' } }));
            return;
        }

        const gameId = (payload as any).gameId as number;
        if (!gameId) {
            socket.send(JSON.stringify({ type: GameSocketHandler.Events.ERROR, payload: { message: 'gameId missing from answer payload.' } }));
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
        if (!clients) return;

        const message = JSON.stringify({ type: event, payload });
        clients.forEach(client => {
            if (client !== exclude && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    private handleDisconnect(socket: WebSocket & { gamePin?: string; nickname?: string }) {
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
        QUESTION: 'QUESTION',
        ANSWER: 'ANSWER',
        ANSWER_RESULT: 'ANSWER_RESULT',
        LEADERBOARD: 'LEADERBOARD',
        GAME_OVER: 'GAME_OVER',
        ERROR: 'ERROR',
    } as const;
}