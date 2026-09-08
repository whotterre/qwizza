import { defineConfig } from 'drizzle-kit';
import * as dotenv from "dotenv";

dotenv.config({
  path: ".env",
});

const dbUrl = new URL(process.env.DATABASE_URL!);
const sslMode = (dbUrl.searchParams.get("sslmode") ?? process.env.DB_SSL_MODE ?? "").toLowerCase();
const useSsl = sslMode
  ? !["disable", "false", "0"].includes(sslMode)
  : process.env.DB_SSL === "true";

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    host: dbUrl.hostname,
    port: parseInt(dbUrl.port || "5432"),
    user: dbUrl.username,
    password: decodeURIComponent(dbUrl.password), 
    database: dbUrl.pathname.replace(/^\//, ''),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  },
  verbose: true,
  strict: true,
});
