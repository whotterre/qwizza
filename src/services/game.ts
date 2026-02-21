
import GameRepository from "../repositories/game";
import { InferModel } from "drizzle-orm";
import { users } from "../db/schema";
import {generateUsername} from "../utils/helper"
import UserRepository from "../repositories/user";

export type User = InferModel<typeof users>;


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
        const game = await this.gameRepo.createGame(
            name,
            question_duration,
            scheduled_at,
            expires_at,
            creator.id
        );
        return game;
    }

    
    // Add player to game
    async addPlayer(gamePin: string, email: string){
        // get game by id
        const game = await this.gameRepo.getGameByPIN(gamePin);
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

}

export default GameService