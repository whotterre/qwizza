import { Router } from 'express';
import { createGameController, addPlayerController, addQuizController, addQuestionsController } from '../controllers/gameController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/games', authMiddleware, createGameController);
router.post('/games/:pin/players', addPlayerController);
router.post('/games/:pin/quiz', authMiddleware, addQuizController);
router.post('/quizzes/:id/questions', authMiddleware, addQuestionsController);

export default router;
