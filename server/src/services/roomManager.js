import { randomBytes, randomUUID } from 'node:crypto';
import { createGame, startNextRound as createNextRound } from '../game/engine/index.js';
import { normalizeCustomRules } from '../game/rules/customRules.js';

const ROOM_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;

export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RoomError(code, message);
}

function normalizeName(name) {
  if (typeof name !== 'string') {
    fail('INVALID_NAME', 'Enter a player name between 2 and 20 characters.');
  }
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 20) {
    fail('INVALID_NAME', 'Enter a player name between 2 and 20 characters.');
  }
  return normalized;
}

function normalizeCode(code) {
  if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code.trim().toUpperCase())) {
    fail('INVALID_ROOM_CODE', 'Enter a valid six-character room code.');
  }
  return code.trim().toUpperCase();
}

function createRoomCode() {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  return Array.from(bytes, (byte) => ROOM_CODE_CHARACTERS[byte % ROOM_CODE_CHARACTERS.length]).join('');
}

function createReconnectToken() {
  return randomBytes(32).toString('base64url');
}

function getRoomPlayer(room, playerId) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    fail('PLAYER_NOT_IN_ROOM', 'This player is not in the room.');
  }
  return player;
}

export function createRoomManager({
  idFactory = randomUUID,
  roomCodeFactory = createRoomCode,
  tokenFactory = createReconnectToken,
  reconnectGraceMs = 10 * 60 * 1000,
  onDisconnectedExpired = () => {},
} = {}) {
  const rooms = new Map();
  const playersByToken = new Map();
  const playerBySocket = new Map();
  const disconnectTimers = new Map();

  function getRoomByCode(code) {
    const room = rooms.get(normalizeCode(code));
    if (!room) {
      fail('ROOM_NOT_FOUND', 'Room not found. Check the code and try again.');
    }
    return room;
  }

  function getPlayerForSocket(socketId) {
    const membership = playerBySocket.get(socketId);
    if (!membership) {
      fail('NOT_IN_ROOM', 'Join or create a room first.');
    }
    const room = rooms.get(membership.roomCode);
    if (!room) {
      playerBySocket.delete(socketId);
      fail('ROOM_NOT_FOUND', 'This room is no longer available.');
    }
    return { room, player: getRoomPlayer(room, membership.playerId) };
  }

  function ensureSocketFree(socketId) {
    if (playerBySocket.has(socketId)) {
      fail('ALREADY_IN_ROOM', 'Leave your current room before joining another.');
    }
  }

  function assignHuman(room, socketId, name) {
    const player = {
      id: idFactory(),
      name: normalizeName(name),
      socketId,
      ready: false,
      isBot: false,
      connected: true,
      disconnectedAt: null,
    };
    const token = tokenFactory();
    room.players.push(player);
    playerBySocket.set(socketId, { roomCode: room.code, playerId: player.id });
    playersByToken.set(token, { roomCode: room.code, playerId: player.id });
    return { player, reconnectToken: token };
  }

  function createRoom(socketId, { name, rules = {} } = {}) {
    ensureSocketFree(socketId);
    const normalizedRules = normalizeCustomRules(rules);
    const normalizedName = normalizeName(name);
    let code;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      code = roomCodeFactory();
      if (typeof code === 'string') {
        code = code.toUpperCase();
      }
      if (typeof code === 'string' && /^[A-Z2-9]{6}$/.test(code) && !rooms.has(code)) {
        break;
      }
      code = null;
    }
    if (!code) {
      fail('ROOM_CREATION_FAILED', 'Could not create a unique room code. Try again.');
    }

    const room = {
      code,
      matchId: randomUUID(),
      hostId: null,
      status: 'waiting',
      rules: normalizedRules,
      players: [],
      gameState: null,
      pendingColor: null,
      createdAt: Date.now(),
    };
    const membership = assignHuman(room, socketId, normalizedName);
    room.hostId = membership.player.id;
    rooms.set(code, room);
    return { room, ...membership };
  }

  function joinRoom(socketId, { code, name } = {}) {
    ensureSocketFree(socketId);
    const room = getRoomByCode(code);
    if (room.status !== 'waiting') {
      fail('GAME_ALREADY_STARTED', 'This game has already started.');
    }
    if (room.players.length >= room.rules.maximumPlayers) {
      fail('ROOM_FULL', 'This room is full.');
    }
    const membership = assignHuman(room, socketId, name);
    return { room, ...membership };
  }

  function addBot(socketId, { difficulty = 'medium' } = {}) {
    const { room, player } = getPlayerForSocket(socketId);
    if (player.id !== room.hostId) {
      fail('HOST_ONLY', 'Only the room host can add a bot.');
    }
    if (room.status !== 'waiting') {
      fail('GAME_ALREADY_STARTED', 'Bots can only be added before the game starts.');
    }
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      fail('INVALID_DIFFICULTY', 'Bot difficulty must be easy, medium, or hard.');
    }
    if (room.players.length >= room.rules.maximumPlayers) {
      fail('ROOM_FULL', 'This room is full.');
    }

    const bot = {
      id: idFactory(),
      name: `Bot ${room.players.filter((candidate) => candidate.isBot).length + 1}`,
      socketId: null,
      ready: true,
      isBot: true,
      difficulty,
      connected: true,
    };
    room.players.push(bot);
    return { room, player: bot };
  }

  function removeBot(socketId, botId) {
    const { room, player } = getPlayerForSocket(socketId);
    if (player.id !== room.hostId) {
      fail('HOST_ONLY', 'Only the room host can remove a bot.');
    }
    if (room.status !== 'waiting') {
      fail('GAME_ALREADY_STARTED', 'Bots can only be removed before the game starts.');
    }
    const index = room.players.findIndex((candidate) => candidate.id === botId && candidate.isBot);
    if (index === -1) {
      fail('BOT_NOT_FOUND', 'That bot is not in this room.');
    }
    room.players.splice(index, 1);
    return room;
  }

  function removePlayerTokens(roomCode, playerId) {
    for (const [token, membership] of playersByToken) {
      if (membership.roomCode === roomCode && membership.playerId === playerId) {
        playersByToken.delete(token);
      }
    }
  }

  function cleanupExpiredDisconnect(roomCode, playerId) {
    const room = rooms.get(roomCode);
    const player = room?.players.find((candidate) => candidate.id === playerId);
    if (!room || !player || player.connected || !player.disconnectedAt) {
      return;
    }

    const expiredAt = player.disconnectedAt + reconnectGraceMs;
    if (Date.now() < expiredAt) {
      return;
    }

    if (room.status === 'waiting') {
      room.players = room.players.filter((candidate) => candidate.id !== playerId);
      removePlayerTokens(room.code, playerId);
      const noHumanPlayers = !room.players.some((candidate) => !candidate.isBot);
      if (room.players.length === 0 || noHumanPlayers) {
        room.status = 'closed';
        rooms.delete(room.code);
        onDisconnectedExpired({ room, playerId, roomRemoved: true });
        return;
      }
      if (room.hostId === playerId) {
        room.hostId = room.players.find((candidate) => !candidate.isBot)?.id ?? room.players[0].id;
      }
      onDisconnectedExpired({ room, playerId, roomRemoved: false });
      return;
    }

    const humans = room.players.filter((candidate) => !candidate.isBot);
    const allHumansExpired = humans.every((candidate) => (
      !candidate.connected
      && candidate.disconnectedAt
      && Date.now() >= candidate.disconnectedAt + reconnectGraceMs
    ));
    if (allHumansExpired) {
      for (const candidate of room.players) {
        if (candidate.socketId) {
          playerBySocket.delete(candidate.socketId);
        }
        clearTimeout(disconnectTimers.get(candidate.id));
        disconnectTimers.delete(candidate.id);
        removePlayerTokens(room.code, candidate.id);
      }
      room.status = 'closed';
      rooms.delete(room.code);
      onDisconnectedExpired({ room, playerId, roomRemoved: true });
    }
  }

  function scheduleDisconnectCleanup(room, player) {
    clearTimeout(disconnectTimers.get(player.id));
    const timer = setTimeout(() => {
      disconnectTimers.delete(player.id);
      cleanupExpiredDisconnect(room.code, player.id);
    }, reconnectGraceMs);
    timer.unref?.();
    disconnectTimers.set(player.id, timer);
  }

  function setReady(socketId, ready) {
    const { room, player } = getPlayerForSocket(socketId);
    if (room.status !== 'waiting') {
      fail('GAME_ALREADY_STARTED', 'Readiness can only change before the game starts.');
    }
    if (typeof ready !== 'boolean') {
      fail('INVALID_READY_STATE', 'Ready state must be true or false.');
    }
    player.ready = ready;
    return room;
  }

  function startGame(socketId) {
    const { room, player } = getPlayerForSocket(socketId);
    if (player.id !== room.hostId) {
      fail('HOST_ONLY', 'Only the room host can start the game.');
    }
    if (room.status !== 'waiting') {
      fail('GAME_ALREADY_STARTED', 'This game has already started.');
    }
    if (room.players.length < 2) {
      fail('NOT_ENOUGH_PLAYERS', 'Add at least one more player or bot to start.');
    }
    const unreadyPlayer = room.players.find((candidate) => !candidate.isBot && !candidate.ready);
    if (unreadyPlayer) {
      fail('PLAYERS_NOT_READY', 'Every human player must be ready before the game starts.');
    }

    room.gameState = createGame({
      players: room.players.map(({ id, name }) => ({ id, name })),
      rules: room.rules,
    });
    room.status = 'playing';
    room.pendingColor = null;
    return room;
  }

  function startNextRound(socketId) {
    const { room, player } = getPlayerForSocket(socketId);
    if (player.id !== room.hostId) {
      fail('HOST_ONLY', 'Only the room host can start the next round.');
    }
    if (room.status !== 'playing' || !room.gameState) {
      fail('GAME_NOT_STARTED', 'The game has not started yet.');
    }
    room.gameState = createNextRound(room.gameState);
    room.pendingColor = null;
    return room;
  }

  function rematchGame(socketId) {
    const { room, player } = getPlayerForSocket(socketId);
    if (player.id !== room.hostId) {
      fail('HOST_ONLY', 'Only the room host can start a rematch.');
    }
    if (room.gameState?.status !== 'finished' || !room.gameState.matchWinnerId) {
      fail('MATCH_NOT_FINISHED', 'A rematch is only available after the match has ended.');
    }

    room.matchId = randomUUID();
    room.gameState = createGame({
      players: room.players.map(({ id, name }) => ({ id, name })),
      rules: room.rules,
    });
    room.pendingColor = null;
    return room;
  }

  function leaveRoom(socketId) {
    const { room, player } = getPlayerForSocket(socketId);
    const finished = room.gameState?.status === 'finished';
    if (room.status !== 'waiting' && !finished) {
      fail('GAME_IN_PROGRESS', 'You cannot leave a game in progress. Disconnect to reconnect later.');
    }
    playerBySocket.delete(socketId);
    clearTimeout(disconnectTimers.get(player.id));
    disconnectTimers.delete(player.id);
    const tokenEntry = [...playersByToken.entries()]
      .find(([, membership]) => membership.roomCode === room.code && membership.playerId === player.id);
    if (tokenEntry) {
      playersByToken.delete(tokenEntry[0]);
    }
    room.players = room.players.filter((candidate) => candidate.id !== player.id);
    if (finished) {
      room.gameState.players = room.gameState.players.filter((candidate) => candidate.id !== player.id);
      delete room.gameState.hands[player.id];
      delete room.gameState.scoreboard[player.id];
      room.gameState.currentPlayerIndex = 0;
    }
    if (
      room.players.length === 0
      || (finished && (room.players.length < 2 || !room.players.some((candidate) => !candidate.isBot)))
    ) {
      room.status = 'closed';
      for (const candidate of room.players) {
        if (candidate.socketId) {
          playerBySocket.delete(candidate.socketId);
        }
        removePlayerTokens(room.code, candidate.id);
      }
      rooms.delete(room.code);
      return { room, removed: true };
    }
    if (room.hostId === player.id) {
      room.hostId = room.players.find((candidate) => !candidate.isBot)?.id ?? room.players[0].id;
    }
    return { room, removed: false };
  }

  function disconnect(socketId) {
    const membership = playerBySocket.get(socketId);
    if (!membership) {
      return null;
    }
    playerBySocket.delete(socketId);
    const room = rooms.get(membership.roomCode);
    if (!room) {
      return null;
    }
    const player = room.players.find((candidate) => candidate.id === membership.playerId);
    if (!player || player.socketId !== socketId) {
      return null;
    }
    player.socketId = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    scheduleDisconnectCleanup(room, player);
    return { room, player };
  }

  function reconnect(token, socketId) {
    ensureSocketFree(socketId);
    if (typeof token !== 'string' || token.length < 32) {
      fail('INVALID_RECONNECT_TOKEN', 'Reconnect token is invalid.');
    }
    const membership = playersByToken.get(token);
    const room = membership && rooms.get(membership.roomCode);
    const player = room?.players.find((candidate) => candidate.id === membership.playerId);
    if (!player || player.isBot) {
      playersByToken.delete(token);
      fail('RECONNECT_EXPIRED', 'This guest session can no longer be reconnected.');
    }

    if (player.socketId) {
      playerBySocket.delete(player.socketId);
    }
    clearTimeout(disconnectTimers.get(player.id));
    disconnectTimers.delete(player.id);
    player.socketId = socketId;
    player.connected = true;
    player.disconnectedAt = null;
    playerBySocket.set(socketId, { roomCode: room.code, playerId: player.id });
    return { room, player };
  }

  function getRoomForSocket(socketId) {
    return getPlayerForSocket(socketId);
  }

  function getRoomByCodeForSocket(socketId) {
    return getPlayerForSocket(socketId).room;
  }

  return {
    addBot,
    createRoom,
    disconnect,
    getRoomByCodeForSocket,
    getRoomForSocket,
    joinRoom,
    leaveRoom,
    reconnect,
    rematchGame,
    removeBot,
    setReady,
    startGame,
    startNextRound,
  };
}
