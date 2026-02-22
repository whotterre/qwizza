import express from 'express';
import morgan from 'morgan';
import authRoutes from './routes/auth';
import gamesRoutes from './routes/game';

const app = express();

app.use(morgan('dev'));
app.use(express.json());
app.use(authRoutes);
app.use(gamesRoutes);

export default app;