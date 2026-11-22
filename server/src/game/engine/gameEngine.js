import { COLORS, cardPoints, createDeck, dealCards, shuffleDeck } from './deck.js';
import { normalizeCustomRules } from '../rules/customRules.js';

export const UNO_CALL_WINDOW_MS = 5000;

export class GameRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GameRuleError';
    this.code = code;
  }
}

function ruleError(code, message) {
  throw new GameRuleError(code, message);
}

function normalizePlayers(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    ruleError('INVALID_PLAYER_COUNT', 'A game needs between two and four players.');
  }

  const normalized = players.map((player) => {
    if (!player || typeof player.id !== 'string' || player.id.trim() === '') {
      ruleError('INVALID_PLAYER', 'Every player needs a non-empty id.');
    }
    return {
      id: player.id,
      name: typeof player.name === 'string' && player.name.trim() ? player.name : player.id,
    };
  });

  if (new Set(normalized.map((player) => player.id)).size !== normalized.length) {
    ruleError('DUPLICATE_PLAYER', 'Player ids must be unique.');
  }

  return normalized;
}

function cloneState(state) {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    hands: Object.fromEntries(
      Object.entries(state.hands).map(([playerId, hand]) => [playerId, [...hand]]),
    ),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    scoreboard: { ...state.scoreboard },
    finishOrder: [...state.finishOrder],
    pendingFinishPlayerIds: [...state.pendingFinishPlayerIds],
    unoWindow: state.unoWindow ? { ...state.unoWindow } : null,
    lastAction: state.lastAction ? { ...state.lastAction } : null,
  };
}

function getPlayerIndex(state, playerId) {
  return state.players.findIndex((player) => player.id === playerId);
}

function assertPlaying(state) {
  if (state.status !== 'playing') {
    ruleError('GAME_OVER', 'This game is already finished.');
  }
}

function assertCurrentPlayer(state, playerId) {
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isPendingFinisher = state.pendingDraw > 0
    && state.pendingFinishPlayerIds.includes(playerId);
  if (
    !currentPlayer
    || currentPlayer.id !== playerId
    || state.finishOrder.includes(playerId)
    || (state.hands[playerId]?.length === 0 && !isPendingFinisher)
  ) {
    ruleError('OUT_OF_TURN', 'It is not this player’s turn.');
  }
}

function getActivePlayerIds(state) {
  return state.players
    .filter((player) => (
      !state.finishOrder.includes(player.id)
      && (
        state.hands[player.id]?.length > 0
        || (
          state.pendingDraw > 0
          && state.pendingFinishPlayerIds.includes(player.id)
        )
      )
    ))
    .map((player) => player.id);
}

function nextActiveIndex(state, fromIndex = state.currentPlayerIndex, steps = 1) {
  const count = state.players.length;

  // First pass: prefer players with cards in hand (strict active).
  let index = fromIndex;
  let activeSteps = 0;
  let attempts = 0;
  while (activeSteps < steps && attempts < count * steps) {
    index = (index + state.direction + count) % count;
    attempts += 1;
    const playerId = state.players[index].id;
    if (
      !state.finishOrder.includes(playerId)
      && state.hands[playerId]?.length > 0
    ) {
      activeSteps += 1;
    }
  }
  if (activeSteps === steps) return index;

  // Fallback: when no player with cards exists, include pendingFinishPlayerIds
  // so that a player who finished on a draw card can still receive their draw.
  index = fromIndex;
  activeSteps = 0;
  attempts = 0;
  while (activeSteps < steps && attempts < count * steps) {
    index = (index + state.direction + count) % count;
    attempts += 1;
    const playerId = state.players[index].id;
    if (
      !state.finishOrder.includes(playerId)
      && (
        state.hands[playerId]?.length > 0
        || (state.pendingDraw > 0 && state.pendingFinishPlayerIds.includes(playerId))
      )
    ) {
      activeSteps += 1;
    }
  }
  return activeSteps === steps ? index : fromIndex;
}

