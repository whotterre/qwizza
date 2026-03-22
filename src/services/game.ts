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

        // FIX: Reject games scheduled in the past rather than checking expiry
        if (scheduled_at.getTime() < Date.now()) {
            throw new Error("Scheduled time is in the past");
        }

        const expires_at = new Date(scheduled_at.getTime() + question_duration * 60 * 1000);

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

        // FIX: Decouple account linking from player creation — look up userId
        // without exposing whether the email exists (no error thrown on miss)
        let userId: number | undefined;
        if (email) {
            const user = await this.userRepo.getUserByEmail(email);
            // Silently ignore unknown emails to avoid leaking registration status
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

            // FIX: Ensure correct_answer is present in the answers array if provided,
            // so the question is always answerable
            if (it.answers && it.answers.length > 0 && !it.answers.includes(it.correct_answer)) {
                throw new Error(`correct_answer "${it.correct_answer}" must be one of the provided answers`);
            }
        }

        const created = await this.gameRepo.createQuestionsForQuiz(quizId, items);
        return created;
    }

    async initializeGame(gamePin: string, user: User) {
        const game = await this.gameRepo.getGameByPIN(gamePin)
        if (!game) throw new Error('Game not found')

        // FIX: Fetch initiator from DB and check initiator.role, not the caller-supplied user.role
        const initiator = await this.userRepo.getUserById(user.id)
        if (!initiator || initiator.role !== 'host') {
            throw new Error("Only the host can perform this action.")
        }

        // FIX: Prevent re-initialization of a game that is already live
        const stateKey = `game:state:${gamePin}`;
        const alreadyLive = await this.redisClient.exists(stateKey);
        if (alreadyLive) throw new Error('Game is already initialized and live');

        const quiz = await this.gameRepo.getQuizByGameId(game.game_id)
        if (!quiz) throw new Error('Quiz not found for game')

        const hashKey = `quiz:${game.game_id}:questions`
        const payload: Record<string, string> = {}
        const questions = (quiz.questions || []) as QuestionWithAnswers[]

        for (const question of questions) {
            const questionWithAnswers = {
                qu_id: question.qu_id,
                quiz_id: question.quiz_id,
                content: question.content,
                correct_answer: question.correct_answer,
                answers: question.answers || []
            };
            payload[String(question.qu_id)] = JSON.stringify(questionWithAnswers);
        }

        const now = Date.now();
        const expiresAt = new Date(game.expires_at).getTime();
        let ttlSeconds = Math.floor((expiresAt - now) / 1000);
        if (ttlSeconds <= 0) ttlSeconds = 3600;

        if (Object.keys(payload).length > 0) {
            try {
                await this.redisClient.hset(hashKey, payload)

                // FIX: Set TTL on the questions hash to match the game lifetime
                // so correct answers don't persist in Redis indefinitely
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

    // FIX: gamePin typed as string consistently — number pins with leading zeros would break
    async joinGame(gamePin: string, nickname: string) {
        const game = await this.gameRepo.getGameByPIN(gamePin);
        if (!game) {
            throw new Error("No active game exists with this game PIN")
        }

        const expiryTime = new Date(game.expires_at).getTime()
        if (Date.now() >= expiryTime) {
            throw new Error("Game has expired.")
        }

        const userExists = await this.gameRepo.nicknameExists(game.game_id, nickname)
        if (!userExists) {
            throw new Error("This nickname doesn't exist for this game.")
        }

        const playersKey = `game:players:${gamePin}`
        const leaderboardKey = `game:leaderboard:${gamePin}`
        const stateKey = `game:state:${gamePin}`

        let stateExists: number;
        try {
            stateExists = await this.redisClient.exists(stateKey)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis exists check failed:', message);
            throw new Error('Failed to verify game state');
        }

        if (!stateExists) throw new Error("Game doesn't exist or has expired")

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

    async updateQuestion(creator: User, questionId: number, content: string, correct_answer: string) {
        const question = await this.gameRepo.getQuestionById(questionId);
        if (!question) throw new Error('Question not found');

        // Verify the quiz and game belong to the creator
        const quiz = await this.gameRepo.getQuizById(question.quiz_id);
        if (!quiz) throw new Error('Quiz not found');

        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can update questions');

        const updated = await this.gameRepo.updateQuestion(questionId, content, correct_answer);
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

    async getFinalLeaderboard(gameId: number) {
        const leaderboardKey = `final_leaderboard:game:${gameId}`;
        const raw = await this.redisClient.get(leaderboardKey);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.error(`Failed to parse leaderboard for game ${gameId}:`, err);
            return null;
        }
    }
}

export default GameService