import GameRepository from "../repositories/game";
import { InferModel } from "drizzle-orm";
import { users } from "../db/schema";
import { generateUsername, getErrorMessage, MAX_NICKNAME_GENERATION_ATTEMPTS } from "../utils/helpers"
import UserRepository from "../repositories/user";
import Redis from "ioredis";
import { Question, QuestionWithAnswers } from "../types/types";

export type User = InferModel<typeof users>;
export type QuizData = { content: string; correct_answer: string; answers?: string[] }

class GameService {
    private userRepo: UserRepository
    private gameRepo: GameRepository
    private redisClient: Redis

    constructor(
        userRepository: UserRepository,
        gameRepository: GameRepository,
        redisInstance: Redis) {
        this.userRepo = userRepository
        this.gameRepo = gameRepository
        this.redisClient = redisInstance
    }

    async createGame(
        creator: User,
        name: string,
        question_duration: number,
        scheduled_at: Date
    ) {
        if (creator.role !== 'host') {
            throw new Error("Only hosts can create games");
        }

        if (scheduled_at.getTime() < Date.now()) {
            throw new Error("Scheduled time is in the past");
        }

        const expires_at = new Date(scheduled_at.getTime() + (question_duration * 60 * 1000));

        const result = await this.gameRepo.createGame(
            name,
            question_duration,
            scheduled_at,
            expires_at,
            creator.id
        );
        return result;
    }

    async addPlayer(gamePin: string, email?: string) {
        const game = await this.gameRepo.getGameByPIN(gamePin);
        if (!game) {
            throw new Error('Game not found');
        }

        let playerNickname = generateUsername();
        let attempts = 0;
        while (await this.gameRepo.nicknameExists(game.game_id, playerNickname)) {
            playerNickname = generateUsername();
            attempts++;
            if (attempts >= MAX_NICKNAME_GENERATION_ATTEMPTS) throw new Error('Could not generate unique nickname');
        }

        let userId: number | undefined;
        if (email) {
            const user = await this.userRepo.getUserByEmail(email);
            userId = user?.id;
        }

        const newNickname = await this.gameRepo.createNickname(game.game_id, playerNickname, email, userId);
        return { nickname: newNickname };
    }

    async addQuizToGame(creator: User, gameId: number, title: string) {
        try {
            const game = await this.gameRepo.getGameById(gameId);
            if (!game) throw new Error('Game not found');
            if (game.host_id !== creator.id) throw new Error('Only the host can add a quiz');
            const quiz = await this.gameRepo.createQuizForGame(gameId, title!);
            return quiz;
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('GameService.addQuizToGame error:', message);
            throw err;
        }
    }

    async addQuestionsToQuiz(creator: User, quizId: number, items: QuizData[]) {
        if (!items || items.length === 0) throw new Error('No questions provided');

        const quiz = await this.gameRepo.getQuizById(quizId);
        if (!quiz) throw new Error('Quiz not found');

        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can add questions');

        for (const it of items) {
            if (!it.content || !it.correct_answer) throw new Error('Invalid question item');

            const normalizedAnswers = (it.answers ?? []).map((answer) => answer?.trim()).filter((answer): answer is string => Boolean(answer));
            if (normalizedAnswers.length < 2) {
                throw new Error('Each question must include at least 2 non-empty answer options');
            }

            const normalizedCorrectAnswer = it.correct_answer.trim().toLowerCase();
            const normalizedAnswerLookup = new Set(normalizedAnswers.map((answer) => answer.toLowerCase()));
            if (!normalizedAnswerLookup.has(normalizedCorrectAnswer)) {
                throw new Error(`correct_answer "${it.correct_answer}" must be one of the provided answers`);
            }

            it.content = it.content.trim();
            it.correct_answer = it.correct_answer.trim();
            it.answers = normalizedAnswers;
        }

        const created = await this.gameRepo.createQuestionsForQuiz(quizId, items);
        await this.redisClient.del(`quiz:${quiz.game_id}:questions`);
        return created;
    }

