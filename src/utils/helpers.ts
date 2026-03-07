export function generateUsername(): string {
    // Username space = 26 ^ 5
    let res = ""
    const charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    for (let i = 0; i < 5; i++) {
        let randIdx = Math.round(Math.random() * 26)
        res += charSet[randIdx]
    }
    return res
}

export function generatePIN(){
    return Math.floor(Math.random() * 999999)
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