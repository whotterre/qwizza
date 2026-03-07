
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
        const scheduledAtDate = new Date(scheduled_at);
        if (isNaN(scheduledAtDate.getTime())) return res.status(400).json({ error: 'Invalid scheduled_at' });

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
        const result = await gameService.addPlayer(pin, email);
        return res.status(201).json({ player: result.nickname });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('addPlayerController error:', message);
        return res.status(500).json({ error: message });
    }
};

export const addQuizController = async (req: Request, res: Response) => {
    try {
        const creator = (req as any).user;
        const { pin } = req.params as any;
        const { title } = req.body;
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        if (!pin) return res.status(400).json({ error: 'Missing game PIN' });

        // find game by PIN and use numeric id for service
        const game = await gameRepo.getGameByPIN(pin);
        if (!game) return res.status(404).json({ error: 'Game not found' });

        const quiz = await gameService.addQuizToGame(creator, Number(game.game_id), title);
        return res.status(201).json({ quiz });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('addQuizController error:', message);
        return res.status(400).json({ error: message });
    }
}

export const addQuestionsController = async (req: Request, res: Response) => {
    try {
        const creator = (req as any).user;
        const { id } = req.params as any;
        const { items } = req.body;
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        if (!id) return res.status(400).json({ error: 'Missing quiz id' });
        if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Invalid items payload' });

        const created = await gameService.addQuestionsToQuiz(creator, Number(id), items);
        return res.status(201).json({ questions: created });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('addQuestionsController error:', message);
        return res.status(400).json({ error: message });
    }
}

export const initializeGameController = async (req: Request, res: Response) => {
    try {
        const creator = (req as any).user;
        const { pin } = req.params
        if (!creator) return res.status(401).json({ error: 'Unauthorized' });
        const result = await gameService.initializeGame(pin as string, creator)

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
        const result = await gameService.joinGame(Number(pin), nickname);
        return res.status(200).json({
            message: "Successfully joined game",
            result
        });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error("An error occurred while trying to join game", message);
        const msg = message;
        if (msg.includes("expired") || msg.includes("No active game")) {
            return res.status(404).json({ error: msg });
        } else if (msg.includes("nickname") || msg.includes("Nickname taken")) {
            return res.status(409).json({ error: msg });
        } else if (msg.includes("doesn't exist for this game")) {
            return res.status(400).json({ error: msg });
        } else {
            return res.status(500).json({ error: msg });
        }
    }
}

export const getHostGamesController = async (req: Request, res: Response) => {
    try {
        const host = (req as any).user;
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