function drawFromPiles(drawPile, discardPile, count, random) {
  const remainingDrawPile = [...drawPile];
  const remainingDiscardPile = [...discardPile];
  const cards = [];

  while (cards.length < count) {
    if (remainingDrawPile.length === 0) {
      if (remainingDiscardPile.length <= 1) {
        break;
      }

      const topCard = remainingDiscardPile.pop();
      remainingDrawPile.push(...shuffleDeck(remainingDiscardPile, random));
      remainingDiscardPile.splice(0, remainingDiscardPile.length, topCard);
    }

    if (remainingDrawPile.length > 0) {
      cards.push(remainingDrawPile.pop());
    }
  }

  return {
    cards,
    drawPile: remainingDrawPile,
    discardPile: remainingDiscardPile,
  };
}

function clearExpiredUnoWindow(state, actingPlayerId) {
  if (state.unoWindow && state.unoWindow.playerId !== actingPlayerId) {
    state.unoWindow = null;
  }
}

function rankPlayer(state, playerId) {
  if (state.finishOrder.includes(playerId)) {
    return;
  }

  state.finishOrder.push(playerId);
  if (!state.winnerId) {
    state.winnerId = playerId;
    state.roundScore = calculateRoundScore(state, playerId);
  }
  state.lastAction = {
    type: 'player-finished',
    playerId,
    place: state.finishOrder.length,
  };
}

function finishGame(state) {
  state.status = 'finished';
  state.scoreboard[state.winnerId] += state.roundScore;
  state.matchWinnerId = state.rules.targetScore > 0
    && state.scoreboard[state.winnerId] >= state.rules.targetScore
    ? state.winnerId
    : null;
  state.unoWindow = null;
  state.pendingDraw = 0;
  state.pendingWinnerId = null;
  state.pendingFinishPlayerIds = [];
  state.lastAction = {
    type: 'game-finished',
    playerId: state.winnerId,
    score: state.roundScore,
    finishOrder: [...state.finishOrder],
  };
}

function finishRoundIfReady(state) {
  if (state.pendingFinishPlayerIds.length > 0) {
    return;
  }

  const activePlayerIds = getActivePlayerIds(state);
  if (activePlayerIds.length > 1) {
    const currentPlayerId = getCurrentPlayerId(state);
    if (!activePlayerIds.includes(currentPlayerId)) {
      state.currentPlayerIndex = nextActiveIndex(state, state.currentPlayerIndex);
    }
    return;
  }
  if (activePlayerIds.length === 1) {
    state.finishOrder.push(activePlayerIds[0]);
  }
  if (state.finishOrder.length === state.players.length) {
    finishGame(state);
  }
}

function queueFinisher(state, playerId) {
  if (!state.pendingFinishPlayerIds.includes(playerId)) {
    state.pendingFinishPlayerIds.push(playerId);
  }
  state.pendingWinnerId ??= playerId;
}

function resolvePendingFinishers(state) {
  const pendingFinishers = state.pendingFinishPlayerIds;
  state.pendingFinishPlayerIds = [];
  state.pendingWinnerId = null;
  for (const playerId of pendingFinishers) {
    rankPlayer(state, playerId);
  }
  finishRoundIfReady(state);
}

export function createGame({ players, random = Math.random, rules = {} }) {
  const customRules = normalizeCustomRules(rules);
  return createGameFromDeck(
    players,
    shuffleDeck(createDeck(), random),
    customRules.startingHand,
    customRules,
  );
}

