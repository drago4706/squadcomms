import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a minute and try again.' }
});
const roomCodePattern = /^[A-HJ-NP-Z2-9]{6,10}$/;
const namePattern = /^[\p{L}\p{N}_ -]{1,24}$/u;

function configReady() {
  return process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: Boolean(configReady()) });
});

app.post('/api/token', tokenLimiter, async (req, res) => {
  try {
    if (!configReady()) return res.status(503).json({ error: 'Voice service is not configured yet. Add LiveKit credentials to the server environment.' });
    const roomCode = String(req.body?.roomCode || '').trim().toUpperCase();
    const participantName = String(req.body?.participantName || '').trim();

    if (!roomCodePattern.test(roomCode)) {
      return res.status(400).json({ error: 'Room code must be 6–10 characters using letters and numbers (excluding easily confused characters).' });
    }
    if (!namePattern.test(participantName)) {
      return res.status(400).json({ error: 'Name must be 1–24 characters and contain only letters, numbers, spaces, hyphens or underscores.' });
    }

    const roomName = `squad-${roomCode}`;
    const livekitHttpUrl = process.env.LIVEKIT_URL
      .replace(/^wss:/i, 'https:')
      .replace(/^ws:/i, 'http:');
    const roomService = new RoomServiceClient(
      livekitHttpUrl,
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET
    );

    // Create rooms with a server-side participant cap. The first join creates the room.
    const rooms = await roomService.listRooms([roomName]);
    if (!rooms.some(room => room.name === roomName)) {
      try {
        await roomService.createRoom({ name: roomName, maxParticipants: 8, emptyTimeout: 300 });
      } catch (error) {
        // Concurrent first joins can race to create the same room; verify it now exists.
        const current = await roomService.listRooms([roomName]);
        if (!current.some(room => room.name === roomName)) throw error;
      }
    } else {
      const currentRoom = rooms.find(room => room.name === roomName);
      if (currentRoom.numParticipants >= 8) {
        return res.status(409).json({ error: 'This room is full (8 players maximum).' });
      }
    }

    const identity = `player-${crypto.randomUUID()}`;
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
      name: participantName,
      ttl: '15m'
    });
    token.addGrant({
  roomJoin: true,
  room: roomName,
  canPublish: true,
  canSubscribe: true,
  canPublishData: false
});

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      serverUrl: process.env.LIVEKIT_URL,
      participantToken: await token.toJwt(),
      roomName,
      participantName
    });
  } catch (error) {
    console.error('Token endpoint error:', error?.message || error);
    res.status(500).json({ error: 'Could not create a voice session. Check the server configuration and try again.' });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(projectRoot, 'dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(projectRoot, 'dist', 'index.html')));
}

app.listen(port, () => console.log(`SquadComms server listening on ${port}`));