    async deleteQuiz(creator: User, quizId: number) {
        const quiz = await this.gameRepo.getQuizById(quizId);
        if (!quiz) throw new Error('Quiz not found');

        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can delete this quiz');

        const stateKey = `game:state:${game.gamePin}`;
        const startedByPinKey = `game:started:${game.gamePin}`;
        const startedByIdKey = `game:started:${game.game_id}`;

        const [isLive, startedByPin, startedById] = await Promise.all([
            this.redisClient.exists(stateKey),
            this.redisClient.exists(startedByPinKey),
            this.redisClient.exists(startedByIdKey),
        ]);

        if (isLive || startedByPin || startedById) {
            throw new Error('Quiz cannot be deleted after the game has started');
        }

        const deleted = await this.gameRepo.deleteQuizWithContent(quizId);
        if (!deleted) {
            throw new Error('Quiz not found');
        }

        await Promise.allSettled([
            this.redisClient.del(`quiz:${game.game_id}:questions`),
            this.redisClient.del(`game:current_question:${game.game_id}`),
            this.redisClient.del(`game:window:${game.game_id}:start`),
            this.redisClient.del(`game:window:${game.game_id}:end`),
        ]);

        return deleted;
    }

    async initializeGame(gamePin: string, user: User) {
        const game = await this.gameRepo.getGameByPIN(gamePin)
        if (!game) throw new Error('Game not found')

        const initiator = await this.userRepo.getUserById(user.id)
        if (!initiator || initiator.role !== 'host') {
            throw new Error("Only the host can perform this action.")
        }

        const stateKey = `game:state:${gamePin}`;
        const alreadyLive = await this.redisClient.exists(stateKey);
        if (alreadyLive) throw new Error('Game is already initialized and live');

        const quiz = await this.gameRepo.getQuizByGameId(game.game_id)
        if (!quiz) throw new Error('Quiz not found for game')

        const hashKey = `quiz:${game.game_id}:questions`
        const payload: Record<string, string> = {}
        const questions = (quiz.questions || []) as QuestionWithAnswers[]

        for (const question of questions) {
            const validAnswers = (question.answers || []).filter((a: any) => a && (typeof a === 'string' ? a.trim() : (a.content && String(a.content).trim())));
            const answersToStore = validAnswers.length >= 2 ? validAnswers : [
                { a_id: 1, qu_id: question.qu_id, content: question.correct_answer || "Option A" },
                { a_id: 2, qu_id: question.qu_id, content: "Option B" },
                { a_id: 3, qu_id: question.qu_id, content: "Option C" },
                { a_id: 4, qu_id: question.qu_id, content: "Option D" },
            ];

            const questionWithAnswers = {
                qu_id: question.qu_id,
                quiz_id: question.quiz_id,
                content: question.content,
                correct_answer: question.correct_answer,
                answers: answersToStore
            };
            payload[String(question.qu_id)] = JSON.stringify(questionWithAnswers);
        }

        const now = Date.now();
        const expiresAt = new Date(game.expires_at).getTime();
        let ttlSeconds = Math.floor((expiresAt - now) / 1000);
        if (ttlSeconds <= 0) ttlSeconds = 3600;

        if (Object.keys(payload).length > 0) {
            try {
            await this.redisClient.del(hashKey);
                await this.redisClient.hset(hashKey, payload)
                await this.redisClient.expire(hashKey, ttlSeconds);
            } catch (err) {
                const message = getErrorMessage(err);
                console.error('Redis hset failed:', message);
                throw new Error('Failed to initialize game cache');
            }
        }

        try {
            await this.redisClient.set(stateKey, 'live', 'EX', ttlSeconds);
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis set failed:', message);
            throw new Error('Failed to set game state');
        }

        return { quizId: quiz.q_id, questionsCount: questions.length }
    }

