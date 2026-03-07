import { customAlphabet } from 'nanoid';

const generateRandomUsername = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 5);

export function generateUsername(): string {
    return generateRandomUsername();
}

// Constants for game generation
export const MAX_NICKNAME_GENERATION_ATTEMPTS = 10;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_USERNAME_LENGTH = 5;
export const PIN_MAX = 999999;

export function generatePIN(){
    return Math.floor(Math.random() * PIN_MAX)
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as any).message);
    }
    return 'An unexpected error occurred';
}