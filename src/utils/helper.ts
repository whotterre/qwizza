
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