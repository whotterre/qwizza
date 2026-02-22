import bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { Request, Response } from 'express';
import UserRepository from "../repositories/user"


function validateAuthInput(email: string, password: string, role?: string) {
    const validRoles = ['player', 'host'];
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!email || !emailRegex.test(email)) {
        return 'Invalid email';
    }
    if (!password || password.length < 6) {
        return 'Password must be at least 6 characters';
    }
    if (role && !validRoles.includes(role)) {
        return 'Invalid role';
    }
    return null;
}

class AuthService {
    private userRepo: UserRepository;

    constructor(userRepository: UserRepository) {
        this.userRepo = userRepository;
    }

    async validateAndSignUp(email: string, password: string, role?: string) {
        const error = validateAuthInput(email, password, role);
        if (error) return { error };

        const existingUser = await this.userRepo.getUserByEmail(email);
        if (existingUser) return { error: 'User already exists' };

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await this.userRepo.createUser(
            email,
            passwordHash,
            (role === 'player' || role === 'host') ? role : 'host'
        );
        return { user };
    }

    async validateAndLogin(email: string, password: string, role?: string) {
        const error = validateAuthInput(email, password, role);
        if (error) return { error };

        const user = await this.userRepo.getUserByEmail(email);
        if (!user) return { error: 'User not found' };

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return { error: 'Invalid password' };
        // sign jwt with expiry
        const payload = {
            id: user.id,
            role: user.role
        }
        const JWT_SECRET = process.env.JWT_SECRET!;
        if (!JWT_SECRET) {
            return { error: 'JWT secret not configured' };
        }
        const token = sign(
            payload,
            JWT_SECRET!,
            {expiresIn: 60} // TODO: use env vars for this
        );
        return { token, ...user };
    }

    async deleteUser(id: number) {
        await this.userRepo.deleteUser(id)
    }
}

export default AuthService;