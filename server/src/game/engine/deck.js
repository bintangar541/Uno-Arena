export const COLORS = Object.freeze(['red', 'yellow', 'green', 'blue']);

export function createDeck() {
  const deck = [];

  for (const color of COLORS) {
    deck.push({ id: `${color}-0`, color, type: 'number', value: 0 });

    for (let value = 1; value <= 9; value += 1) {
      for (let copy = 1; copy <= 2; copy += 1) {
        deck.push({
          id: `${color}-${value}-${copy}`,
          color,
          type: 'number',
          value,
        });
      }
    }

    for (const type of ['skip', 'reverse', 'draw2']) {
      for (let copy = 1; copy <= 2; copy += 1) {
        deck.push({ id: `${color}-${type}-${copy}`, color, type, value: type });
      }
    }
  }

  for (let copy = 1; copy <= 4; copy += 1) {
    deck.push({ id: `wild-${copy}`, color: 'wild', type: 'wild', value: 'wild' });
    deck.push({
      id: `wild-draw-four-${copy}`,
      color: 'wild',
      type: 'wild_draw_four',
      value: 'wild_draw_four',
    });
  }

  return deck;
}

export function shuffleDeck(deck, random = Math.random) {
  if (!Array.isArray(deck) || typeof random !== 'function') {
    throw new TypeError('A deck and random-number function are required.');
  }

  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('Random-number function must return a value in [0, 1).');
    }
    const swapIndex = Math.floor(sample * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function dealCards(players, deck, handSize = 7) {
  if (!Array.isArray(players) || !Array.isArray(deck)) {
    throw new TypeError('Players and deck must be arrays.');
  }
  if (!Number.isInteger(handSize) || handSize < 1) {
    throw new RangeError('Hand size must be a positive integer.');
  }
  if (deck.length < players.length * handSize) {
    throw new RangeError('Deck does not contain enough cards to deal.');
  }

  const hands = Object.fromEntries(players.map((player) => [player.id, []]));
  const remainingDeck = [...deck];

  for (let round = 0; round < handSize; round += 1) {
    for (const player of players) {
      hands[player.id].push(remainingDeck.shift());
    }
  }

  return { hands, remainingDeck };
}

export function cardPoints(card) {
  if (card.type === 'number') {
    return card.value;
  }
  if (card.type === 'wild' || card.type === 'wild_draw_four') {
    return 50;
  }
  return 20;
}