    async startQuestion(gameId: number, questionId: number) {
        if (!gameId || !questionId) throw new Error('gameId and questionId are required')

        const hashKey = `quiz:${gameId}:questions`
        const field = String(questionId)

        let raw: string | null;
        try {
            raw = await this.redisClient.hget(hashKey, field)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis hget failed:', message);
            throw new Error('Failed to retrieve question from cache');
        }

        if (!raw) {
            throw new Error(`Question ${questionId} not found in Redis for game ${gameId}`)
        }

        let question: Question
        try {
            question = JSON.parse(raw)
        } catch (e) {
            throw new Error('Invalid question payload in Redis')
        }

        // FIX: Destructure instead of mutating the parsed object in place
        const { correct_answer, ...safeQuestion } = question as Question & { correct_answer?: string };

        const startedAt = Date.now()

        try {
            await this.redisClient.set(`current_question_start:${gameId}`, String(startedAt))
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis set question start failed:', message);
            throw new Error('Failed to record question start time');
        }

        return { question: safeQuestion, startedAt }
    }

    async joinGame(gamePin: string, nickname: string) {
        const game = await this.gameRepo.getGameByPIN(gamePin);
        if (!game) {
            throw new Error("No active game exists with this game PIN")
        }

        // const expiryTime = new Date(game.expires_at).getTime()
        // if (Date.now() >= expiryTime) {
        //     throw new Error("Game has expired.")
        // }

        const userExists = await this.gameRepo.nicknameExists(game.game_id, nickname)
        if (!userExists) {
            throw new Error("This nickname doesn't exist for this game.")
        }

        const playersKey = `game:players:${gamePin}`
        const leaderboardKey = `game:leaderboard:${gamePin}`

        let isNew: number;
        try {
            isNew = await this.redisClient.sadd(playersKey, nickname)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis sadd failed:', message);
            throw new Error('Failed to add player to game');
        }

        if (isNew === 0) throw new Error("Nickname taken")

        try {
            await this.redisClient.zadd(leaderboardKey, 0, nickname)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis zadd failed:', message);
            throw new Error('Failed to initialize leaderboard entry');
        }

        return { success: true }
    }

    async getUserForReward(gameId: number, nickname: string): Promise<User | null> {
        const user = await this.gameRepo.getUserByNickname(gameId, nickname);
        return user ?? null;
    }

    async getQuizForEditing(creator: User, quizId: number) {
        const quiz = await this.gameRepo.getQuizById(quizId);
        if (!quiz) throw new Error('Quiz not found');
        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can view this quiz');
        const quizWithContent = await this.gameRepo.getQuizByGameId(game.game_id);
        return quizWithContent;
    }

    async updateQuestion(creator: User, questionId: number, content: string, correct_answer: string, answers?: string[]) {
        const question = await this.gameRepo.getQuestionById(questionId);
        if (!question) throw new Error('Question not found');

        // Verify the quiz and game belong to the creator
        const quiz = await this.gameRepo.getQuizById(question.quiz_id);
        if (!quiz) throw new Error('Quiz not found');

        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can update questions');

        const updated = await this.gameRepo.updateQuestion(questionId, content, correct_answer, answers);
        await this.redisClient.del(`quiz:${quiz.game_id}:questions`);
        return updated;
    }

    async updateAnswer(creator: User, answerId: number, content: string) {
        const answer = await this.gameRepo.getAnswerById(answerId);
        if (!answer) throw new Error('Answer not found');
        const question = await this.gameRepo.getQuestionById(answer.qu_id);
        if (!question) throw new Error('Question not found');

        // Verify the quiz and game belong to the creator
        const quiz = await this.gameRepo.getQuizById(question.quiz_id);
        if (!quiz) throw new Error('Quiz not found');

        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can update answers');

        const updated = await this.gameRepo.updateAnswer(answerId, content);
        await this.redisClient.del(`quiz:${quiz.game_id}:questions`);
        return updated;
    }

    async deleteNickname(creator: User, gameId: number, nicknameId: number) {
        const game = await this.gameRepo.getGameById(gameId);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can delete nicknames');
        const deleted = await this.gameRepo.deleteNickname(nicknameId);
        return deleted;
    }

