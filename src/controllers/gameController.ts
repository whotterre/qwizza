
import { Request, Response } from 'express';
import GameRepository from "../repositories/game";
import UserRepository from "../repositories/user";
import redis from '../utils/redis'
import db from '../index';
import GameService from '../services/game';
import { getErrorMessage } from '../utils/helpers';

const gameRepo = new GameRepository(db);
const userRepo = new UserRepository(db);
const gameService = new GameService(userRepo, gameRepo, redis);

export const createGameController = async (req: Request, res: Response) => {
    try {
        const creator = (req as any).user;
        const { name, question_duration, scheduled_at } = req.body;
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        if (!name || !question_duration || !scheduled_at) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (Number(question_duration) <= 0) {
            return res.status(400).json({ error: 'Question duration must be greater than 0' });
        }
        const scheduledAtDate = new Date(scheduled_at);
        if (isNaN(scheduledAtDate.getTime())) return res.status(400).json({ error: 'Invalid scheduled_at' });
        if (scheduledAtDate.getTime() < Date.now()) {
            return res.status(400).json({ error: 'scheduled_at cannot be in the past' });
        }

        const game = await gameService.createGame(creator, name, Number(question_duration), scheduledAtDate);
        return res.status(201).json({ game });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('createGameController error:', message);
        return res.status(500).json({ error: message });
    }
};

export const addPlayerController = async (req: Request, res: Response) => {
    try {
        const { pin } = req.params as any;
        const { email } = req.body;
        if (!pin) return res.status(400).json({ error: 'Missing game PIN' });
        if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Invalid email' });
        const result = await gameService.addPlayer(pin as string, email);
        return res.status(201).json({ player: result.nickname });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('addPlayerController error:', message);
        return res.status(500).json({ error: message });
    }
};

export const addQuizController = async (req: Request, res: Response) => {
    try {
        const creator = req.user;
        const { pin } = req.params as any;
        const { title } = req.body;
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        if (!pin) return res.status(400).json({ error: 'Missing game PIN' });

        // find game by PIN and use numeric id for service
        const game = await gameRepo.getGameByPIN(pin);
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const fullUser = await userRepo.getUserById(creator.id);
        if (!fullUser) return res.status(401).json({ error: 'User not found' });

        const quiz = await gameService.addQuizToGame(fullUser, Number(game.game_id), title);
        return res.status(201).json({ quiz });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('addQuizController error:', message);
        return res.status(400).json({ error: message });
    }
}

export const addQuestionsController = async (req: Request, res: Response) => {
    try {
        const creator = req.user;
        const { id } = req.params as any;
        const { items } = req.body;
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        if (!id) return res.status(400).json({ error: 'Missing quiz id' });
        if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid items payload' });
        if (items.length === 0) return res.status(400).json({ error: 'At least one question is required' });

        const fullUser = await userRepo.getUserById(creator.id);
        if (!fullUser) return res.status(401).json({ error: 'User not found' });

        const created = await gameService.addQuestionsToQuiz(fullUser, Number(id), items);
        return res.status(201).json({ questions: created });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('addQuestionsController error:', message);
        return res.status(400).json({ error: message });
    }
}

export const initializeGameController = async (req: Request, res: Response) => {
    try {
        const creator = req.user;
        const { pin } = req.params
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        const fullUser = await userRepo.getUserById(creator.id);
        if (!fullUser) return res.status(401).json({ error: 'User not found' });
        const result = await gameService.initializeGame(pin as string, fullUser)

        return res.status(200).json({
            message: "Successfully initialized game",
            result
        })
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('initializeGameController error:', message);
        return res.status(400).json({ error: message });
    }
}

export const joinGame = async (req: Request, res: Response) => {
    try {
        const { pin } = req.params;
        const { nickname } = req.body;
        if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
            return res.status(400).json({ error: 'Valid nickname is required' });
        }
        const result = await gameService.joinGame(Number(pin), nickname);
        return res.status(200).json({
            message: "Successfully joined game",
            result
        });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error("An error occurred while trying to join game", message);
        if (message.includes("expired") || message.includes("No active game")) {
            return res.status(410).json({ error: message });
        } else if (message.includes("nickname") || message.includes("Nickname taken")) {
            return res.status(409).json({ error: message });
        } else if (message.includes("doesn't exist for this game")) {
            return res.status(400).json({ error: message });
        } else {
            return res.status(500).json({ error: message });
        }
    }
}

export const getHostGamesController = async (req: Request, res: Response) => {
    try {
        const host = req.user;
        if (!host || host.role !== 'host') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const games = await gameRepo.getGamesByHostId(host.id);
        return res.status(200).json({ games });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('getHostGamesController error:', message);
        return res.status(500).json({ error: message });
    }
};