export function createGameFromDeck(players, deck, handSize = 7, customRules = {}) {
  const normalizedPlayers = normalizePlayers(players);
  if (!customRules || typeof customRules !== 'object' || Array.isArray(customRules)) {
    ruleError('INVALID_CUSTOM_RULES', 'Custom rules must be an object.');
  }
  const rules = normalizeCustomRules({
    ...customRules,
    startingHand: customRules.startingHand ?? handSize,
  });
  if (normalizedPlayers.length > rules.maximumPlayers) {
    ruleError('MAXIMUM_PLAYERS_EXCEEDED', 'The player count exceeds this room’s maximum.');
  }

  const { hands, remainingDeck } = dealCards(normalizedPlayers, deck, rules.startingHand);
  const startingCardIndex = remainingDeck.findIndex((card) => card.type === 'number');

  if (startingCardIndex === -1) {
    ruleError('NO_STARTING_CARD', 'The deck must contain a number card to start.');
  }

  const [startingCard] = remainingDeck.splice(startingCardIndex, 1);

  return {
    players: normalizedPlayers,
    rules,
    hands,
    drawPile: remainingDeck,
    discardPile: [startingCard],
    currentPlayerIndex: 0,
    direction: 1,
    currentColor: startingCard.color,
    drawnCardId: null,
    pendingDraw: 0,
    pendingWinnerId: null,
    pendingFinishPlayerIds: [],
    unoWindow: null,
    status: 'playing',
    winnerId: null,
    roundScore: null,
    finishOrder: [],
    scoreboard: Object.fromEntries(normalizedPlayers.map((player) => [player.id, 0])),
    matchWinnerId: null,
    roundNumber: 1,
    lastAction: { type: 'game-started', playerId: normalizedPlayers[0].id },
  };
}

export function startNextRound(state, random = Math.random) {
  if (state.status !== 'finished') {
    ruleError('ROUND_NOT_FINISHED', 'The current round must finish before starting another.');
  }
  if (state.matchWinnerId) {
    ruleError('MATCH_FINISHED', 'The target score has been reached.');
  }

  const next = createGame({
    players: state.players,
    random,
    rules: state.rules,
  });
  next.scoreboard = { ...state.scoreboard };
  next.roundNumber = state.roundNumber + 1;
  return next;
}

export function getCurrentPlayerId(state) {
  return state.players[state.currentPlayerIndex]?.id ?? null;
}

export function getNextPlayerId(state, playerId = getCurrentPlayerId(state)) {
  const playerIndex = getPlayerIndex(state, playerId);
  if (playerIndex === -1) {
    return null;
  }
  return state.players[nextActiveIndex(state, playerIndex)]?.id ?? null;
}

export function isCardPlayable(state, playerId, cardId) {
  const hand = state.hands[playerId];
  const card = hand?.find((candidate) => candidate.id === cardId);
  const topCard = state.discardPile[state.discardPile.length - 1];

  if (!card || !topCard) {
    return false;
  }
  if (
    state.pendingDraw > 0
    && state.rules.stackingDrawCards
    && (card.type === 'draw2' || card.type === 'wild_draw_four')
  ) {
    return true;
  }
  if (state.pendingDraw > 0) {
    return false;
  }
  if (card.type === 'wild') {
    return true;
  }
  if (card.type === 'wild_draw_four') {
    return true;
  }
  return card.color === state.currentColor || card.value === topCard.value;
}

export function playCard(state, playerId, cardId, options = {}, random = Math.random, now = Date.now()) {
  return playCards(state, playerId, [cardId], options, random, now);
}

