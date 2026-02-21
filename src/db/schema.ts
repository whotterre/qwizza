import { integer, pgEnum, pgTable, varchar, text, boolean, date, serial } from "drizzle-orm/pg-core";

export const rolesEnum = pgEnum("roles", ["player", "host"]);

// User table
import { timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password_hash: varchar("password_hash", { length: 255 }).notNull(),
  role: rolesEnum("role").notNull().default("host"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Game table
export const games = pgTable("games", {
  game_id: serial("game_id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  host_id: integer("host_id").references(() => users.id).notNull(),
  question_duration: integer("question_duration").notNull(), // seconds
  scheduled_at: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  gamePin: varchar({length: 6}).unique().notNull(),
  expires_at: date("expires_at").notNull(),
  created_at: date("created_at").notNull().defaultNow(),
});

// Quiz table
export const quizzes = pgTable("quizzes", {
  q_id: serial("q_id").primaryKey(),
  game_id: integer("game_id").references(() => games.game_id).notNull(),
  question: text("question").notNull(),
  correct_answer: text("correct_answer").notNull(),
});

// Question table
export const questions = pgTable("questions", {
  qu_id: serial("qu_id").primaryKey(),
  quiz_id: integer("quiz_id").references(() => quizzes.q_id).notNull(),
  content: text("content").notNull(),
});

// Answer table (possible answers for a question)
export const answers = pgTable("answers", {
  a_id: serial("a_id").primaryKey(),
  qu_id: integer("qu_id").references(() => questions.qu_id).notNull(),
  content: text("content").notNull(),
});

// Nickname table (player in a game)
export const nicknames = pgTable("nicknames", {
  n_id: serial("n_id").primaryKey(),
  g_id: integer("g_id").references(() => games.game_id).notNull(),
  name: varchar("name", { length: 32 }).notNull(),
  created_at: date("created_at").notNull().defaultNow(),
});

// PlayerAnswer table (tracks who answered what, when, and correctness)
export const playerAnswers = pgTable("player_answers", {
  pa_id: serial("pa_id").primaryKey(),
  n_id: integer("n_id").references(() => nicknames.n_id).notNull(), // player
  qu_id: integer("qu_id").references(() => questions.qu_id).notNull(), // question
  answer: text("answer").notNull(),
  answered_at: date("answered_at").notNull().defaultNow(),
  is_correct: boolean("is_correct").notNull(),
});