import { Router } from 'express';
import { createGameController, addPlayerController, addQuizController, addQuestionsController, initializeGameController, joinGame, getHostGamesController, getQuizForEditingController, updateQuestionController, updateAnswerController, deleteNicknameController, startGameController, getGameByIdController, getQuizByGameIdController, getNicknamesController, getFinalLeaderboardController } from '../controllers/gameController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/games', authMiddleware, createGameController);
router.get('/games/host', authMiddleware, getHostGamesController);
router.get('/games/:id', getGameByIdController);
router.get('/games/:gameId/quiz', getQuizByGameIdController);
router.get('/games/:gameId/nicknames', getNicknamesController);
router.get('/games/:gameId/leaderboard/final', getFinalLeaderboardController);
router.post('/games/:pin/players', addPlayerController);
router.post('/games/:pin/quiz', authMiddleware, addQuizController);
router.post('/quizzes/:id/questions', authMiddleware, addQuestionsController);
router.get('/game/initialize/:pin', authMiddleware, initializeGameController);
router.post('/game/join/:pin', joinGame);
router.get('/quizzes/:quizId', authMiddleware, getQuizForEditingController);
router.put('/questions/:questionId', authMiddleware, updateQuestionController);
router.put('/answers/:answerId', authMiddleware, updateAnswerController);
router.delete('/games/:gameId/nicknames/:nicknameId', authMiddleware, deleteNicknameController);
router.post('/games/:pin/start', authMiddleware, startGameController);
export default router;