export function playCards(state, playerId, cardIds, options = {}, random = Math.random, now = Date.now()) {
  assertPlaying(state);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    ruleError('INVALID_OPTIONS', 'Play options must be an object.');
  }
  const unexpectedOption = Object.keys(options).find(
    (key) => key !== 'colorChoice',
  );
  if (unexpectedOption) {
    ruleError('INVALID_OPTIONS', `Unknown play option: ${unexpectedOption}.`);
  }

  const hand = state.hands[playerId];
  if (!hand) {
    ruleError('UNKNOWN_PLAYER', 'This player is not part of the game.');
  }
  if (
    !Array.isArray(cardIds)
    || cardIds.length === 0
    || cardIds.some((cardId) => typeof cardId !== 'string' || cardId.trim() === '')
    || new Set(cardIds).size !== cardIds.length
  ) {
    ruleError('INVALID_CARD_LIST', 'Choose one or more distinct cards to play.');
  }
  const cards = cardIds.map((cardId) => hand.find((candidate) => candidate.id === cardId));
  if (cards.some((card) => !card)) {
    ruleError('CARD_NOT_IN_HAND', 'This card is not in the player’s hand.');
  }
  const card = cards[0];
  const lastCard = cards[cards.length - 1];
  const isNumberGroup = cards.every(
    (candidate) => candidate.type === 'number' && candidate.value === card.value,
  );
  const isDrawGroup = cards.every(
    (candidate) => candidate.type === 'draw2' || candidate.type === 'wild_draw_four',
  );
  if (cardIds.length > 1 && !isNumberGroup && !isDrawGroup) {
    ruleError('INVALID_CARD_COMBO', 'Only cards with the same number or draw cards can be combined.');
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const activePlayerCount = getActivePlayerIds(state).length;
  const isCurrentPlayer = state.currentPlayerIndex === playerIndex;
  const selectedCardIds = new Set(cardIds);
  const topCard = state.discardPile[state.discardPile.length - 1];
  const isJumpIn = !isCurrentPlayer
    && state.rules.jumpIn
    && state.pendingDraw === 0
    && card.color !== 'wild'
    && card.color === topCard.color
    && card.type === topCard.type
    && card.value === topCard.value;

  if (!isCurrentPlayer && !isJumpIn) {
    ruleError('OUT_OF_TURN', 'It is not this player’s turn.');
  }
  if (state.pendingDraw > 0 && !state.rules.stackingDrawCards) {
    ruleError('DRAW_PENALTY_ACTIVE', 'The draw penalty must be taken before playing.');
  }
  if (
    state.pendingDraw > 0
    && !isDrawGroup
  ) {
    ruleError('MUST_STACK_OR_DRAW', 'Only a draw card can be played to stack a penalty.');
  }
  if (
    state.drawnCardId
    && (cardIds.length !== 1 || state.drawnCardId !== cardIds[0])
  ) {
    ruleError('MUST_PLAY_DRAWN_CARD', 'Only the card drawn this turn may be played.');
  }

  const firstCardPlayable = isCardPlayable(state, playerId, card.id);
  if (!firstCardPlayable) {
    ruleError('INVALID_MOVE', 'This card does not match the active color or top card.');
  }

  const isWild = lastCard.type === 'wild' || lastCard.type === 'wild_draw_four';
  const chosenColor = options.colorChoice;
  if (isWild && !COLORS.includes(chosenColor)) {
    ruleError('COLOR_REQUIRED', 'Choose a color when playing a Wild card.');
  }
  if (!isWild && chosenColor !== undefined) {
    ruleError('UNEXPECTED_COLOR', 'A color can only be chosen for a Wild card.');
  }

  const next = cloneState(state);
  clearExpiredUnoWindow(next, playerId);
  next.currentPlayerIndex = playerIndex;
  next.hands[playerId] = next.hands[playerId].filter(
    (candidate) => !selectedCardIds.has(candidate.id),
  );
  next.discardPile.push(...cards);
  next.currentColor = isWild ? chosenColor : lastCard.color;
  next.drawnCardId = null;

  const nextHand = next.hands[playerId];
  next.unoWindow = nextHand.length === 1
    ? { playerId, declared: false, deadlineAt: now + UNO_CALL_WINDOW_MS }
    : nextHand.length === 0
      ? null
      : next.unoWindow;
  next.lastAction = {
    type: 'card-played',
    playerId,
    cardId: lastCard.id,
    ...(cardIds.length > 1 ? { cardIds: [...cardIds] } : {}),
    color: next.currentColor,
    jumpIn: isJumpIn,
  };

  if (card.type === 'skip') {
    next.currentPlayerIndex = nextActiveIndex(next, playerIndex, 2);
  } else if (card.type === 'reverse') {
    next.direction *= -1;
    next.currentPlayerIndex = activePlayerCount === 2 && nextHand.length > 0
      ? playerIndex
      : nextActiveIndex(next, playerIndex);
  } else if (isDrawGroup) {
    const penalty = cards.reduce(
      (total, candidate) => total + (candidate.type === 'draw2' ? 2 : 4),
      0,
    );
    if (next.rules.stackingDrawCards) {
      next.pendingDraw += penalty;
      const targetIndex = nextActiveIndex(next, playerIndex);
      const targetId = next.players[targetIndex].id;
      // If the next player found is in pendingFinishPlayerIds (0 cards, finished on a draw),
      // AND the current player still has cards (meaning they tried to stack onto a finished
      // player with no one else to pass to), force the current player to take the penalty.
      const targetIsFinishing = next.pendingFinishPlayerIds.includes(targetId);
      if (targetIsFinishing && nextHand.length > 0) {
        // Current player still has cards but tried to stack onto a finished player.
        // No valid stacking target — force the current player to draw immediately.
        const result = drawFromPiles(next.drawPile, next.discardPile, next.pendingDraw, random);
        next.hands[playerId].push(...result.cards);
        next.drawPile = result.drawPile;
        next.discardPile = result.discardPile;
        next.pendingDraw = 0;
        next.lastAction = {
          type: 'draw-penalty',
          playerId,
          targetId: playerId,
          count: result.cards.length,
          cardId: lastCard.id,
        };
        // Resolve pending finishers FIRST (e.g. bot that played last draw card),
        // then advance turn only if the game is still ongoing.
        resolvePendingFinishers(next);
        if (next.status === 'playing') {
          next.currentPlayerIndex = nextActiveIndex(next, playerIndex);
        }
      } else {
        next.currentPlayerIndex = targetIndex;
        next.lastAction = {
          type: 'draw-penalty-pending',
          playerId,
          targetId,
          count: next.pendingDraw,
          cardId: lastCard.id,
        };
      }
    } else {
      const targetIndex = nextActiveIndex(next, playerIndex);
      const targetId = next.players[targetIndex].id;
      const result = drawFromPiles(next.drawPile, next.discardPile, penalty, random);
      next.hands[targetId].push(...result.cards);
      next.drawPile = result.drawPile;
      next.discardPile = result.discardPile;
      next.currentPlayerIndex = nextActiveIndex(next, targetIndex);
      next.lastAction = {
        type: 'draw-penalty',
        playerId,
        targetId,
        count: result.cards.length,
        cardId: lastCard.id,
      };
    }
  } else {
    next.currentPlayerIndex = nextActiveIndex(next, playerIndex);
  }

  if (nextHand.length === 0) {
    // A player who plays their last card wins immediately, regardless of card type.
    // If it was a draw card, pendingDraw is already set for the next player but
    // finishGame will clear it — the opponent does not draw when the round ends.
    rankPlayer(next, playerId);
    finishRoundIfReady(next);
  }

  return next;
}

