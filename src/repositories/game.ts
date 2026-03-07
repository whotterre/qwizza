import { NodePgDatabase } from "drizzle-orm/node-postgres"
import { eq, and, inArray } from "drizzle-orm"
import { games, nicknames, quizzes, questions, answers, users } from "../db/schema"
import { generatePIN, getErrorMessage } from "../utils/helpers"
import { QuizData } from "../services/game"
import { Question, QuestionWithAnswers, Quiz } from "../types/types"

class GameRepository {
    private dbClient: NodePgDatabase

    constructor(db: NodePgDatabase) {
        this.dbClient = db
    }

    async createGame(
        name: string,
        question_duration: number,
        scheduled_at: Date | string,
        expires_at: Date | string,
        host_id: number
    ) {
        try {
            const pin = generatePIN()

            // Ensure we pass JS Date objects (or ISO strings) consistently
            const scheduledDate = scheduled_at instanceof Date ? scheduled_at : new Date(scheduled_at);
            const expiryDate = expires_at instanceof Date ? expires_at : new Date(expires_at);

            const result = await this.dbClient.insert(games).values({
                name,
                question_duration,
                scheduled_at: scheduledDate,
                gamePin: pin,
                expires_at: expiryDate,
                host_id,
            } as any).returning();

            return result[0];
        } catch (e) {
            console.error(e)
        }

    }

    async getGameByPIN(gamePin: string) {
        if (!gamePin) {
            return
        }
        const result = await this.dbClient.select().from(games).where(eq(games.gamePin, gamePin)).limit(1)
        return result[0]
    }

    async getGameById(id: number) {
        const result = await this.dbClient.select().from(games).where(eq(games.game_id, id)).limit(1);
        return result[0];
    }


    async createNickname(game_id: number, nickname: string, email?: string, user_id?: number) {
        const result = await this.dbClient.insert(nicknames).values({
            g_id: game_id,
            name: nickname,
            email: email || null,
            user_id: user_id || null,
        }).returning();
        return result[0];
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
            console.log(title, game_id)
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

    // Insert multiple questions for a quiz atomically
    async createQuestionsForQuiz(quiz_id: number, items: QuizData[]) {
        if (!items || items.length === 0) return [];
        const inserted = await this.dbClient.transaction(async (tx) => {
            const created: QuizData[] = [];
            for (const item of items) {
                const [row] = await tx.insert(questions).values({
                    quiz_id,
                    content: item.content,
                    correct_answer: item.correct_answer,
                }).returning();
                created.push(row);
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

    async getUserByNickname(gameId: number, nickname: string) {
        const nicknameRecord = await this.getNicknameByGameIdAndName(gameId, nickname);
        if (!nicknameRecord || !nicknameRecord.user_id) {
            return null;
        }
        const userResult = await this.dbClient.select().from(users).where(eq(users.id, nicknameRecord.user_id)).limit(1);
        return userResult[0] || null;
    }
}

export default GameRepository