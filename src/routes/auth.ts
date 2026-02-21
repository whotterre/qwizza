import { Router } from 'express';
import { deleteUserController, loginController, signUpController } from '../controllers/authController';

const authRoutes = Router();
authRoutes.post('/user/login', loginController);
authRoutes.post('/user/signup', signUpController);
authRoutes.delete('/user/:id', deleteUserController)

export default authRoutes;