import { NodePgDatabase } from "drizzle-orm/node-postgres"
import { eq, and } from "drizzle-orm"
import { games, nicknames, quizzes, questions, answers } from "../db/schema"
import { generatePIN } from "../utils/helpers"
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


    async createNickname(game_id: number, nickname: string) {
        const result = await this.dbClient.insert(nicknames).values({
            g_id: game_id,
            name: nickname,
        }).returning();
        return result[0];
    }

    async nicknameExists(game_id: number, name: string) {
        const rows = await this.dbClient.select().from(nicknames).where(and(eq(nicknames.g_id, game_id), (eq(nicknames.name, name)))).limit(1);
        return (rows && rows.length > 0);
    }

    // Create one quiz for a game (only one quiz allowed per game)
    async createQuizForGame(game_id: number, title: string) {
        // check existing
        const existing = await this.dbClient.select().from(quizzes).where(eq(quizzes.game_id, game_id)).limit(1);
        if (existing && existing.length > 0) {
            throw new Error('Quiz already exists for this game');
        }
        try {
            console.log(title, game_id)
            const [row] = await this.dbClient.insert(quizzes).values({ game_id, title, created_at: new Date() }).returning();
            return row;
        } catch (err: any) {
            console.error('GameRepository.createQuizForGame failed:', {
                error: err instanceof Error ? err.message : String(err),
                payload: { game_id, title },
                raw: err,
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
            for (const it of items) {
                const [row] = await tx.insert(questions).values({
                    quiz_id,
                    content: it.content,
                    correct_answer: it.correct_answer,
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

        // for each question fetch its answers and attach
        const questionsWithAnswers: QuestionWithAnswers[] = [];
        for (const q of questionRows) {
            const answerRows = await this.dbClient.select().from(answers).where(eq(answers.qu_id, q.qu_id));
            questionsWithAnswers.push({
                ...q,
                answers: answerRows || [],
            });
        }

        return {
            ...quiz,
            questions: questionsWithAnswers,
        };
    }
}

export default GameRepository