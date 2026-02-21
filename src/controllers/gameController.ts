import { Request, Response } from 'express';
import GameRepository from "../repositories/game";
import UserRepository from "../repositories/user";
import db from '../index';
import GameService from '../services/game';

const gameRepo = new GameRepository(db);
const userRepo = new UserRepository(db);
const gameService = new GameService(userRepo, gameRepo);

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
	} catch (err: any) {
		return res.status(500).json({ error: err.message || 'Internal error' });
	}
};

export const addPlayerController = async (req: Request, res: Response) => {
	try {
		const { pin } = req.params as any;
		const { email } = req.body;
		if (!pin) return res.status(400).json({ error: 'Missing game PIN' });
		const result = await gameService.addPlayer(pin, email);
		return res.status(201).json({ player: result.nickname });
	} catch (err: any) {
		return res.status(500).json({ error: err.message || 'Internal error' });
	}
};

export default {};