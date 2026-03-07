import GameRepository from "../repositories/game";
import { InferModel } from "drizzle-orm";
import { users } from "../db/schema";
import { generateUsername, getErrorMessage, MAX_NICKNAME_GENERATION_ATTEMPTS } from "../utils/helpers"
import UserRepository from "../repositories/user";
import Redis from "ioredis";
import { Question } from "../types/types";

export type User = InferModel<typeof users>;
export type QuizData = { content: string; correct_answer: string }

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


    // Add player to game
    async addPlayer(gamePin: string, email: string) {
        // get game by id
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

        // create nickname record
        const newNickname = await this.gameRepo.createNickname(game.game_id, playerNickname);

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

    async addQuestionsToQuiz(creator: User, quizId: number, items: { content: string; correct_answer: string }[]) {
        if (!items || items.length === 0) throw new Error('No questions provided');

        const quiz = await this.gameRepo.getQuizById(quizId);
        if (!quiz) throw new Error('Quiz not found');

        const game = await this.gameRepo.getGameById(quiz.game_id);
        if (!game) throw new Error('Game not found');
        if (game.host_id !== creator.id) throw new Error('Only the host can add questions');

        for (const it of items) {
            if (!it.content || !it.correct_answer) throw new Error('Invalid question item');
        }

        const created = await this.gameRepo.createQuestionsForQuiz(quizId, items);
        return created;
    }

    // Fetches quiz details and inserts them in a Redis hash
    async initializeGame(gamePin: string, user: User) {
        const game = await this.gameRepo.getGameByPIN(gamePin)
        if (!game) throw new Error('Game not found')

        // Ensure it's the host that's performing this action
        const initiator = await this.userRepo.getUserById(user.id)
        if (!initiator || user.role != 'host') {
            throw new Error("Only the host can perform this action.")
        }

        const quiz = await this.gameRepo.getQuizByGameId(game.game_id)
        if (!quiz) throw new Error('Quiz not found for game')

        const hashKey = `quiz:${game.game_id}:questions`
        const payload: Record<string, string> = {}
        const questions = (quiz.questions || []) as Question[]
        for (const question of questions) {
            payload[String(question.qu_id)] = JSON.stringify(question)
        }

        if (Object.keys(payload).length > 0) {
            try {
                await this.redisClient.hset(hashKey, payload)
            } catch (err) {
                const message = getErrorMessage(err);
                console.error('Redis hset failed:', message);
                throw new Error('Failed to initialize game cache');
            }
        }

        // Set game:state:<gamePin> in Redis with expiry
        const stateKey = `game:state:${gamePin}`;
        const now = Date.now();
        const expiresAt = new Date(game.expires_at).getTime();
        let ttlSeconds = Math.floor((expiresAt - now) / 1000);
        if (ttlSeconds <= 0) ttlSeconds = 3600;
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

        // Remove correct answer before sending to clients
        if (question && typeof question === "object" && "correct_answer" in question) {
            delete (question as Partial<Question>).correct_answer;
        }

        const startedAt = Date.now()

        try {
            await this.redisClient.set(`current_question_start:${gameId}`, String(startedAt))
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis set question start failed:', message);
            throw new Error('Failed to record question start time');
        }

        return { question, startedAt }
    }

    async joinGame(gamePin: number, nickname: string) {
        const game = await this.gameRepo.getGameByPIN(String(gamePin));
        if (!game) {
            throw new Error("No active game exists with this game PIN")
        }

        // check the game hasn't expired
        const expiryTime = new Date(game.expires_at).getTime()
        const currentTime = Date.now()
        if (currentTime >= expiryTime) {
            throw new Error("Game has expired.")
        }

        // check the user's nickname
        const userExists = await this.gameRepo.nicknameExists(game.game_id, nickname)
        if (!userExists) {
            throw new Error("This nickname doesn't exist for this game.")
        }

        // add user to lobby - with a score of zero
        const playersKey = `game:players:${gamePin}`
        const leaderboardKey = `game:leaderboard:${gamePin}`
        const stateKey = `game:state:${gamePin}`
        
        // check if a game is actually live
        let stateExists: number;
        try {
            stateExists = await this.redisClient.exists(stateKey)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis exists check failed:', message);
            throw new Error('Failed to verify game state');
        }
        
        if (!stateExists) throw new Error("Game doesn't exist or has expired")

        // join game 
        let isNew: number;
        try {
            isNew = await this.redisClient.sadd(playersKey, nickname)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis sadd failed:', message);
            throw new Error('Failed to add player to game');
        }
        
        if (isNew === 0) throw new Error("Nickname taken")

        // initialize in leaderboard zset with 0 points
        try {
            await this.redisClient.zadd(leaderboardKey, 0, nickname)
        } catch (err) {
            const message = getErrorMessage(err);
            console.error('Redis zadd failed:', message);
            throw new Error('Failed to initialize leaderboard entry');
        }

        return {
            success: true
        }
    }

}

export default GameService