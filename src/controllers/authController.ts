import { Request, Response } from 'express';
import AuthService from '../services/auth';
import UserRepository from '../repositories/user';
import db from '../index';

const userRepo = new UserRepository(db);
const authService = new AuthService(userRepo);

export const signUpController = async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;
    const result = await authService.validateAndSignUp(email, password, role);
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    const { user } = result;
    const { password_hash, ...safeUser } = user;
    return res.status(201).json({ user: safeUser });
  } catch (err: any) {
    console.error('signUpController error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

export const loginController = async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;
    const result = await authService.validateAndLogin(email, password, role);
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    const { password_hash, ...safeUser } = result;
    return res.status(200).json({ user: safeUser });
  } catch (err: any) {
    console.error('loginController error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
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
  } catch (err: any) {
    console.error('deleteUserController error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

