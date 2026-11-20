import {
  catchUno,
  declareUno,
  drawCard,
  getCurrentPlayerId,
  getNextPlayerId,
  isCardPlayable,
  passTurn,
  playCard,
  playCards,
} from '../game/engine/index.js';
import { chooseBotAction } from '../game/bot/index.js';
import { RoomError, createRoomManager } from '../services/roomManager.js';

const EVENT_LIMIT = 30;
const EVENT_WINDOW_MS = 10_000;
const ROOM_EVENT_PREFIX = 'room:';
const BOT_TURN_DELAY_MS = 1_800;
const BOT_FOLLOW_UP_DELAY_MS = 400;

function assertPayload(payload, allowedKeys = []) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RoomError('INVALID_PAYLOAD', 'Event payload must be an object.');
  }
  const unexpectedKey = Object.keys(payload).find((key) => !allowedKeys.includes(key));
  if (unexpectedKey) {
    throw new RoomError('INVALID_PAYLOAD', `Unexpected payload field: ${unexpectedKey}.`);
  }
}

export function projectRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.gameState?.status === 'finished' ? 'finished' : room.status,
    rules: room.rules,
    players: room.players.map((player) => {
      const finishIndex = room.gameState?.finishOrder?.indexOf(player.id) ?? -1;
      return {
        id: player.id,
        name: player.name,
        ready: player.ready,
        isBot: player.isBot,
        difficulty: player.isBot ? player.difficulty : undefined,
        connected: player.connected,
        cardCount: room.gameState?.hands[player.id]?.length,
        finishPlace: finishIndex === -1 ? null : finishIndex + 1,
      };
    }),
  };
}

export function projectGameState(room, playerId) {
  const state = room.gameState;
  const ownPlayer = room.players.find((player) => player.id === playerId);
  if (!state || !ownPlayer || ownPlayer.isBot) {
    return null;
  }
  const activePlayerId = getCurrentPlayerId(state);
  const topCard = state.discardPile[state.discardPile.length - 1];
  const finishOrder = [...state.finishOrder];
  const playableCardIds = state.hands[playerId]
    .filter((card) => {
      if (activePlayerId === playerId) {
        return !state.drawnCardId || state.drawnCardId === card.id;
      }
      return state.rules.jumpIn
        && state.pendingDraw === 0
        && !state.drawnCardId
        && card.color !== 'wild'
        && card.color === topCard.color
        && card.type === topCard.type
        && card.value === topCard.value;
    })
    .filter((card) => isCardPlayable(state, playerId, card.id)
      || (activePlayerId !== playerId && state.rules.jumpIn))
    .map((card) => card.id);

  return {
    status: state.status,
    matchId: room.matchId ?? null,
    players: state.players.map((player) => {
      const finishIndex = finishOrder.indexOf(player.id);
      return {
        id: player.id,
        name: player.name,
        cardCount: state.hands[player.id].length,
        finishPlace: finishIndex === -1 ? null : finishIndex + 1,
        isBot: room.players.find((candidate) => candidate.id === player.id)?.isBot ?? false,
      };
    }),
    currentPlayerId: getCurrentPlayerId(state),
    direction: state.direction,
    currentColor: state.currentColor,
    topCard,
    drawPileCount: state.drawPile.length,
    discardPileCount: state.discardPile.length,
    pendingDraw: state.pendingDraw,
    turnTimerDeadline: room.turnTimerDeadline ?? null,
    drawnCardId: getCurrentPlayerId(state) === playerId ? state.drawnCardId : null,
    hand: [...state.hands[playerId]],
    finishOrder,
    playableCardIds,
    scoreboard: { ...state.scoreboard },
    roundNumber: state.roundNumber,
    winnerId: state.winnerId,
    matchWinnerId: state.matchWinnerId,
    roundScore: state.roundScore,
    rules: state.rules,
    unoWindow: state.unoWindow?.deadlineAt > Date.now()
      ? { ...state.unoWindow }
      : null,
    lastAction: projectLastAction(state.lastAction),
    colorChoiceRequired: room.pendingColor?.playerId === playerId,
    colorChoiceCardId: room.pendingColor?.playerId === playerId
      ? room.pendingColor.cardIds?.[room.pendingColor.cardIds.length - 1] ?? room.pendingColor.cardId
      : null,
    colorChoiceCardIds: room.pendingColor?.playerId === playerId
      ? [...(room.pendingColor.cardIds ?? [room.pendingColor.cardId])]
      : [],
  };
}

