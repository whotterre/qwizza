import { customAlphabet } from 'nanoid';
import crypto from 'crypto';

const generateRandomUsername = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 5);

export function generateUsername(): string {
    return generateRandomUsername();
}

// Constants for game generation
export const MAX_NICKNAME_GENERATION_ATTEMPTS = 10;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_USERNAME_LENGTH = 5;
export const PIN_LENGTH = 6;

export function generatePIN(): string {
    try {
        const n = crypto.randomInt(0, 10 ** PIN_LENGTH);
        return String(n).padStart(PIN_LENGTH, '0');
    } catch (e) {
        return String(Math.floor(Math.random() * 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
    }
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        const causeMessage =
            error.cause && typeof error.cause === 'object' && 'message' in error.cause
                ? String((error.cause as { message: unknown }).message)
                : null;
        return causeMessage ? `${error.message}. Cause: ${causeMessage}` : error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as any).message);
    }
    return 'An unexpected error occurred';
}