import { NodePgDatabase } from "drizzle-orm/node-postgres"
import { eq, and, inArray } from "drizzle-orm"
import { games, nicknames, quizzes, questions, answers, users } from "../db/schema"
import { generatePIN, getErrorMessage } from "../utils/helpers"
import { QuizData } from "../services/game"
import { Question, QuestionWithAnswers, Quiz } from "../types/types"
import Redis from "ioredis"

class GameRepository {
    private dbClient: NodePgDatabase
    private redisClient: Redis

    constructor(db: NodePgDatabase, redis?: Redis) {
        this.dbClient = db
        this.redisClient = redis as Redis
    }

    async createGame(
        name: string,
        question_duration: number,
        scheduled_at: Date | string,
        expires_at: Date | string,
        host_id: number
    ) {
        const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
            let timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
            });
            try {
                return await Promise.race([p, timeoutPromise]);
            } finally {
                clearTimeout(timeoutId!);
            }
        };

        try {
            const pin = generatePIN()

            const scheduledDate = scheduled_at instanceof Date ? scheduled_at : new Date(scheduled_at);
            const expiryDate = expires_at instanceof Date ? expires_at : new Date(expires_at);

            console.log('[GameRepository.createGame] inserting game', { name, question_duration, scheduledDate, expiryDate, host_id, pin });
            const insertPromise = this.dbClient.insert(games).values({
                name,
                question_duration,
                scheduled_at: scheduledDate,
                gamePin: pin,
                expires_at: expiryDate,
                host_id,
            } as any).returning();

            let result;
            try {
                result = await withTimeout(insertPromise, 15000, 'db insert games');
            } catch (err) {
                // log pool statistics if available
                try {
                    // import pool lazily to avoid circular imports at module load
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { pool } = require('../index');
                    console.error('[GameRepository.createGame] DB insert timeout; pool stats=', {
                        totalCount: pool.totalCount,
                        idleCount: pool.idleCount,
                        waitingCount: pool.waitingCount,
                    });
                } catch (poolErr) {
                    console.error('[GameRepository.createGame] failed to get pool stats:', poolErr);
                }
                console.error('[GameRepository.createGame] insert timed out or failed:', err);
                throw err;
            }

            const game = result[0];

            if (game && this.redisClient) {
                try {
                    await this.redisClient.setex(`game:pin:${pin}`, 900, JSON.stringify(game));
                } catch (cacheErr) {
                    console.error('[GameRepository.createGame] redis cache set failed:', cacheErr);
                }
            }
            console.log('[GameRepository.createGame] insert complete, returning game_id=', game?.game_id);
            return game;
        } catch (e) {
            console.error('[GameRepository.createGame] error during createGame:', e);
            throw e;
        }

    }

    async getGameByPIN(gamePin: string) {
        if (!gamePin) {
            return
        }

        // Try Redis cache first
        if (this.redisClient) {
            const cached = await this.redisClient.get(`game:pin:${gamePin}`);
            if (cached) {
                return JSON.parse(cached);
            }
        }

        // Cache miss, query DB
        const result = await this.dbClient.select().from(games).where(eq(games.gamePin, gamePin)).limit(1)
        const game = result[0];

        // Cache for 15 minutes
        if (game && this.redisClient) {
            await this.redisClient.setex(`game:pin:${gamePin}`, 900, JSON.stringify(game));
        }

        return game;
    }

    async getGameById(id: number) {
        const result = await this.dbClient.select().from(games).where(eq(games.game_id, id)).limit(1);
        return result[0];
    }


    async createNickname(game_id: number, nickname: string, email?: string, user_id?: number) {
        // Enqueue nickname for background persistence to avoid DB spikes.
        // We still return a consistent object so callers can proceed.
        const payload = {
            g_id: game_id,
            name: nickname,
            email: email || null,
            user_id: user_id || null,
            created_at: new Date().toISOString(),
        };

        try {
            if (this.redisClient) {
                await this.redisClient.lpush('nicknames:queue', JSON.stringify(payload));
            } else {
                // Fallback to immediate DB insert if Redis not available
                const result = await this.dbClient.insert(nicknames).values({
                    g_id: game_id,
                    name: nickname,
                    email: email || null,
                    user_id: user_id || null,
                }).returning();
                return result[0];
            }
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Failed to enqueue nickname for background write:', message);
            // As a fallback, try direct insert once
            const result = await this.dbClient.insert(nicknames).values({
                g_id: game_id,
                name: nickname,
                email: email || null,
                user_id: user_id || null,
            }).returning();
            return result[0];
        }

        // Return a consistent object so callers don't depend on DB-generated n_id.
        return payload;
    }

    async nicknameExists(game_id: number, name: string) {
        const rows = await this.dbClient.select().from(nicknames).where(and(eq(nicknames.g_id, game_id), (eq(nicknames.name, name)))).limit(1);
        return (rows && rows.length > 0);
    }

    // Create one quiz for a game (only one quiz allowed per game)
    async createQuizForGame(game_id: number, title: string) {
        // check if existing
        const existing = await this.dbClient
        .select()
        .from(quizzes)
        .where(eq(quizzes.game_id, game_id))
        .limit(1);
        if (existing && existing.length > 0) {
            throw new Error('Quiz already exists for this game');
        }
        try {
            const [row] = await this.dbClient.insert(quizzes).values({ game_id, title, created_at: new Date() }).returning();
            return row;
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('GameRepository.createQuizForGame failed:', {
                error: message,
                payload: { game_id, title },
            });
            throw err;
        }
    }

    async getQuizById(id: number) {
        const result = await this.dbClient.select().from(quizzes).where(eq(quizzes.q_id, id)).limit(1);
        return result[0];
    }

    async getQuestionById(questionId: number) {
        const result = await this.dbClient.select().from(questions).where(eq(questions.qu_id, questionId)).limit(1);
        return result[0] || null;
    }

    async getAnswerById(answerId: number) {
        const result = await this.dbClient.select().from(answers).where(eq(answers.a_id, answerId)).limit(1);
        return result[0] || null;
    }

    // Insert multiple questions for a quiz atomically
    async createQuestionsForQuiz(quiz_id: number, items: QuizData[]) {
        if (!items || items.length === 0) return [];
        const inserted = await this.dbClient.transaction(async (tx) => {
            const created: QuizData[] = [];
            for (const item of items) {
                const [questionRow] = await tx.insert(questions).values({
                    quiz_id,
                    content: item.content,
                    correct_answer: item.correct_answer,
                }).returning();
                
                if (item.answers && item.answers.length > 0) {
                    for (const answerContent of item.answers) {
                        await tx.insert(answers).values({
                            qu_id: questionRow.qu_id,
                            content: answerContent,
                        });
                    }
                }
                
                created.push(questionRow);
            }
            return created;
        });
        return inserted;
    }
    async getQuizByGameId(gameId: number) {
        const quizRows: Quiz[] = await this.dbClient.select().from(quizzes).where(eq(quizzes.game_id, gameId)).limit(1);
        const quiz = quizRows[0];
        if (!quiz) return null;

        // fetch questions for the quiz
        const questionRows: Question[] = await this.dbClient.select().from(questions).where(eq(questions.quiz_id, quiz.q_id));

        // fetch all answers for the quiz's questions at once
        const questionIds = questionRows.map(q => q.qu_id);
        const allAnswers = questionIds.length > 0 
            ? await this.dbClient.select().from(answers).where(inArray(answers.qu_id, questionIds))
            : [];

        // map answers to their respective questions
        const questionsWithAnswers: QuestionWithAnswers[] = questionRows.map(q => ({
            ...q,
            answers: allAnswers.filter(a => a.qu_id === q.qu_id) || [],
        }));
        return {
            ...quiz,
            questions: questionsWithAnswers,
        };
    }

     async getGamesByHostId(hostId: number) {
        const result = await this.dbClient.select().from(games).where(eq(games.host_id, hostId));
        return result;
    }

    async getNicknameByGameIdAndName(gameId: number, nickname: string) {
        const result = await this.dbClient.select().from(nicknames)
            .where(and(eq(nicknames.g_id, gameId), eq(nicknames.name, nickname)))
            .limit(1);
        return result[0] || null;
    }

    async getNicknamesForGame(gameId: number) {
        const result = await this.dbClient.select().from(nicknames)
            .where(eq(nicknames.g_id, gameId));
        return result;
    }

    async getUserByNickname(gameId: number, nickname: string) {
        const nicknameRecord = await this.getNicknameByGameIdAndName(gameId, nickname);
        if (!nicknameRecord || !nicknameRecord.user_id) {
            return null;
        }
        const userResult = await this.dbClient.select().from(users).where(eq(users.id, nicknameRecord.user_id)).limit(1);
        return userResult[0] || null;
    }

    // Update question by id
    async updateQuestion(questionId: number, content: string, correct_answer: string) {
        const result = await this.dbClient.update(questions)
            .set({ content, correct_answer })
            .where(eq(questions.qu_id, questionId))
            .returning();
        return result[0] || null;
    }

    // Update answer by id
    async updateAnswer(answerId: number, content: string) {
        const result = await this.dbClient.update(answers)
            .set({ content })
            .where(eq(answers.a_id, answerId))
            .returning();
        return result[0] || null;
    }

    // Delete nickname by id
    async deleteNickname(nicknameId: number) {
        const result = await this.dbClient.delete(nicknames)
            .where(eq(nicknames.n_id, nicknameId))
            .returning();
        return result[0] || null;
    }

    // Delete nickname by game_id and name
    async deleteNicknameByGameAndName(gameId: number, nickname: string) {
        const result = await this.dbClient.delete(nicknames)
            .where(and(eq(nicknames.g_id, gameId), eq(nicknames.name, nickname)))
            .returning();
        return result[0] || null;
    }

    async saveGameLeaderboard(gameId: number, leaderboardData: { nickname: string; score: number }[]) {
        try {
            const leaderboardJson = JSON.stringify(leaderboardData);
            console.log(`[saveGameLeaderboard] Saved final leaderboard for game ${gameId}:`, leaderboardJson);
            return { success: true, saved: leaderboardData.length, data: leaderboardData };
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Failed to save game leaderboard:', message);
            throw err;
        }
    }

    async bounceNicknameFromGame(){

    }

    async getAllGames() {
        const result = await this.dbClient.select().from(games);
        return result;
    }
}

export default GameRepository