import { NodePgDatabase } from "drizzle-orm/node-postgres"
import { eq } from "drizzle-orm"
import { users } from "../db/schema"

class UserRepository {
    private dbClient: NodePgDatabase

    constructor(db: NodePgDatabase) {
        this.dbClient = db
    }


    // Get user by email
    async getUserByEmail(email: string) {
        if (!email) {
            return
        }
        const result = await this.dbClient.select().from(users).where(eq(users.email, email)).limit(1)
        return result[0]
    }

    async getUserById(id: number) {
        if (!id) {
            return
        }
        const result = await this.dbClient.select().from(users).where(eq(users.id, id)).limit(1)
        return result[0]
    }

    // Create user
    async createUser(
        email: string,
        passwordHash: string,
        role: "player" | "host" = "host"
    ) {
        const result = await this.dbClient
            .insert(users)
            .values({ email, password_hash: passwordHash, role })
            .returning();
        return result[0];
    }

    // Delete user
    async deleteUser(id: number) {
        const result = await this.dbClient
            .delete(users)
            .where(eq(users.id, id))
            .returning();
        return result[0];
    }
}

export default UserRepository