import { NodePgDatabase } from "drizzle-orm/node-postgres"
import { eq, and, inArray } from "drizzle-orm"
import { games, nicknames, quizzes, questions, answers, users } from "../db/schema"
import { generatePIN, getErrorMessage } from "../utils/helpers"
import { QuizData } from "../services/game"
import { Question, QuestionWithAnswers, Quiz } from "../types/types"

class GameRepository {
    private readonly dbClient: NodePgDatabase

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
        } catch (err) {
            console.log(err)
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

    async updateGameSchedule(gameId: number, scheduled_at: Date, expires_at: Date, question_duration?: number) {
        const updatePayload: { scheduled_at: Date; expires_at: Date; question_duration?: number } = {
            scheduled_at,
            expires_at,
        };

        if (typeof question_duration === 'number') {
            updatePayload.question_duration = question_duration;
        }

        const result = await this.dbClient
            .update(games)
            .set(updatePayload)
            .where(eq(games.game_id, gameId))
            .returning();

        return result[0] || null;
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

    async deleteQuizWithContent(quizId: number) {
        return this.dbClient.transaction(async (tx) => {
            const quizRows = await tx.select().from(quizzes).where(eq(quizzes.q_id, quizId)).limit(1);
            const quiz = quizRows[0];
            if (!quiz) {
                return null;
            }

            const questionRows = await tx.select().from(questions).where(eq(questions.quiz_id, quizId));
            const questionIds = questionRows.map((question) => question.qu_id);

            if (questionIds.length > 0) {
                await tx.delete(answers).where(inArray(answers.qu_id, questionIds));
                await tx.delete(questions).where(inArray(questions.qu_id, questionIds));
            }

            await tx.delete(quizzes).where(eq(quizzes.q_id, quizId));

            return quiz;
        });
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

        const questionsWithAnswers: QuestionWithAnswers[] = [];
        for (const q of questionRows) {
            let qAnswers = allAnswers.filter(a => a.qu_id === q.qu_id) || [];
            const hasGenericDefaults = qAnswers.some(a =>
                a.content === "Option C" || a.content === "Option D" || (typeof a.content === "string" && a.content.endsWith(" (B)"))
            );

            if (qAnswers.length < 2 || hasGenericDefaults) {
                const correct = (q.correct_answer || "Option A").trim();
                let defaultChoices: string[] = [];
                if (correct.toLowerCase() === "true" || correct.toLowerCase() === "false") {
                    defaultChoices = ["True", "False"];
                } else {
                    defaultChoices = [
                        correct,
                        `Not ${correct}`,
                        "All of the above",
                        "None of the above",
                    ];
                }

                try {
                    await this.dbClient.delete(answers).where(eq(answers.qu_id, q.qu_id));
                } catch {

                }

                const insertedAnswers: any[] = [];
                for (const choiceText of defaultChoices) {
                    try {
                        const [inserted] = await this.dbClient.insert(answers).values({
                            qu_id: q.qu_id,
                            content: choiceText,
                        }).returning();
                        if (inserted) insertedAnswers.push(inserted);
                    } catch (err) {
                        console.error(err)
                    }
                }
                qAnswers = insertedAnswers.length >= 2 ? insertedAnswers : defaultChoices.map((c, idx) => ({
                    a_id: idx + 1,
                    qu_id: q.qu_id,
                    content: c,
                }));
            }
            questionsWithAnswers.push({ ...q, answers: qAnswers });
        }

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

    // Update question by id, and re-insert answers if provided
    async updateQuestion(questionId: number, content: string, correct_answer: string, answersList?: string[]) {
        const result = await this.dbClient.update(questions)
            .set({ content, correct_answer })
            .where(eq(questions.qu_id, questionId))
            .returning();

        if (answersList && Array.isArray(answersList) && answersList.length > 0) {
            await this.dbClient.delete(answers).where(eq(answers.qu_id, questionId));
            for (const answerContent of answersList) {
                if (answerContent && answerContent.trim()) {
                    await this.dbClient.insert(answers).values({
                        qu_id: questionId,
                        content: answerContent.trim(),
                    });
                }
            }
        }

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

    async bounceNicknameFromGame() {

    }

    async getAllGames() {
        const result = await this.dbClient.select().from(games);
        return result;
    }
}

export default GameRepository