export function drawCard(state, playerId, random = Math.random) {
  assertPlaying(state);
  assertCurrentPlayer(state, playerId);
  if (state.drawnCardId) {
    ruleError('ALREADY_DREW', 'This player has already drawn a card this turn.');
  }

  const next = cloneState(state);
  clearExpiredUnoWindow(next, playerId);

  if (next.pendingDraw > 0) {
    // Stacked penalties draw as a fixed batch; draw-until-playable applies to normal draws.
    const count = next.pendingDraw;
    const result = drawFromPiles(next.drawPile, next.discardPile, count, random);
    next.hands[playerId].push(...result.cards);
    next.drawPile = result.drawPile;
    next.discardPile = result.discardPile;
    next.pendingDraw = 0;
    next.currentPlayerIndex = nextActiveIndex(next, next.currentPlayerIndex);
    next.lastAction = {
      type: 'draw-penalty',
      playerId,
      count: result.cards.length,
    };
    resolvePendingFinishers(next);
    return next;
  }

  let drawPile = next.drawPile;
  let discardPile = next.discardPile;
  const drawnCards = [];
  let playableCardFound = false;

  while (true) {
    const drawn = drawFromPiles(drawPile, discardPile, 1, random);
    if (drawn.cards.length === 0) {
      break;
    }
    const [card] = drawn.cards;
    drawnCards.push(card);
    next.hands[playerId].push(card);
    drawPile = drawn.drawPile;
    discardPile = drawn.discardPile;
    playableCardFound = isCardPlayable(next, playerId, card.id);

    if (!next.rules.drawUntilPlayable || playableCardFound) {
      break;
    }
  }

  if (drawnCards.length === 0) {
    ruleError('DRAW_PILE_EMPTY', 'There are no cards available to draw.');
  }

  next.drawPile = drawPile;
  next.discardPile = discardPile;
  next.drawnCardId = drawnCards[drawnCards.length - 1].id;
  next.lastAction = {
    type: 'card-drawn',
    playerId,
    cardIds: drawnCards.map((card) => card.id),
  };
  return next;
}

