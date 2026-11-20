import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomManager } from './roomManager.js';

function createManager() {
  let id = 0;
  let roomCode = 3;
  return createRoomManager({
    idFactory: () => `player-${++id}`,
    roomCodeFactory: () => `ABC23${++roomCode}`,
    tokenFactory: () => `reconnect-token-${id}`.padEnd(32, 'x'),
  });
}

test('creates private rooms and joins players by normalized room code', () => {
  const manager = createManager();
  const host = manager.createRoom('socket-host', { name: '  Host  ' });
  const guest = manager.joinRoom('socket-guest', { code: 'abc234', name: 'Guest' });

  assert.equal(host.room.code, 'ABC234');
  assert.equal(host.player.name, 'Host');
  assert.equal(guest.room.players.length, 2);
  assert.equal(guest.room.rules.startingHand, 7);
  assert.notEqual(host.reconnectToken, guest.reconnectToken);
});

test('rejects invalid names, room codes, full rooms, and duplicate membership', () => {
  const manager = createManager();

  assert.throws(
    () => manager.createRoom('socket-host', { name: ' ' }),
    (error) => error.code === 'INVALID_NAME',
  );
  manager.createRoom('socket-host', { name: 'Host', rules: { maximumPlayers: 2 } });
  assert.throws(
    () => manager.joinRoom('socket-guest', { code: 'invalid', name: 'Guest' }),
    (error) => error.code === 'INVALID_ROOM_CODE',
  );
  manager.joinRoom('socket-guest', { code: 'ABC234', name: 'Guest' });
  assert.throws(
    () => manager.joinRoom('socket-host', { code: 'ABC234', name: 'Host' }),
    (error) => error.code === 'ALREADY_IN_ROOM',
  );
  assert.throws(
    () => manager.joinRoom('socket-third', { code: 'ABC234', name: 'Third' }),
    (error) => error.code === 'ROOM_FULL',
  );
});

test('enforces host controls and readiness before starting a game with bots', () => {
  const manager = createManager();
  const host = manager.createRoom('socket-host', { name: 'Host' });
  const guest = manager.joinRoom('socket-guest', { code: host.room.code, name: 'Guest' });

  assert.throws(
    () => manager.addBot('socket-guest', { difficulty: 'easy' }),
    (error) => error.code === 'HOST_ONLY',
  );
  const bot = manager.addBot('socket-host', { difficulty: 'hard' }).player;
  assert.equal(bot.ready, true);
  assert.throws(
    () => manager.startGame('socket-host'),
    (error) => error.code === 'PLAYERS_NOT_READY',
  );

  manager.setReady('socket-host', true);
  manager.setReady('socket-guest', true);
  const room = manager.startGame('socket-host');
  assert.equal(room.status, 'playing');
  assert.equal(room.gameState.players.length, 3);
  assert.equal(room.gameState.hands[host.player.id].length, 7);
  assert.equal(room.gameState.hands[guest.player.id].length, 7);
});

test('reconnects a disconnected guest using its private token', () => {
  const manager = createManager();
  const created = manager.createRoom('socket-host', { name: 'Host' });
  const joined = manager.joinRoom('socket-guest', {
    code: created.room.code,
    name: 'Guest',
  });

  const disconnected = manager.disconnect('socket-guest');
  assert.equal(disconnected.player.connected, false);

  const reconnected = manager.reconnect(joined.reconnectToken, 'socket-guest-new');
  assert.equal(reconnected.player.id, joined.player.id);
  assert.equal(reconnected.player.connected, true);
  assert.equal(manager.getRoomForSocket('socket-guest-new').player.id, joined.player.id);
});

test('transfers host after a lobby host leaves and removes empty rooms', () => {
  const manager = createManager();
  const host = manager.createRoom('socket-host', { name: 'Host' });
  const guest = manager.joinRoom('socket-guest', { code: host.room.code, name: 'Guest' });

  const result = manager.leaveRoom('socket-host');
  assert.equal(result.room.hostId, guest.player.id);
  assert.throws(
    () => manager.getRoomForSocket('socket-host'),
    (error) => error.code === 'NOT_IN_ROOM',
  );

  manager.leaveRoom('socket-guest');
  assert.throws(
    () => manager.joinRoom('socket-third', { code: host.room.code, name: 'Third' }),
    (error) => error.code === 'ROOM_NOT_FOUND',
  );
});

