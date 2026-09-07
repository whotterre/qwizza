import { defineConfig } from 'drizzle-kit';
import * as dotenv from "dotenv";

dotenv.config({
  path: ".env",
});

const dbUrl = new URL(process.env.DATABASE_URL!);

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
    ssl: {
       rejectUnauthorized: false, 
    },
  },
  verbose: true,
  strict: true,
});