export function passTurn(state, playerId) {
  assertPlaying(state);
  assertCurrentPlayer(state, playerId);
  if (!state.drawnCardId) {
    ruleError('DRAW_REQUIRED', 'Draw a card before ending this turn.');
  }
  if (state.pendingDraw > 0) {
    ruleError('DRAW_PENALTY_ACTIVE', 'The draw penalty must be resolved before ending this turn.');
  }
  if (
    state.rules.forcePlay
    && isCardPlayable(state, playerId, state.drawnCardId)
  ) {
    ruleError('FORCE_PLAY_REQUIRED', 'Play the playable card you just drew.');
  }

  const next = cloneState(state);
  clearExpiredUnoWindow(next, playerId);
  next.currentPlayerIndex = nextActiveIndex(next);
  next.drawnCardId = null;
  next.lastAction = { type: 'turn-passed', playerId };
  return next;
}

export function declareUno(state, playerId, now = Date.now()) {
  assertPlaying(state);
  if (state.hands[playerId]?.length !== 1) {
    ruleError('UNO_NOT_AVAILABLE', 'A player can declare UNO only while holding one card.');
  }
  if (!state.unoWindow || state.unoWindow.playerId !== playerId) {
    ruleError('UNO_WINDOW_CLOSED', 'The UNO declaration window is no longer open.');
  }
  if (state.unoWindow.declared) {
    ruleError('UNO_ALREADY_DECLARED', 'UNO has already been declared for this turn.');
  }
  if (!Number.isFinite(state.unoWindow.deadlineAt) || state.unoWindow.deadlineAt <= now) {
    ruleError('UNO_WINDOW_EXPIRED', 'The UNO declaration window has expired.');
  }

  const next = cloneState(state);
  next.unoWindow.declared = true;
  next.lastAction = { type: 'uno-declared', playerId };
  return next;
}

export function catchUno(state, catcherId, random = Math.random, now = Date.now()) {
  assertPlaying(state);
  const window = state.unoWindow;
  if (!window) {
    ruleError('UNO_WINDOW_CLOSED', 'There is no open UNO call to catch.');
  }
  if (window.declared) {
    ruleError('UNO_ALREADY_DECLARED', 'UNO has already been declared.');
  }
  if (!state.hands[catcherId]) {
    ruleError('UNKNOWN_PLAYER', 'This player is not part of the game.');
  }
  if (catcherId === window.playerId) {
    ruleError('UNO_CANNOT_CATCH_SELF', 'You cannot catch your own missed UNO.');
  }
  if (state.finishOrder.includes(catcherId) || state.hands[catcherId].length === 0) {
    ruleError('PLAYER_ALREADY_FINISHED', 'A finished player cannot catch UNO.');
  }
  if (!Number.isFinite(window.deadlineAt) || window.deadlineAt <= now) {
    ruleError('UNO_WINDOW_EXPIRED', 'The UNO catch window has expired.');
  }
  if (state.hands[window.playerId]?.length !== 1) {
    ruleError('UNO_WINDOW_CLOSED', 'The player no longer has one card.');
  }

  const result = drawFromPiles(state.drawPile, state.discardPile, 2, random);
  if (result.cards.length !== 2) {
    ruleError('DRAW_PILE_EMPTY', 'There are not enough cards to apply the UNO penalty.');
  }

  const next = cloneState(state);
  next.hands[window.playerId].push(...result.cards);
  next.drawPile = result.drawPile;
  next.discardPile = result.discardPile;
  next.unoWindow = null;
  next.lastAction = {
    type: 'uno-caught',
    playerId: catcherId,
    caughtPlayerId: window.playerId,
    count: result.cards.length,
  };
  return next;
}

export function calculateRoundScore(state, winnerId) {
  if (!state.players.some((player) => player.id === winnerId)) {
    ruleError('INVALID_WINNER', 'Winner must be a player in this game.');
  }

  return state.players
    .filter((player) => player.id !== winnerId)
    .flatMap((player) => state.hands[player.id])
    .reduce((score, card) => score + cardPoints(card), 0);
}
