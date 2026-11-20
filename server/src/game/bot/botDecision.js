import { COLORS } from '../engine/deck.js';

const WILD_TYPES = new Set(['wild', 'wild_draw_four']);
const DRAW_TYPES = new Set(['draw2', 'wild_draw_four']);

function randomIndex(length, random) {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Random-number function must return a value in [0, 1).');
  }
  return Math.floor(sample * length);
}

function isPlayable(card, { topCard, currentColor, pendingDraw, rules }) {
  if (pendingDraw > 0) {
    return rules.stackingDrawCards && DRAW_TYPES.has(card.type);
  }
  if (card.type === 'wild') {
    return true;
  }
  if (card.type === 'wild_draw_four') {
    return true;
  }
  return card.color === currentColor || card.value === topCard.value;
}

function getPlayableCards(context) {
  const cards = context.drawnCardId
    ? context.hand.filter((card) => card.id === context.drawnCardId)
    : context.hand;
  return cards.filter((card) => isPlayable(card, context));
}

function chooseColor(hand, random, difficulty, cardId) {
  if (difficulty === 'easy') {
    return COLORS[randomIndex(COLORS.length, random)];
  }

  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const card of hand) {
    if (card.id !== cardId && counts[card.color] !== undefined) {
      counts[card.color] += 1;
    }
  }

  return COLORS.reduce((bestColor, color) => (
    counts[color] > counts[bestColor] ? color : bestColor
  ), COLORS[0]);
}

function mediumScore(card, hand) {
  const cardsInSameColor = hand.filter(
    (heldCard) => heldCard.id !== card.id && heldCard.color === card.color,
  ).length;
  const colorBonus = cardsInSameColor * 2;

  if (card.type === 'wild_draw_four') {
    return -6;
  }
  if (card.type === 'wild') {
    return -4;
  }
  if (card.type === 'draw2' || card.type === 'skip') {
    return 4 + colorBonus;
  }
  if (card.type === 'reverse') {
    return 3 + colorBonus;
  }
  return card.value / 10 + colorBonus;
}

function hardScore(card, context, hasColoredMove) {
  const nextOpponent = context.opponents.find(
    (opponent) => opponent.playerId === context.nextPlayerId,
  );
  const nextPlayerThreatened = nextOpponent && nextOpponent.cardCount <= 2;
  const cardsInSameColor = context.hand.filter(
    (heldCard) => heldCard.id !== card.id && heldCard.color === card.color,
  ).length;
  let score = cardsInSameColor * 2;

  if (card.type === 'wild_draw_four') {
    score += hasColoredMove ? -30 : 8;
    if (nextPlayerThreatened) {
      score += 20;
    }
  } else if (card.type === 'wild') {
    score += hasColoredMove ? -25 : 4;
  } else if (card.type === 'draw2') {
    score += nextPlayerThreatened ? 22 : 8;
  } else if (card.type === 'skip') {
    score += nextPlayerThreatened ? 20 : 6;
  } else if (card.type === 'reverse') {
    score += nextPlayerThreatened && context.opponents.length === 1 ? 20 : 5;
  } else {
    score += card.value / 10;
  }

  return score;
}

function chooseCard(cards, context, random) {
  if (context.difficulty === 'easy') {
    return cards[randomIndex(cards.length, random)];
  }

  const hasColoredMove = cards.some((card) => !WILD_TYPES.has(card.type));
  const scoreCard = context.difficulty === 'medium'
    ? (card) => mediumScore(card, context.hand)
    : (card) => hardScore(card, context, hasColoredMove);
  const scores = cards.map(scoreCard);
  const highestScore = Math.max(...scores);
  const bestCards = cards.filter((_, index) => scores[index] === highestScore);

  return bestCards[randomIndex(bestCards.length, random)];
}

export function chooseBotAction({
  difficulty,
  hand,
  topCard,
  currentColor,
  opponents = [],
  nextPlayerId = null,
  pendingDraw = 0,
  drawnCardId = null,
  unoRequired = false,
  rules = {},
  random = Math.random,
}) {
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new TypeError('Difficulty must be easy, medium, or hard.');
  }
  if (!Array.isArray(hand) || !topCard || !COLORS.includes(currentColor)) {
    throw new TypeError('Bot requires its own hand, a top card, and the active color.');
  }
  if (!Array.isArray(opponents) || typeof random !== 'function') {
    throw new TypeError('Opponents must be public card counts and random must be a function.');
  }
  if (unoRequired && hand.length === 1) {
    return { type: 'declare-uno' };
  }

  const context = {
    difficulty,
    hand,
    topCard,
    currentColor,
    opponents,
    nextPlayerId,
    pendingDraw,
    drawnCardId,
    rules: { stackingDrawCards: false, ...rules },
  };
  const playableCards = getPlayableCards(context);

  if (playableCards.length === 0) {
    return { type: drawnCardId ? 'pass-turn' : 'draw-card' };
  }

  const card = chooseCard(playableCards, context, random);
  const action = { type: 'play-card', cardId: card.id };

  if (WILD_TYPES.has(card.type)) {
    action.colorChoice = chooseColor(hand, random, difficulty, card.id);
  }
  return action;
}
