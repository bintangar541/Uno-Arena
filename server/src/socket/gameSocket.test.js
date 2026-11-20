import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame } from '../game/engine/index.js';
import { createRoomManager } from '../services/roomManager.js';
import { projectGameState, projectRoom, registerGameSocket } from './gameSocket.js';

test('projects only the requesting player hand and public opponent card counts', () => {
  const players = [
    { id: 'human-1', name: 'Host' },
    { id: 'human-2', name: 'Guest' },
  ];
  const gameState = createGame({ players, random: () => 0 });
  const opponentCardIds = gameState.hands['human-2'].map((card) => card.id);
  gameState.lastAction = {
    type: 'card-drawn',
    playerId: 'human-2',
    cardIds: [opponentCardIds[0]],
  };
  const room = {
    code: 'ABC234',
    hostId: 'human-1',
    status: 'playing',
    rules: gameState.rules,
    players: players.map((player) => ({
      ...player,
      isBot: false,
      socketId: `socket-${player.id}`,
      ready: true,
      connected: true,
    })),
    gameState,
    pendingColor: null,
  };

  const privateState = projectGameState(room, 'human-1');
  const serializedState = JSON.stringify(privateState);

  assert.deepEqual(privateState.hand, gameState.hands['human-1']);
  assert.equal(privateState.players.find((player) => player.id === 'human-2').cardCount, 7);
  assert.equal('hands' in privateState, false);
  assert.equal('drawPile' in privateState, false);
  assert.equal('discardPile' in privateState, false);
  assert.equal('cardIds' in privateState.lastAction, false);
  assert.equal(privateState.lastAction.count, 1);
  for (const cardId of opponentCardIds) {
    assert.equal(serializedState.includes(cardId), false);
  }
});

test('projects room players without socket or reconnect credentials', () => {
  const room = {
    code: 'ABC234',
    hostId: 'player-1',
    status: 'waiting',
    rules: {},
    players: [{
      id: 'player-1',
      name: 'Host',
      socketId: 'private-socket-id',
      reconnectToken: 'private-reconnect-token',
      ready: false,
      isBot: false,
      connected: true,
    }],
    gameState: null,
  };

  const serializedRoom = JSON.stringify(projectRoom(room));
  assert.equal(serializedRoom.includes('private-socket-id'), false);
  assert.equal(serializedRoom.includes('private-reconnect-token'), false);
});

test('projects round placements without exposing other players’ hands', () => {
  const players = [
    { id: 'human-1', name: 'Host' },
    { id: 'human-2', name: 'Guest' },
    { id: 'human-3', name: 'Third Player' },
  ];
  const gameState = createGame({ players, random: () => 0 });
  gameState.hands['human-1'] = [];
  gameState.finishOrder = ['human-1'];
  gameState.currentPlayerIndex = 1;
  const room = {
    code: 'ABC234',
    hostId: 'human-1',
    status: 'playing',
    rules: gameState.rules,
    players: players.map((player) => ({ ...player, isBot: false, socketId: null })),
    gameState,
    pendingColor: null,
  };

  const privateState = projectGameState(room, 'human-2');
  const thirdPlayerCardIds = gameState.hands['human-3'].map((card) => card.id);

  assert.deepEqual(privateState.finishOrder, ['human-1']);
  assert.equal(privateState.players.find((player) => player.id === 'human-1').finishPlace, 1);
  assert.equal(privateState.players.find((player) => player.id === 'human-2').finishPlace, null);
  for (const cardId of thirdPlayerCardIds) {
    assert.equal(JSON.stringify(privateState).includes(cardId), false);
  }
});

test('exposes only exact matching jump-in cards to an off-turn player', () => {
  const players = [
    { id: 'human-1', name: 'Host' },
    { id: 'human-2', name: 'Guest' },
  ];
  const gameState = createGame({ players, random: () => 0 });
  const topCard = { id: 'red-5-1', color: 'red', type: 'number', value: 5 };
  const matchingCard = { id: 'red-5-2', color: 'red', type: 'number', value: 5 };
  gameState.discardPile[gameState.discardPile.length - 1] = topCard;
  gameState.hands['human-2'] = [matchingCard];
  gameState.rules = { ...gameState.rules, jumpIn: true };
  const room = {
    code: 'ABC234',
    hostId: 'human-1',
    status: 'playing',
    rules: gameState.rules,
    players: players.map((player) => ({ ...player, isBot: false, socketId: null })),
    gameState,
    pendingColor: null,
  };

  assert.deepEqual(projectGameState(room, 'human-2').playableCardIds, [matchingCard.id]);
});

test('allows another room player to catch missed UNO through the socket event', () => {
  const handlers = new Map();
  const broadcasts = [];
  let connect;
  const manager = createRoomManager({ roomCodeFactory: () => 'ABC234' });
  const io = {
    on(event, handler) {
      if (event === 'connection') {
        connect = handler;
      }
    },
    to(target) {
      return {
        emit(event, payload) {
          broadcasts.push({ target, event, payload });
        },
      };
    },
    sockets: { sockets: new Map() },
  };
  const socket = {
    id: 'socket-host',
    data: {},
    handshake: { auth: {} },
    emit() {},
    join() {},
    leave() {},
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  registerGameSocket(io, manager);
  connect(socket);

  const { room, player } = manager.createRoom(socket.id, { name: 'Host' });
  const caughtPlayerId = 'guest-player';
  room.players.push({
    id: caughtPlayerId,
    name: 'Guest',
    socketId: null,
    ready: true,
    isBot: false,
    connected: false,
    disconnectedAt: null,
  });
  room.status = 'playing';
  room.gameState = createGame({
    players: [{ id: player.id, name: 'Host' }, { id: caughtPlayerId, name: 'Guest' }],
    random: () => 0,
  });
  room.gameState.hands[caughtPlayerId] = room.gameState.hands[caughtPlayerId].slice(0, 1);
  room.gameState.unoWindow = {
    playerId: caughtPlayerId,
    declared: false,
    deadlineAt: Date.now() + 5000,
  };
  const currentPlayerIndex = room.gameState.currentPlayerIndex;

  handlers.get('game:catch-uno')({});

  assert.equal(room.gameState.hands[caughtPlayerId].length, 3);
  assert.equal(room.gameState.unoWindow, null);
  assert.equal(room.gameState.currentPlayerIndex, currentPlayerIndex);
  assert.equal(
    broadcasts.some(({ event, payload }) => (
      event === 'game:uno-caught'
      && payload.caughtPlayerId === caughtPlayerId
      && payload.count === 2
    )),
    true,
  );
});
