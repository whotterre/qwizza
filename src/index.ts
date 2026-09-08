import 'dotenv/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';

const databaseUrl = new URL(process.env.DATABASE_URL!);
const sslMode = (databaseUrl.searchParams.get('sslmode') ?? process.env.DB_SSL_MODE ?? '').toLowerCase();
const useSsl = sslMode
	? !['disable', 'false', '0'].includes(sslMode)
	: process.env.DB_SSL === 'true';

const db: NodePgDatabase = drizzle({
	connection: {
		connectionString: process.env.DATABASE_URL!,
		ssl: useSsl ? { rejectUnauthorized: false } : false,
	},
});

export default db