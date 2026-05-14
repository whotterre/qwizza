require('dotenv').config();
const { Pool } = require('pg');

async function createIndexes() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('Creating database indexes...');
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_games_gamepin ON games("gamePin");
      CREATE INDEX IF NOT EXISTS idx_nicknames_g_id_name ON nicknames(g_id, name);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_quizzes_game_id ON quizzes(game_id);
      CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions(quiz_id);
      CREATE INDEX IF NOT EXISTS idx_player_answers_n_id ON player_answers(n_id);
    `);

    console.log('Indexes created successfully');
    process.exit(0);
  } catch (err) {
    console.error('Failed to create indexes:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createIndexes();
