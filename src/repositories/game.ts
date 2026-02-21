import { NodePgDatabase } from "drizzle-orm/node-postgres"
import { eq, and } from "drizzle-orm"
import { games, nicknames } from "../db/schema"

class GameRepository {
    private dbClient: NodePgDatabase

    constructor(db: NodePgDatabase) {
        this.dbClient = db
    }

    async createGame(
        name: string,
        question_duration: number,
        scheduled_at: Date,
        expires_at: Date,
        host_id: number
    ) {
        // const result = await this.dbClient.insert(games).values({
        //     name,
        //     question_duration,
        //     scheduled_at: scheduled_at,
        //     expires_at: expires_at,
        //     host_id
        // }).returning();
        // return result[0];
    }

    async getGameByPIN(gamePin: string) {
        if (!gamePin) {
            return
        }
        const result = await this.dbClient.select().from(games).where(eq(games.gamePin, gamePin)).limit(1)
        return result[0]
    }


    async createNickname(game_id: number, nickname: string) {
        const result = await this.dbClient.insert(nicknames).values({
            g_id: game_id,
            name: nickname,
        }).returning();
        return result[0];
    }

    async nicknameExists(game_id: number, name: string) {
        const rows = await this.dbClient.select().from(nicknames).where(and(eq(nicknames.g_id, game_id), (eq(nicknames.name, name)))).limit(1);
        return (rows && rows.length > 0);
    }

}

export default GameRepository