function isWild(card) {
  return card.type === 'wild' || card.type === 'wild_draw_four';
}

function projectLastAction(action) {
  if (!action) {
    return null;
  }
  const { cardIds, ...publicAction } = action;
  if (Array.isArray(cardIds)) {
    publicAction.count = cardIds.length;
  }
  return publicAction;
}

export function registerGameSocket(io, existingManager) {
  const rateLimits = new Map();

  function emitRoomUpdate(room) {
    io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('room:updated', projectRoom(room));
  }

  const manager = existingManager ?? createRoomManager({
    onDisconnectedExpired: ({ room, playerId, roomRemoved }) => {
      if (roomRemoved) {
        clearTurnTimer(room);
        io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('room:closed', { code: room.code });
        return;
      }
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('room:player-left', { playerId });
      emitRoomUpdate(room);
    },
  });

  function emitGameStates(room) {
    if (!room.gameState) {
      return;
    }
    for (const player of room.players) {
      if (player.isBot || !player.socketId) {
        continue;
      }
      io.to(player.socketId).emit('game:state-updated', projectGameState(room, player.id));
    }
  }

  function emitTurnChanged(room, previousPlayerId) {
    const currentPlayerId = getCurrentPlayerId(room.gameState);
    if (currentPlayerId !== previousPlayerId) {
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:turn-changed', {
        playerId: currentPlayerId,
      });
    }
  }

  function clearTurnTimer(room) {
    clearTimeout(room.turnTimerHandle);
    room.turnTimerHandle = null;
    room.turnTimerPlayerId = null;
    room.turnTimerDeadline = null;
  }

  function getBotDecision(room, playerId, difficulty = 'easy') {
    const state = room.gameState;
    const opponents = room.players
      .filter((player) => player.id !== playerId && state.hands[player.id].length > 0)
      .map((player) => ({ playerId: player.id, cardCount: state.hands[player.id].length }));
    return chooseBotAction({
      difficulty,
      hand: state.hands[playerId],
      topCard: state.discardPile[state.discardPile.length - 1],
      currentColor: state.currentColor,
      opponents,
      nextPlayerId: getNextPlayerId(state),
      pendingDraw: state.pendingDraw,
      drawnCardId: state.drawnCardId,
      unoRequired: state.unoWindow?.playerId === playerId && !state.unoWindow.declared,
      rules: state.rules,
    });
  }

  function scheduleTurnTimer(room, forceReset = false) {
    if (room.timerExpiring) {
      return;
    }
    if (room.status !== 'playing' || !room.gameState || room.gameState.status !== 'playing') {
      clearTurnTimer(room);
      return;
    }
    const seconds = room.gameState.rules.turnTimer;
    if (seconds === 0) {
      clearTurnTimer(room);
      return;
    }
    const playerId = getCurrentPlayerId(room.gameState);
    if (!forceReset && room.turnTimerHandle && room.turnTimerPlayerId === playerId) {
      return;
    }

    clearTurnTimer(room);
    room.turnTimerPlayerId = playerId;
    room.turnTimerDeadline = Date.now() + seconds * 1000;
    io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:timer-updated', {
      playerId,
      deadline: room.turnTimerDeadline,
    });
    room.turnTimerHandle = setTimeout(() => {
      room.turnTimerHandle = null;
      room.turnTimerPlayerId = null;
      room.turnTimerDeadline = null;
      void expireTimedTurn(room, playerId).catch((error) => {
        console.error(`Timed turn failed in room ${room.code}:`, error);
        io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('error', {
          code: 'TURN_TIMEOUT_FAILED',
          message: 'The timed turn could not be completed. Please try again.',
        });
      });
    }, seconds * 1000);
    room.turnTimerHandle.unref?.();
  }

  async function expireTimedTurn(room, playerId) {
    if (
      room.status !== 'playing'
      || room.gameState?.status !== 'playing'
      || getCurrentPlayerId(room.gameState) !== playerId
    ) {
      return;
    }

    room.timerExpiring = true;
    io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:timer-expired', { playerId });
    try {
      let actionCount = 0;
      while (
        room.gameState.status === 'playing'
        && getCurrentPlayerId(room.gameState) === playerId
        && actionCount < 4
      ) {
        actionCount += 1;
        const previousPlayerId = getCurrentPlayerId(room.gameState);

        if (room.pendingColor?.playerId === playerId) {
          const cardIds = room.pendingColor.cardIds ?? [room.pendingColor.cardId];
          const selectedCardIds = new Set(cardIds);
          const hand = room.gameState.hands[playerId];
          const colorCounts = ['red', 'yellow', 'green', 'blue'].map((color) => ({
            color,
            count: hand.filter(
              (card) => !selectedCardIds.has(card.id) && card.color === color,
            ).length,
          }));
          const colorChoice = colorCounts.reduce((best, current) => (
            current.count > best.count ? current : best
          )).color;
          room.gameState = playCards(room.gameState, playerId, cardIds, {
            colorChoice,
          });
          room.pendingColor = null;
          publishCardPlay(room, previousPlayerId, playerId, cardIds);
          if (room.gameState.unoWindow?.playerId === playerId && !room.gameState.unoWindow.declared) {
            room.gameState = declareUno(room.gameState, playerId);
            publishGameAction(room, getCurrentPlayerId(room.gameState), 'game:uno-declared', { playerId });
          }
          continue;
        }

        const action = getBotDecision(room, playerId);
        if (action.type === 'declare-uno') {
          room.gameState = declareUno(room.gameState, playerId);
          publishGameAction(room, previousPlayerId, 'game:uno-declared', { playerId });
          continue;
        }
        if (action.type === 'draw-card') {
          room.gameState = drawCard(room.gameState, playerId);
          const count = room.gameState.lastAction.cardIds?.length
            ?? room.gameState.lastAction.count
            ?? 0;
          publishGameAction(room, previousPlayerId, 'game:card-drawn', { playerId, count });
          continue;
        }
        if (action.type === 'pass-turn') {
          room.gameState = passTurn(room.gameState, playerId);
          publishGameAction(room, previousPlayerId, 'game:turn-passed', { playerId });
          continue;
        }
        if (action.type === 'play-card') {
          room.gameState = playCard(room.gameState, playerId, action.cardId, {
            colorChoice: action.colorChoice,
          });
          publishGameAction(room, previousPlayerId, 'game:card-played', {
            playerId,
            card: room.gameState.discardPile[room.gameState.discardPile.length - 1],
            color: room.gameState.currentColor,
          });
          if (room.gameState.unoWindow?.playerId === playerId && !room.gameState.unoWindow.declared) {
            room.gameState = declareUno(room.gameState, playerId);
            publishGameAction(room, getCurrentPlayerId(room.gameState), 'game:uno-declared', { playerId });
          }
          continue;
        }
        throw new Error(`Unknown timed-turn action: ${action.type}.`);
      }
    } finally {
      room.timerExpiring = false;
      scheduleTurnTimer(room, true);
      const currentPlayer = room.players.find(
        (player) => player.id === getCurrentPlayerId(room.gameState),
      );
      if (room.gameState.status === 'playing' && currentPlayer?.isBot) {
        void runBotTurns(room).catch((error) => {
          reportBotFailure(room, error);
        });
      }
    }
  }

  function emitError(socket, error) {
    if (error instanceof RoomError || error?.name === 'GameRuleError' || error instanceof TypeError || error instanceof RangeError) {
      socket.emit('error', { code: error.code ?? 'INVALID_ACTION', message: error.message });
      return;
    }
    console.error('Unexpected game socket error:', error);
    socket.emit('error', {
      code: 'INTERNAL_ERROR',
      message: 'The server could not complete that action. Please try again.',
    });
  }

  function handle(socket, event, allowedKeys, action) {
    socket.on(event, (payload = {}) => {
      const now = Date.now();
      const recent = (rateLimits.get(socket.id) ?? []).filter(
        (timestamp) => now - timestamp < EVENT_WINDOW_MS,
      );
      if (recent.length >= EVENT_LIMIT) {
        rateLimits.set(socket.id, recent);
        socket.emit('error', {
          code: 'RATE_LIMITED',
          message: 'Too many actions. Wait a moment and try again.',
        });
        return;
      }
      recent.push(now);
      rateLimits.set(socket.id, recent);

      try {
        assertPayload(payload, allowedKeys);
        action(payload);
      } catch (error) {
        emitError(socket, error);
      }
    });
  }

  function requireMembership(socket) {
    return manager.getRoomForSocket(socket.id);
  }

  function requireGameMembership(socket) {
    const membership = requireMembership(socket);
    if (membership.room.status !== 'playing' || !membership.room.gameState) {
      throw new RoomError('GAME_NOT_STARTED', 'The game has not started yet.');
    }
    return membership;
  }

  function publishRoomJoined(socket, result, eventName) {
    socket.data.playerId = result.player.id;
    socket.data.roomCode = result.room.code;
    socket.data.reconnectToken = result.reconnectToken;
    socket.join(`${ROOM_EVENT_PREFIX}${result.room.code}`);
    socket.emit(eventName, {
      room: projectRoom(result.room),
      playerId: result.player.id,
      reconnectToken: result.reconnectToken,
    });
    emitRoomUpdate(result.room);
  }

  function publishGameAction(room, previousPlayerId, event, payload) {
    io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit(event, payload);
    emitTurnChanged(room, previousPlayerId);
    if (room.gameState.status === 'finished') {
      clearTurnTimer(room);
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:finished', {
        winnerId: room.gameState.winnerId,
        matchWinnerId: room.gameState.matchWinnerId,
        roundScore: room.gameState.roundScore,
        finishOrder: [...room.gameState.finishOrder],
        scoreboard: { ...room.gameState.scoreboard },
      });
    }
    scheduleTurnTimer(
      room,
      event === 'game:card-played'
        || event === 'game:turn-passed'
        || getCurrentPlayerId(room.gameState) !== previousPlayerId,
    );
    emitGameStates(room);
    emitRoomUpdate(room);
  }

  function reportBotFailure(room, error, context = 'Bot turn failed') {
    console.error(`${context} in room ${room.code}:`, error);
    const reason = error instanceof Error ? error.message : String(error);
    io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('error', {
      code: 'BOT_ACTION_FAILED',
      message: `A bot could not complete its turn${reason ? `: ${reason}` : ''}. The host can restart the game.`,
    });
  }

  function publishCardPlay(room, previousPlayerId, playerId, cardIds) {
    const cards = room.gameState.discardPile.slice(-cardIds.length);
    publishGameAction(room, previousPlayerId, 'game:card-played', {
      playerId,
      card: cards[cards.length - 1],
      cards,
      color: room.gameState.currentColor,
    });
  }

  async function runBotTurns(room) {
    if (room.botProcessing || room.status !== 'playing') {
      return;
    }
    room.botProcessing = true;
    try {
      let actionCount = 0;
      let previousBotId = null;
      while (room.status === 'playing' && room.gameState.status === 'playing') {
        const playerId = getCurrentPlayerId(room.gameState);
        const bot = room.players.find((player) => player.id === playerId && player.isBot);
        if (!bot) {
          break;
        }
        if (actionCount >= 100) {
          throw new Error('Bot turn loop exceeded its safety limit.');
        }
        actionCount += 1;
        const delay = previousBotId === bot.id
          ? BOT_FOLLOW_UP_DELAY_MS
          : BOT_TURN_DELAY_MS;
        await new Promise((resolve) => setTimeout(resolve, delay));

        const state = room.gameState;
        if (room.status !== 'playing' || state?.status !== 'playing') {
          break;
        }
        if (getCurrentPlayerId(state) !== bot.id) {
          previousBotId = null;
          continue;
        }
        const opponents = room.players
          .filter((player) => player.id !== bot.id && state.hands[player.id].length > 0)
          .map((player) => ({ playerId: player.id, cardCount: state.hands[player.id].length }));
        const action = chooseBotAction({
          difficulty: bot.difficulty,
          hand: state.hands[bot.id],
          topCard: state.discardPile[state.discardPile.length - 1],
          currentColor: state.currentColor,
          opponents,
          nextPlayerId: getNextPlayerId(state),
          pendingDraw: state.pendingDraw,
          drawnCardId: state.drawnCardId,
          unoRequired: state.unoWindow?.playerId === bot.id && !state.unoWindow.declared,
          rules: state.rules,
        });
        const previousPlayerId = getCurrentPlayerId(state);

        if (action.type === 'declare-uno') {
          room.gameState = declareUno(state, bot.id);
          publishGameAction(room, previousPlayerId, 'game:uno-declared', { playerId: bot.id });
        } else if (action.type === 'draw-card') {
          room.gameState = drawCard(state, bot.id);
          publishGameAction(room, previousPlayerId, 'game:card-drawn', {
            playerId: bot.id,
            count: room.gameState.lastAction.cardIds?.length ?? room.gameState.lastAction.count ?? 0,
          });
        } else if (action.type === 'pass-turn') {
          room.gameState = passTurn(state, bot.id);
          publishGameAction(room, previousPlayerId, 'game:turn-passed', { playerId: bot.id });
        } else if (action.type === 'play-card') {
          room.gameState = playCard(state, bot.id, action.cardId, {
            colorChoice: action.colorChoice,
          });
          publishGameAction(room, previousPlayerId, 'game:card-played', {
            playerId: bot.id,
            card: room.gameState.discardPile[room.gameState.discardPile.length - 1],
            color: room.gameState.currentColor,
          });
        } else {
          throw new Error(`Unknown bot action: ${action.type}.`);
        }
        previousBotId = bot.id;
      }
    } finally {
      room.botProcessing = false;
    }
  }

  io.on('connection', (socket) => {
    socket.emit('server:ready', { socketId: socket.id });
    const reconnectToken = socket.handshake.auth?.reconnectToken;
    if (reconnectToken) {
      try {
        const result = manager.reconnect(reconnectToken, socket.id);
        socket.data.playerId = result.player.id;
        socket.data.roomCode = result.room.code;
        socket.data.reconnectToken = reconnectToken;
        socket.join(`${ROOM_EVENT_PREFIX}${result.room.code}`);
        socket.emit('player:reconnected', {
          room: projectRoom(result.room),
          playerId: result.player.id,
          reconnectToken,
        });
        emitRoomUpdate(result.room);
        emitGameStates(result.room);
      } catch (error) {
        if (
          error instanceof RoomError
          && ['INVALID_RECONNECT_TOKEN', 'RECONNECT_EXPIRED'].includes(error.code)
        ) {
          socket.emit('session:expired', { code: error.code });
        } else {
          emitError(socket, error);
        }
      }
    }

    handle(socket, 'room:create', ['name', 'rules'], ({ name, rules }) => {
      const result = manager.createRoom(socket.id, { name, rules });
      publishRoomJoined(socket, result, 'room:created');
    });

    handle(socket, 'room:join', ['code', 'name'], ({ code, name }) => {
      const result = manager.joinRoom(socket.id, { code, name });
      publishRoomJoined(socket, result, 'room:joined');
      io.to(`${ROOM_EVENT_PREFIX}${result.room.code}`).emit('room:player-joined', {
        player: projectRoom(result.room).players.find((player) => player.id === result.player.id),
      });
    });

    handle(socket, 'room:add-bot', ['difficulty'], ({ difficulty }) => {
      const { room, player } = manager.addBot(socket.id, { difficulty });
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('room:player-joined', {
        player: projectRoom(room).players.find((candidate) => candidate.id === player.id),
      });
      emitRoomUpdate(room);
    });

    handle(socket, 'room:remove-bot', ['botId'], ({ botId }) => {
      const room = manager.removeBot(socket.id, botId);
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('room:player-left', { playerId: botId });
      emitRoomUpdate(room);
    });

    handle(socket, 'room:ready', ['ready'], ({ ready }) => {
      const room = manager.setReady(socket.id, ready);
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('room:updated', projectRoom(room));
    });

    handle(socket, 'room:leave', [], () => {
      const { player } = requireMembership(socket);
      const playerId = player.id;
      const { room, removed } = manager.leaveRoom(socket.id);
      const roomName = `${ROOM_EVENT_PREFIX}${room.code}`;
      if (removed) {
        io.to(roomName).emit('room:closed', { code: room.code });
        for (const remainingPlayer of room.players) {
          const remainingSocket = io.sockets.sockets.get(remainingPlayer.socketId);
          if (remainingSocket) {
            remainingSocket.leave(roomName);
            delete remainingSocket.data.playerId;
            delete remainingSocket.data.roomCode;
            delete remainingSocket.data.reconnectToken;
          }
        }
      } else {
        io.to(roomName).emit('room:player-left', { playerId });
        emitRoomUpdate(room);
      }
      socket.leave(roomName);
      delete socket.data.playerId;
      delete socket.data.roomCode;
      delete socket.data.reconnectToken;
    });

    handle(socket, 'game:start', [], () => {
      const room = manager.startGame(socket.id);
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:started', {
        room: projectRoom(room),
        currentPlayerId: getCurrentPlayerId(room.gameState),
      });
      emitGameStates(room);
      emitRoomUpdate(room);
      scheduleTurnTimer(room, true);
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error);
      });
    });

    handle(socket, 'game:next-round', [], () => {
      const room = manager.startNextRound(socket.id);
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:round-started', {
        roundNumber: room.gameState.roundNumber,
        currentPlayerId: getCurrentPlayerId(room.gameState),
      });
      emitGameStates(room);
      emitRoomUpdate(room);
      scheduleTurnTimer(room, true);
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error);
      });
    });

    handle(socket, 'game:rematch', [], () => {
      const room = manager.rematchGame(socket.id);
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('game:match-rematched', {
        matchId: room.matchId,
        roundNumber: room.gameState.roundNumber,
        currentPlayerId: getCurrentPlayerId(room.gameState),
      });
      emitGameStates(room);
      emitRoomUpdate(room);
      scheduleTurnTimer(room, true);
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error, 'Bot rematch failed');
      });
    });

    handle(socket, 'game:request-state', [], () => {
      const { room, player } = requireMembership(socket);
      socket.emit('room:updated', projectRoom(room));
      if (room.gameState) {
        socket.emit('game:state-updated', projectGameState(room, player.id));
      }
    });

    handle(socket, 'game:play-card', [
      'cardId',
      'cardIds',
      'colorChoice',
    ], (payload) => {
      const { room, player } = requireGameMembership(socket);
      if (room.pendingColor) {
        throw new RoomError('COLOR_SELECTION_PENDING', 'Choose a color to finish the Wild card play.');
      }
      const state = room.gameState;
      if (payload.cardId !== undefined && payload.cardIds !== undefined) {
        throw new RoomError('INVALID_PAYLOAD', 'Send either cardId or cardIds, not both.');
      }
      const cardIds = payload.cardIds ?? [payload.cardId];
      if (
        !Array.isArray(cardIds)
        || cardIds.length === 0
        || cardIds.length > 108
        || cardIds.some((cardId) => typeof cardId !== 'string' || cardId.trim() === '')
        || new Set(cardIds).size !== cardIds.length
      ) {
        throw new RoomError('INVALID_PAYLOAD', 'Choose one or more distinct cards to play.');
      }
      const cards = cardIds.map(
        (cardId) => state.hands[player.id]?.find((candidate) => candidate.id === cardId),
      );
      if (cards.some((card) => !card)) {
        throw new RoomError('CARD_NOT_IN_HAND', 'This card is not in your hand.');
      }
      const lastCard = cards[cards.length - 1];
      if (isWild(lastCard) && payload.colorChoice === undefined) {
        playCards(state, player.id, cardIds, {
          colorChoice: 'red',
        });
        room.pendingColor = {
          playerId: player.id,
          cardId: lastCard.id,
          cardIds: [...cardIds],
        };
        emitGameStates(room);
        return;
      }

      const previousPlayerId = getCurrentPlayerId(state);
      room.gameState = playCards(state, player.id, cardIds, {
        colorChoice: payload.colorChoice,
      });
      room.pendingColor = null;
      publishCardPlay(room, previousPlayerId, player.id, cardIds);
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error);
      });
    });

    handle(socket, 'game:choose-color', ['color'], ({ color }) => {
      const { room, player } = requireGameMembership(socket);
      if (!room.pendingColor || room.pendingColor.playerId !== player.id) {
        throw new RoomError('COLOR_SELECTION_NOT_AVAILABLE', 'You do not have a pending color selection.');
      }
      const pendingCardIds = room.pendingColor.cardIds ?? [room.pendingColor.cardId];
      const previousPlayerId = getCurrentPlayerId(room.gameState);
      room.gameState = playCards(room.gameState, player.id, pendingCardIds, {
        colorChoice: color,
      });
      room.pendingColor = null;
      publishCardPlay(room, previousPlayerId, player.id, pendingCardIds);
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error);
      });
    });

    handle(socket, 'game:draw-card', [], () => {
      const { room, player } = requireGameMembership(socket);
      if (room.pendingColor) {
        throw new RoomError('COLOR_SELECTION_PENDING', 'Choose a color to finish the Wild card play.');
      }
      const previousPlayerId = getCurrentPlayerId(room.gameState);
      room.gameState = drawCard(room.gameState, player.id);
      const drawnCount = room.gameState.lastAction.cardIds?.length
        ?? room.gameState.lastAction.count
        ?? 0;
      publishGameAction(room, previousPlayerId, 'game:card-drawn', {
        playerId: player.id,
        count: drawnCount,
      });
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error);
      });
    });

    handle(socket, 'game:pass-turn', [], () => {
      const { room, player } = requireGameMembership(socket);
      if (room.pendingColor) {
        throw new RoomError('COLOR_SELECTION_PENDING', 'Choose a color to finish the Wild card play.');
      }
      const previousPlayerId = getCurrentPlayerId(room.gameState);
      room.gameState = passTurn(room.gameState, player.id);
      publishGameAction(room, previousPlayerId, 'game:turn-passed', { playerId: player.id });
      void runBotTurns(room).catch((error) => {
        reportBotFailure(room, error);
      });
    });

    handle(socket, 'game:declare-uno', [], () => {
      const { room, player } = requireGameMembership(socket);
      const previousPlayerId = getCurrentPlayerId(room.gameState);
      room.gameState = declareUno(room.gameState, player.id);
      publishGameAction(room, previousPlayerId, 'game:uno-declared', {
        playerId: player.id,
      });
    });

    handle(socket, 'game:catch-uno', [], () => {
      const { room, player } = requireGameMembership(socket);
      if (room.pendingColor) {
        throw new RoomError('COLOR_SELECTION_PENDING', 'Wait for the Wild card color to be chosen.');
      }
      const previousPlayerId = getCurrentPlayerId(room.gameState);
      const caughtPlayerId = room.gameState.unoWindow?.playerId;
      room.gameState = catchUno(room.gameState, player.id);
      publishGameAction(room, previousPlayerId, 'game:uno-caught', {
        playerId: player.id,
        caughtPlayerId,
        count: room.gameState.lastAction.count,
      });
    });

    handle(socket, 'chat:send', ['message'], ({ message }) => {
      const { room, player } = requireMembership(socket);
      if (typeof message !== 'string' || !message.trim() || message.trim().length > 250) {
        throw new RoomError('INVALID_CHAT_MESSAGE', 'Chat messages must be 1 to 250 characters.');
      }
      io.to(`${ROOM_EVENT_PREFIX}${room.code}`).emit('chat:received', {
        playerId: player.id,
        name: player.name,
        message: message.trim(),
        sentAt: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      rateLimits.delete(socket.id);
      const result = manager.disconnect(socket.id);
      if (!result) {
        return;
      }
      io.to(`${ROOM_EVENT_PREFIX}${result.room.code}`).emit('player:disconnected', {
        playerId: result.player.id,
      });
      emitRoomUpdate(result.room);
    });
  });

  return manager;
}
