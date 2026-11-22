
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { registerGameSocket } from './socket/gameSocket.js';
import { prisma } from './lib/prisma.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(projectRoot, '.env') });

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3000;

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }
  if (process.env.CLIENT_URL && origin === process.env.CLIENT_URL) {
    return true;
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin));
  },
  credentials: true,
}));
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'uno-arena-server',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/db', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    response.json({
      status: 'ok',
      database: 'connected',
      provider: 'neon-postgresql',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database health check failed:', error);

    response.status(503).json({
      status: 'error',
      database: 'disconnected',
    });
  }
});

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

registerGameSocket(io);

httpServer.listen(port, () => {
  console.log(`UNO Arena server listening on http://localhost:${port}`);
});

async function shutdown() {
  console.log('Shutting down UNO Arena server...');

  await new Promise((resolveClose) => {
    httpServer.close(resolveClose);
  });

  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
