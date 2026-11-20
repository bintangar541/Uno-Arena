import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBotAction } from './index.js';

function number(id, color, value) {
  return { id, color, type: 'number', value };
}

function action(id, color, type) {
  return { id, color, type, value: type };
}

function wild(id, type = 'wild') {
  return { id, color: 'wild', type, value: type };
}

const topCard = number('top-red-5', 'red', 5);

test('Easy selects only a valid card and draws when no card is playable', () => {
  const hand = [
    number('red-2', 'red', 2),
    number('blue-9', 'blue', 9),
  ];
  const move = chooseBotAction({
    difficulty: 'easy',
    hand,
    topCard,
    currentColor: 'red',
    random: () => 0.99,
  });

  assert.equal(move.type, 'play-card');
  assert.equal(move.cardId, 'red-2');

  const noMove = chooseBotAction({
    difficulty: 'easy',
    hand: [number('blue-9', 'blue', 9)],
    topCard,
    currentColor: 'red',
  });
  assert.deepEqual(noMove, { type: 'draw-card' });
});

test('Easy can play Wild Draw Four while holding a card of the active color', () => {
  const move = chooseBotAction({
    difficulty: 'easy',
    hand: [
      wild('wild-draw-four', 'wild_draw_four'),
      number('red-1', 'red', 1),
    ],
    topCard,
    currentColor: 'red',
    random: () => 0,
  });

  assert.deepEqual(move, {
    type: 'play-card',
    cardId: 'wild-draw-four',
    colorChoice: 'red',
  });
});

test('Medium chooses a Wild color that best matches its remaining hand', () => {
  const move = chooseBotAction({
    difficulty: 'medium',
    hand: [
      wild('wild'),
      number('green-1', 'green', 1),
      number('green-8', 'green', 8),
      number('blue-3', 'blue', 3),
    ],
    topCard,
    currentColor: 'red',
    random: () => 0,
  });

  assert.deepEqual(move, { type: 'play-card', cardId: 'wild', colorChoice: 'green' });
});

test('Hard preserves Wild cards when a colored move is available', () => {
  const move = chooseBotAction({
    difficulty: 'hard',
    hand: [
      wild('wild'),
      number('red-7', 'red', 7),
    ],
    topCard,
    currentColor: 'red',
    random: () => 0,
  });

  assert.deepEqual(move, { type: 'play-card', cardId: 'red-7' });
});

test('Hard prioritizes an attack when the next opponent is close to winning', () => {
  const move = chooseBotAction({
    difficulty: 'hard',
    hand: [
      number('red-8', 'red', 8),
      action('red-draw2', 'red', 'draw2'),
    ],
    topCard,
    currentColor: 'red',
    nextPlayerId: 'opponent',
    opponents: [{ playerId: 'opponent', cardCount: 1 }],
    random: () => 0,
  });

  assert.equal(move.cardId, 'red-draw2');
});

test('plays a 7 without selecting another player', () => {
  const move = chooseBotAction({
    difficulty: 'hard',
    hand: [number('red-7', 'red', 7), number('red-2', 'red', 2)],
    topCard,
    currentColor: 'red',
    opponents: [
      { playerId: 'more-cards', cardCount: 4 },
      { playerId: 'fewer-cards', cardCount: 1 },
    ],
    random: () => 0,
  });

  assert.equal(move.cardId, 'red-7');
  assert.equal('swapWithPlayerId' in move, false);
});

test('declares UNO before choosing a card when a declaration is pending', () => {
  const move = chooseBotAction({
    difficulty: 'hard',
    hand: [number('red-1', 'red', 1)],
    topCard,
    currentColor: 'red',
    unoRequired: true,
  });

  assert.deepEqual(move, { type: 'declare-uno' });
});

test('does not inspect hidden opponent hands', () => {
  const input = {
    difficulty: 'hard',
    hand: [number('red-2', 'red', 2), wild('wild')],
    topCard,
    currentColor: 'red',
    opponents: [{ playerId: 'opponent', cardCount: 3 }],
    random: () => 0,
  };

  const first = chooseBotAction({ ...input, hiddenHands: { opponent: [wild('secret')] } });
  const second = chooseBotAction({ ...input, hiddenHands: { opponent: [number('secret', 'red', 8)] } });

  assert.deepEqual(first, second);
});

test('rejects unknown difficulty levels', () => {
  assert.throws(
    () => chooseBotAction({
      difficulty: 'expert',
      hand: [number('red-2', 'red', 2)],
      topCard,
      currentColor: 'red',
    }),
    TypeError,
  );
});