test('prevents leaving during a game but allows leaving after the round ends', () => {
  const manager = createManager();
  const host = manager.createRoom('socket-host', { name: 'Host' });
  const guest = manager.joinRoom('socket-guest', { code: host.room.code, name: 'Guest' });
  manager.addBot('socket-host', { difficulty: 'easy' });
  manager.setReady('socket-host', true);
  manager.setReady('socket-guest', true);
  manager.startGame('socket-host');

  assert.throws(
    () => manager.leaveRoom('socket-host'),
    (error) => error.code === 'GAME_IN_PROGRESS',
  );
  host.room.gameState.status = 'finished';
  const result = manager.leaveRoom('socket-host');
  assert.equal(result.removed, false);
  assert.equal(result.room.hostId, guest.player.id);
  assert.equal(manager.startNextRound('socket-guest').gameState.players.length, 2);
});

test('expires disconnected lobby seats after the reconnect grace period', async () => {
  const expiredPlayers = [];
  let id = 0;
  const manager = createRoomManager({
    idFactory: () => `player-${++id}`,
    roomCodeFactory: () => 'ABC234',
    tokenFactory: () => `reconnect-token-${id}`.padEnd(32, 'x'),
    reconnectGraceMs: 5,
    onDisconnectedExpired: ({ playerId, roomRemoved }) => {
      expiredPlayers.push({ playerId, roomRemoved });
    },
  });
  const host = manager.createRoom('socket-host', { name: 'Host' });
  const guest = manager.joinRoom('socket-guest', { code: host.room.code, name: 'Guest' });
  manager.disconnect('socket-guest');

  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.deepEqual(
    manager.getRoomForSocket('socket-host').room.players.map((player) => player.id),
    [host.player.id],
  );
  assert.deepEqual(expiredPlayers, [{ playerId: guest.player.id, roomRemoved: false }]);
  assert.throws(
    () => manager.reconnect(guest.reconnectToken, 'socket-guest-new'),
    (error) => error.code === 'RECONNECT_EXPIRED',
  );
});

test('allows only the host to start a new round after the previous round ends', () => {
  const manager = createManager();
  const host = manager.createRoom('socket-host', { name: 'Host' });
  const guest = manager.joinRoom('socket-guest', { code: host.room.code, name: 'Guest' });
  manager.setReady('socket-host', true);
  manager.setReady('socket-guest', true);
  const room = manager.startGame('socket-host');

  assert.throws(
    () => manager.startNextRound('socket-host'),
    (error) => error.code === 'ROUND_NOT_FINISHED',
  );
  room.gameState.status = 'finished';
  assert.throws(
    () => manager.startNextRound('socket-guest'),
    (error) => error.code === 'HOST_ONLY',
  );
  assert.equal(manager.startNextRound('socket-host').gameState.roundNumber, 2);
  assert.equal(manager.getRoomForSocket('socket-guest').player.id, guest.player.id);
});

test('allows the host to restart a completed match in the same room', () => {
  const manager = createManager();
  const host = manager.createRoom('socket-host', { name: 'Host' });
  manager.joinRoom('socket-guest', { code: host.room.code, name: 'Guest' });
  manager.setReady('socket-host', true);
  manager.setReady('socket-guest', true);
  const room = manager.startGame('socket-host');
  const previousMatchId = room.matchId;
  room.gameState.status = 'finished';
  room.gameState.matchWinnerId = host.player.id;
  room.gameState.scoreboard[host.player.id] = room.gameState.rules.targetScore;

  assert.throws(
    () => manager.rematchGame('socket-guest'),
    (error) => error.code === 'HOST_ONLY',
  );
  const rematch = manager.rematchGame('socket-host');

  assert.notEqual(rematch.matchId, previousMatchId);
  assert.equal(rematch.gameState.roundNumber, 1);
  assert.equal(rematch.gameState.matchWinnerId, null);
  assert.equal(rematch.gameState.scoreboard[host.player.id], 0);
  assert.equal(rematch.gameState.players.length, 2);
});
