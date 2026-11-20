import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { registerGameSocket } from './socket/gameSocket.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(projectRoot, '.env') });

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3000;
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({ origin: clientUrl }));
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'uno-arena-server',
    timestamp: new Date().toISOString(),
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: clientUrl,
    methods: ['GET', 'POST'],
  },
});

registerGameSocket(io);

httpServer.listen(port, () => {
  console.log(`UNO Arena server listening on http://localhost:${port}`);
});