    async startGame(creator: User, gamePin: string) {
        const game = await this.gameRepo.getGameByPIN(gamePin);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can start the game');
        const stateKey = `game:state:${gamePin}`;
        const alreadyLive = await this.redisClient.exists(stateKey);
        if (!alreadyLive) {
            throw new Error('Game must be initialized before starting');
        }

        const startedKey = `game:started:${gamePin}`;
        await this.redisClient.set(startedKey, 'true');
        return { success: true, message: 'Game started' };
    }

    async rescheduleGame(
        creator: User,
        gameId: number,
        scheduledAt: Date,
        questionDuration?: number
    ) {
        if (creator.role !== 'host') {
            throw new Error('Only the host can reschedule games');
        }

        if (isNaN(scheduledAt.getTime())) {
            throw new Error('Invalid scheduled_at');
        }

        if (scheduledAt.getTime() < Date.now() - 10000) {
            throw new Error('scheduled_at cannot be in the past');
        }

        if (questionDuration !== undefined && questionDuration <= 0) {
            throw new Error('question_duration must be greater than 0');
        }

        const game = await this.gameRepo.getGameById(gameId);
        if (!game) {
            throw new Error('Game not found');
        }
        if (game.host_id !== creator.id) {
            throw new Error('Only the host can reschedule this game');
        }

        const stateKey = `game:state:${game.gamePin}`;
        const currentQKey = `game:current_question:${game.game_id}`;

        const [isLive, hasCurrentQuestion] = await Promise.all([
            this.redisClient.exists(stateKey),
            this.redisClient.exists(currentQKey),
        ]);

        if (isLive || hasCurrentQuestion) {
            throw new Error('Game is currently live in progress and cannot be rescheduled until finished');
        }

        // Clean up previous Redis game state to allow re-initialization on new schedule
        await this.redisClient.del(
            stateKey,
            `game:started:${game.gamePin}`,
            `game:started:${game.game_id}`,
            `game:players:${game.gamePin}`,
            `game:leaderboard:${game.gamePin}`,
            currentQKey,
            `quiz:${game.game_id}:questions`
        );

        const durationToUse = questionDuration ?? game.question_duration;
        const expiresAt = new Date(scheduledAt.getTime() + durationToUse * 60 * 1000);

        const updated = await this.gameRepo.updateGameSchedule(
            game.game_id,
            scheduledAt,
            expiresAt,
            questionDuration
        );

        if (!updated) {
            throw new Error('Game not found');
        }

        return updated;
    }

    async getFinalLeaderboard(gameIdOrPin: number | string) {
        let gameId: number | null = null;
        let gamePin: string | null = null;

        if (typeof gameIdOrPin === 'number' || (typeof gameIdOrPin === 'string' && /^\d+$/.test(gameIdOrPin.trim()))) {
            gameId = Number(gameIdOrPin);
            const g = await this.gameRepo.getGameById(gameId);
            if (g) gamePin = g.gamePin;
        } else if (typeof gameIdOrPin === 'string') {
            gamePin = gameIdOrPin.trim();
            const g = await this.gameRepo.getGameByPIN(gamePin);
            if (g) gameId = g.game_id;
        }

        if (!gameId && !gamePin) return null;

        if (gameId) {
            const leaderboardKey = `final_leaderboard:game:${gameId}`;
            const raw = await this.redisClient.get(leaderboardKey);
            if (raw) {
                try {
                    return JSON.parse(raw);
                } catch (err) {
                    console.error(`Failed to parse leaderboard for game ${gameId}:`, err);
                }
            }
        }

        if (gamePin) {
            const fallbackLeaderboardKey = `game:leaderboard:${gamePin}`;
            const fallbackRaw = await this.redisClient.zrevrange(fallbackLeaderboardKey, 0, -1, 'WITHSCORES');
            if (fallbackRaw && fallbackRaw.length > 0) {
                const fallbackLeaderboard = [] as { nickname: string; score: number }[];
                for (let i = 0; i < fallbackRaw.length; i += 2) {
                    fallbackLeaderboard.push({ nickname: fallbackRaw[i], score: parseFloat(fallbackRaw[i + 1]) });
                }
                return fallbackLeaderboard;
            }
        }

        return null;
    }
}

export default GameService