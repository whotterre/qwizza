import { Request, Response } from 'express';
import AuthService from '../services/auth';
import UserRepository from '../repositories/user';
import db from '../index';
import { getErrorMessage, MIN_PASSWORD_LENGTH } from '../utils/helpers';

const userRepo = new UserRepository(db);
const authService = new AuthService(userRepo);

export const signUpController = async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const result = await authService.validateAndSignUp(email, password, role);
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    const { user } = result;
    const { password_hash, ...safeUser } = user;
    return res.status(201).json({ user: safeUser });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error('signUpController error:', message);
    return res.status(500).json({ error: message });
  }
};

export const loginController = async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const result = await authService.validateAndLogin(email, password, role);
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    const { password_hash, ...safeUser } = result;
    return res.status(200).json({ user: safeUser });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error('loginController error:', message);
    return res.status(500).json({ error: message });
  }
};

export const deleteUserController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID required' });
    }
    const result = await userRepo.deleteUser(Number(id));
    if (!result) {
      return res.status(404).json({ error: 'User not found or already deleted' });
    }
    const { password_hash, ...safeUser } = result || {};
    return res.status(200).json({ user: safeUser, message: 'User deleted successfully' });
  } catch (err) {
    const message = getErrorMessage(err);
    console.error('deleteUserController error:', message);
    return res.status(500).json({ error: message });
  }
};

