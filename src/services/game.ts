
import GameRepository from "../repositories/game";
import { InferModel } from "drizzle-orm";
import { users } from "../db/schema";
import {generateUsername} from "../utils/helpers"
import UserRepository from "../repositories/user";

export type User = InferModel<typeof users>;
export type QuizData = { content: string; correct_answer: string }

class GameService {
    private userRepo: UserRepository
    private gameRepo: GameRepository

    constructor(userRepository: UserRepository, gameRepository: GameRepository){
        this.userRepo = userRepository
        this.gameRepo = gameRepository
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
        // Calculate expiry time: add question_duration (in minutes) to scheduled_at
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
    async addPlayer(gamePin: string, email: string){
        // get game by id
        const game = await this.gameRepo.getGameByPIN(gamePin);
        console.log(game)
        if (!game) {
            throw new Error('Game not found');
        }

        // generate unique username
        let playerNickname = generateUsername();
        let attempts = 0;
        while (await this.gameRepo.nicknameExists(game.game_id, playerNickname)) {
            playerNickname = generateUsername();
            attempts++;
            if (attempts > 10) break;
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
        } catch (err: any) {
            console.error('GameService.addQuizToGame error:', err);
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
    
}

export default GameService