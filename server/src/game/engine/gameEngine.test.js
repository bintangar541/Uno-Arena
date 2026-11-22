import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cardPoints,
  catchUno,
  createDeck,
  createGame,
  createGameFromDeck,
  dealCards,
  declareUno,
  drawCard,
  getCurrentPlayerId,
  isCardPlayable,
  normalizeCustomRules,
  passTurn,
  playCard,
  playCards,
  shuffleDeck,
  startNextRound,
  UNO_CALL_WINDOW_MS,
} from './index.js';

const players = [
  { id: 'p1', name: 'Player One' },
  { id: 'p2', name: 'Player Two' },
];

function number(id, color, value) {
  return { id, color, type: 'number', value };
}

function action(id, color, type) {
  return { id, color, type, value: type };
}

function wild(id, type = 'wild') {
  return { id, color: 'wild', type, value: type };
}

function twoPlayerGame(handSize = 2) {
  const cards = [
    number('p1-red-5', 'red', 5),
    number('p2-blue-2', 'blue', 2),
    number('p1-green-4', 'green', 4),
    action('p2-blue-draw2', 'blue', 'draw2'),
    number('start-red-9', 'red', 9),
    number('draw-yellow-3', 'yellow', 3),
    number('draw-blue-8', 'blue', 8),
    number('draw-green-6', 'green', 6),
  ];
  return createGameFromDeck(players, cards, handSize);
}

function threePlayerGame(firstCard) {
  const threePlayers = [
    { id: 'p1' },
    { id: 'p2' },
    { id: 'p3' },
  ];
  const cards = [
    firstCard,
    number('p2-card-1', 'blue', 1),
    number('p3-card-1', 'green', 1),
    number('p1-card-2', 'yellow', 2),
    number('p2-card-2', 'blue', 3),
    number('p3-card-2', 'green', 4),
    number('start-red-5', 'red', 5),
    number('draw-yellow-6', 'yellow', 6),
    number('draw-blue-7', 'blue', 7),
  ];
  return createGameFromDeck(threePlayers, cards, 2);
}

test('creates the standard 108-card deck with unique ids', () => {
  const deck = createDeck();

  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((card) => card.id)).size, 108);
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    assert.equal(deck.filter((card) => card.color === color).length, 25);
    assert.equal(
      deck.filter((card) => card.color === color && card.type === 'number' && card.value === 0).length,
      1,
    );
  }
  assert.equal(deck.filter((card) => card.type === 'wild').length, 4);
  assert.equal(deck.filter((card) => card.type === 'wild_draw_four').length, 4);
});

test('shuffles without changing the source deck and deals round-robin', () => {
  const deck = createDeck();
  const originalIds = deck.map((card) => card.id);
  const shuffled = shuffleDeck(deck, () => 0);

  assert.deepEqual(deck.map((card) => card.id), originalIds);
  assert.deepEqual(new Set(shuffled.map((card) => card.id)), new Set(originalIds));

  const dealt = dealCards(players, deck, 2);
  assert.deepEqual(dealt.hands.p1.map((card) => card.id), [deck[0].id, deck[2].id]);
  assert.deepEqual(dealt.hands.p2.map((card) => card.id), [deck[1].id, deck[3].id]);
  assert.equal(dealt.remainingDeck.length, 104);
});

test('starts with seven cards per player and a number card on the discard pile', () => {
  const state = createGame({ players, random: () => 0 });

  assert.equal(state.hands.p1.length, 7);
  assert.equal(state.hands.p2.length, 7);
  assert.equal(state.discardPile.length, 1);
  assert.equal(state.discardPile[0].type, 'number');
  assert.equal(state.currentColor, state.discardPile[0].color);
  assert.equal(getCurrentPlayerId(state), 'p1');
});

test('validates custom-rule settings and applies starting-hand and player limits', () => {
  const state = createGame({
    players,
    random: () => 0,
    rules: { startingHand: 3, maximumPlayers: 2, turnTimer: 45 },
  });

  assert.equal(state.hands.p1.length, 3);
  assert.equal(state.rules.turnTimer, 45);
  assert.throws(() => normalizeCustomRules({ jumpIn: 'yes' }), TypeError);
  const legacyRules = normalizeCustomRules({ sevenO: true });
  assert.equal('sevenO' in legacyRules, false);
  assert.throws(() => normalizeCustomRules({ sevenO: 'yes' }), TypeError);
  assert.throws(() => normalizeCustomRules({ unknownRule: false }), /Unknown custom rule/);
  assert.throws(() => normalizeCustomRules({ maximumPlayers: 5 }), RangeError);
  assert.throws(
    () => createGame({
      players: [...players, { id: 'p3' }],
      rules: { maximumPlayers: 2 },
    }),
    (error) => error.code === 'MAXIMUM_PLAYERS_EXCEEDED',
  );
});

test('rejects out-of-turn and non-matching plays without mutating state', () => {
  const state = twoPlayerGame();

  assert.throws(() => playCard(state, 'p2', 'p2-blue-2'), (error) => error.code === 'OUT_OF_TURN');
  assert.throws(() => playCard(state, 'p1', 'p1-green-4'), (error) => error.code === 'INVALID_MOVE');
  assert.equal(state.hands.p1.length, 2);
  assert.equal(state.discardPile.length, 1);
});

test('declares UNO after a player is reduced to one card', () => {
  const state = twoPlayerGame();
  const now = 1000;
  const afterPlay = playCards(state, 'p1', ['p1-red-5'], {}, () => 0, now);

  assert.equal(afterPlay.hands.p1.length, 1);
  assert.deepEqual(afterPlay.unoWindow, {
    playerId: 'p1',
    declared: false,
    deadlineAt: now + UNO_CALL_WINDOW_MS,
  });

  const declared = declareUno(afterPlay, 'p1', now + 1);
  assert.deepEqual(declared.unoWindow, {
    playerId: 'p1',
    declared: true,
    deadlineAt: now + UNO_CALL_WINDOW_MS,
  });

  const nextTurn = drawCard(declared, 'p2', () => 0);
  assert.equal(nextTurn.unoWindow, null);
});

test('another player can catch missed UNO and give the player two cards without changing the turn', () => {
  const now = 1000;
  const state = playCards(twoPlayerGame(), 'p1', ['p1-red-5'], {}, () => 0, now);
  const currentPlayerId = getCurrentPlayerId(state);

  const caught = catchUno(state, 'p2', () => 0, now + 1);

  assert.equal(caught.hands.p1.length, 3);
  assert.equal(caught.unoWindow, null);
  assert.equal(getCurrentPlayerId(caught), currentPlayerId);
  assert.deepEqual(caught.lastAction, {
    type: 'uno-caught',
    playerId: 'p2',
    caughtPlayerId: 'p1',
    count: 2,
  });
});

test('UNO declaration and catch reject self-catches, declared calls, and expired windows', () => {
  const now = 1000;
  const state = playCards(twoPlayerGame(), 'p1', ['p1-red-5'], {}, () => 0, now);
  const deadlineAt = now + UNO_CALL_WINDOW_MS;
  const declared = declareUno(state, 'p1', now + 1);

  assert.throws(
    () => catchUno(state, 'p1', () => 0, now + 1),
    (error) => error.code === 'UNO_CANNOT_CATCH_SELF',
  );
  assert.throws(
    () => catchUno(declared, 'p2', () => 0, now + 1),
    (error) => error.code === 'UNO_ALREADY_DECLARED',
  );
  assert.throws(
    () => catchUno(state, 'p2', () => 0, deadlineAt),
    (error) => error.code === 'UNO_WINDOW_EXPIRED',
  );
  assert.throws(
    () => declareUno(state, 'p1', deadlineAt),
    (error) => error.code === 'UNO_WINDOW_EXPIRED',
  );
});

test('draws one card, restricts the play to that card, and allows passing', () => {
  const state = twoPlayerGame();
  const drawn = drawCard(state, 'p1', () => 0);

  assert.equal(drawn.hands.p1.length, 3);
  assert.equal(drawn.drawnCardId, drawn.hands.p1[2].id);
  assert.throws(
    () => playCard(drawn, 'p1', 'p1-red-5'),
    (error) => error.code === 'MUST_PLAY_DRAWN_CARD',
  );

  const passed = passTurn(drawn, 'p1');
  assert.equal(getCurrentPlayerId(passed), 'p2');
  assert.equal(passed.drawnCardId, null);
});

test('reshuffles the discard pile while preserving its top card', () => {
  const state = twoPlayerGame(1);
  const topCard = state.discardPile[0];
  const staleDiscards = [
    number('old-yellow-2', 'yellow', 2),
    number('old-green-3', 'green', 3),
    topCard,
  ];
  const depletedState = {
    ...state,
    hands: { p1: [...state.hands.p1], p2: [...state.hands.p2] },
    drawPile: [],
    discardPile: staleDiscards,
  };

  const drawn = drawCard(depletedState, 'p1', () => 0);
  assert.equal(drawn.hands.p1.length, 2);
  assert.equal(drawn.discardPile.length, 1);
  assert.equal(drawn.discardPile[0].id, topCard.id);
  assert.equal(drawn.drawPile.length, 1);
});

test('applies Skip and Reverse turn order, including two-player Reverse', () => {
  const skipped = threePlayerGame(action('p1-skip', 'red', 'skip'));
  const afterSkip = playCard(skipped, 'p1', 'p1-skip');
  assert.equal(getCurrentPlayerId(afterSkip), 'p3');

  const reversed = threePlayerGame(action('p1-reverse', 'red', 'reverse'));
  const afterReverse = playCard(reversed, 'p1', 'p1-reverse');
  assert.equal(afterReverse.direction, -1);
  assert.equal(getCurrentPlayerId(afterReverse), 'p3');

  const twoPlayerReverse = twoPlayerGame();
  twoPlayerReverse.hands.p1[0] = action('p1-reverse', 'red', 'reverse');
  const afterTwoPlayerReverse = playCard(twoPlayerReverse, 'p1', 'p1-reverse');
  assert.equal(getCurrentPlayerId(afterTwoPlayerReverse), 'p1');
});

test('applies Draw Two to the next player and skips their turn', () => {
  const state = threePlayerGame(action('p1-draw2', 'red', 'draw2'));
  const afterPlay = playCard(state, 'p1', 'p1-draw2');

  assert.equal(afterPlay.hands.p2.length, 4);
  assert.equal(getCurrentPlayerId(afterPlay), 'p3');
  assert.equal(afterPlay.lastAction.type, 'draw-penalty');
  assert.equal(afterPlay.lastAction.count, 2);
});

test('stacks draw cards and resolves the accumulated penalty when a player draws', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      action('p2-blue-draw2', 'blue', 'draw2'),
      number('p1-green-4', 'green', 4),
      number('p2-yellow-7', 'yellow', 7),
      number('start-red-9', 'red', 9),
      number('draw-blue-1', 'blue', 1),
      number('draw-blue-3', 'blue', 3),
      number('draw-green-5', 'green', 5),
      number('draw-yellow-6', 'yellow', 6),
    ],
    2,
    { stackingDrawCards: true },
  );

  const firstStack = playCard(state, 'p1', 'p1-red-draw2');
  assert.equal(firstStack.pendingDraw, 2);
  assert.equal(getCurrentPlayerId(firstStack), 'p2');

  const secondStack = playCard(firstStack, 'p2', 'p2-blue-draw2');
  assert.equal(secondStack.pendingDraw, 4);
  assert.equal(getCurrentPlayerId(secondStack), 'p1');

  const penaltyTaken = drawCard(secondStack, 'p1', () => 0);
  assert.equal(penaltyTaken.pendingDraw, 0);
  assert.equal(penaltyTaken.hands.p1.length, 5);
  assert.equal(getCurrentPlayerId(penaltyTaken), 'p2');
  assert.equal(penaltyTaken.lastAction.count, 4);
});

test('finishes a round immediately when the last card is a draw card', () => {
  // Per standard UNO rules: playing your last card wins the round instantly,
  // even if it is a draw card. The opponent does not get to stack or draw.
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      action('p2-blue-draw2', 'blue', 'draw2'),
      number('start-red-9', 'red', 9),
      number('draw-blue-1', 'blue', 1),
      number('draw-blue-3', 'blue', 3),
      number('draw-green-5', 'green', 5),
      number('draw-yellow-6', 'yellow', 6),
    ],
    1,
    { stackingDrawCards: true },
  );
  const firstStack = playCard(state, 'p1', 'p1-red-draw2');

  // p1 played their last card — they win immediately.
  assert.equal(firstStack.status, 'finished');
  assert.equal(firstStack.winnerId, 'p1');
  assert.equal(firstStack.pendingDraw, 0);
});

test('applies Wild Draw Four and chooses the active color', () => {
  const state = createGameFromDeck(
    players,
    [
      wild('p1-wild4', 'wild_draw_four'),
      number('p2-blue-2', 'blue', 2),
      number('p1-green-4', 'green', 4),
      number('p2-yellow-3', 'yellow', 3),
      number('start-red-9', 'red', 9),
      number('draw-blue-8', 'blue', 8),
      number('draw-green-6', 'green', 6),
      number('draw-yellow-1', 'yellow', 1),
      number('draw-red-2', 'red', 2),
    ],
    2,
  );
  const afterPlay = playCard(state, 'p1', 'p1-wild4', { colorChoice: 'yellow' });

  assert.equal(afterPlay.currentColor, 'yellow');
  assert.equal(afterPlay.hands.p2.length, 6);
  assert.equal(getCurrentPlayerId(afterPlay), 'p1');
  assert.equal(afterPlay.lastAction.count, 4);
});

test('allows an exact-card jump-in only when the rule is enabled', () => {
  const state = createGameFromDeck(
    players,
    [
      number('p1-green-3', 'green', 3),
      number('p2-red-5-copy', 'red', 5),
      number('p1-blue-4', 'blue', 4),
      number('p2-yellow-8', 'yellow', 8),
      number('start-red-5', 'red', 5),
      number('draw-blue-1', 'blue', 1),
    ],
    2,
    { jumpIn: true },
  );

  const jumpedIn = playCard(state, 'p2', 'p2-red-5-copy');
  assert.equal(jumpedIn.lastAction.jumpIn, true);
  assert.equal(getCurrentPlayerId(jumpedIn), 'p1');
  assert.equal(jumpedIn.hands.p2.length, 1);
});

test('plays a 7 as a normal number card without swapping hands', () => {
  const state = createGameFromDeck(
    players,
    [
      number('p1-red-7', 'red', 7),
      number('p2-blue-3', 'blue', 3),
      number('p1-green-2', 'green', 2),
      number('p2-yellow-4', 'yellow', 4),
      number('start-red-5', 'red', 5),
      number('draw-blue-1', 'blue', 1),
    ],
    2,
  );

  const played = playCard(state, 'p1', 'p1-red-7');

  assert.deepEqual(played.hands.p1.map((card) => card.id), ['p1-green-2']);
  assert.deepEqual(played.hands.p2.map((card) => card.id), ['p2-blue-3', 'p2-yellow-4']);
  assert.equal(getCurrentPlayerId(played), 'p2');
});

test('plays same-number cards of different colors together and uses the last color', () => {
  const threePlayers = [
    { id: 'p1' },
    { id: 'p2' },
    { id: 'p3' },
  ];
  const state = createGameFromDeck(
    threePlayers,
    [
      number('p1-red-7', 'red', 7),
      number('p2-blue-3', 'blue', 3),
      number('p3-green-4', 'green', 4),
      number('p1-blue-7', 'blue', 7),
      number('p2-green-4', 'green', 4),
      number('p3-yellow-2', 'yellow', 2),
      number('start-red-9', 'red', 9),
    ],
    2,
  );
  const played = playCards(state, 'p1', ['p1-red-7', 'p1-blue-7']);

  assert.equal(played.hands.p1.length, 0);
  assert.equal(played.currentColor, 'blue');
  assert.equal(played.discardPile.at(-2).id, 'p1-red-7');
  assert.equal(played.discardPile.at(-1).id, 'p1-blue-7');
  assert.deepEqual(played.finishOrder, ['p1']);
  assert.equal(played.status, 'playing');
});

test('combines Draw Two and Wild Draw Four into one stacked penalty', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      number('p2-red-3', 'red', 3),
      wild('p1-wild4', 'wild_draw_four'),
      number('p2-blue-5', 'blue', 5),
      number('start-red-9', 'red', 9),
      number('draw-green-1', 'green', 1),
      number('draw-yellow-2', 'yellow', 2),
    ],
    2,
    { stackingDrawCards: true },
  );
  const played = playCards(
    state,
    'p1',
    ['p1-red-draw2', 'p1-wild4'],
    { colorChoice: 'green' },
  );

  assert.equal(played.pendingDraw, 0);   // game ended, pendingDraw cleared
  assert.equal(played.status, 'finished');
  assert.equal(played.winnerId, 'p1');
  assert.equal(played.currentColor, 'green');
  assert.equal(played.discardPile.at(-2).id, 'p1-red-draw2');
  assert.equal(played.discardPile.at(-1).id, 'p1-wild4');
  assert.deepEqual(played.pendingFinishPlayerIds, []);
});

test('a combined draw penalty is taken at once when stacking is disabled', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      number('p2-red-3', 'red', 3),
      wild('p1-wild4', 'wild_draw_four'),
      number('p2-blue-5', 'blue', 5),
      number('start-red-9', 'red', 9),
      ...Array.from({ length: 6 }, (_, index) => number(`draw-green-${index}`, 'green', index)),
    ],
    2,
  );
  const played = playCards(
    state,
    'p1',
    ['p1-red-draw2', 'p1-wild4'],
    { colorChoice: 'green' },
  );

  assert.equal(played.status, 'finished');
  assert.equal(played.hands.p2.length, 8);
  assert.equal(played.finishOrder[0], 'p1');
});

test('allows a Wild Draw Four combo when an active-color card remains in hand', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      number('p2-blue-3', 'blue', 3),
      wild('p1-wild4', 'wild_draw_four'),
      number('p2-green-5', 'green', 5),
      number('p1-red-7', 'red', 7),
      number('p2-yellow-1', 'yellow', 1),
      number('start-red-9', 'red', 9),
    ],
    3,
  );

  assert.equal(isCardPlayable(state, 'p1', 'p1-wild4'), true);
  const played = playCards(
    state,
    'p1',
    ['p1-red-draw2', 'p1-wild4'],
    { colorChoice: 'blue' },
  );
  assert.equal(played.pendingDraw, 0);
  assert.equal(played.currentColor, 'blue');
  assert.equal(played.hands.p1.length, 1);
  assert.equal(played.hands.p2.length, 5);
});

test('draws until playable and enforces Force Play on the drawn card', () => {
  const state = createGameFromDeck(
    players,
    [
      number('p1-red-5', 'red', 5),
      number('p2-blue-2', 'blue', 2),
      number('p1-green-4', 'green', 4),
      number('p2-yellow-3', 'yellow', 3),
      number('start-red-9', 'red', 9),
      number('draw-red-3', 'red', 3),
      number('draw-green-2', 'green', 2),
    ],
    2,
    { drawUntilPlayable: true, forcePlay: true },
  );
  const drawn = drawCard(state, 'p1', () => 0);

  assert.equal(drawn.lastAction.cardIds.length, 2);
  assert.equal(drawn.drawnCardId, 'draw-red-3');
  assert.equal(isCardPlayable(drawn, 'p1', drawn.drawnCardId), true);
  assert.throws(
    () => passTurn(drawn, 'p1'),
    (error) => error.code === 'FORCE_PLAY_REQUIRED',
  );
  const played = playCard(drawn, 'p1', 'draw-red-3');
  assert.equal(getCurrentPlayerId(played), 'p2');
});

test('requires a valid chosen color for Wild and allows Wild Draw Four with matching color in hand', () => {
  const wildState = createGameFromDeck(
    players,
    [
      wild('p1-wild'),
      number('p2-blue-2', 'blue', 2),
      number('p1-green-4', 'green', 4),
      number('p2-yellow-3', 'yellow', 3),
      number('start-red-9', 'red', 9),
      number('draw-blue-8', 'blue', 8),
    ],
    2,
  );

  assert.throws(
    () => playCard(wildState, 'p1', 'p1-wild'),
    (error) => error.code === 'COLOR_REQUIRED',
  );
  const afterWild = playCard(wildState, 'p1', 'p1-wild', { colorChoice: 'blue' });
  assert.equal(afterWild.currentColor, 'blue');

  const wildDrawFourState = createGameFromDeck(
    players,
    [
      wild('p1-wild4', 'wild_draw_four'),
      number('p2-blue-2', 'blue', 2),
      number('p1-red-4', 'red', 4),
      number('p2-yellow-3', 'yellow', 3),
      number('start-red-9', 'red', 9),
      number('draw-blue-8', 'blue', 8),
    ],
    2,
  );
  assert.equal(isCardPlayable(wildDrawFourState, 'p1', 'p1-wild4'), true);
  const afterWildDrawFour = playCard(
    wildDrawFourState,
    'p1',
    'p1-wild4',
    { colorChoice: 'green' },
  );
  assert.equal(afterWildDrawFour.currentColor, 'green');
  assert.equal(afterWildDrawFour.pendingDraw, 0);
  assert.equal(afterWildDrawFour.hands.p2.length, 4);
});

test('continues through all placements and gives the last active player last place', () => {
  const threePlayers = [
    { id: 'p1', name: 'Player One' },
    { id: 'p2', name: 'Player Two' },
    { id: 'p3', name: 'Player Three' },
  ];
  const state = createGameFromDeck(
    threePlayers,
    [
      number('p1-red-5', 'red', 5),
      number('p2-red-6', 'red', 6),
      number('p3-blue-2', 'blue', 2),
      number('start-red-9', 'red', 9),
    ],
    1,
    { targetScore: 8 },
  );

  const firstPlace = playCard(state, 'p1', 'p1-red-5');
  assert.equal(firstPlace.status, 'playing');
  assert.equal(firstPlace.winnerId, 'p1');
  assert.equal(firstPlace.roundScore, 8);
  assert.equal(firstPlace.scoreboard.p1, 0);
  assert.deepEqual(firstPlace.finishOrder, ['p1']);
  assert.equal(getCurrentPlayerId(firstPlace), 'p2');

  const finished = playCard(firstPlace, 'p2', 'p2-red-6');
  assert.equal(finished.status, 'finished');
  assert.equal(finished.winnerId, 'p1');
  assert.equal(finished.matchWinnerId, 'p1');
  assert.equal(finished.scoreboard.p1, 8);
  assert.deepEqual(finished.finishOrder, ['p1', 'p2', 'p3']);
  assert.equal(finished.hands.p3.length, 1);
});

test('skips players already placed when advancing after a Reverse', () => {
  const fourPlayers = [
    { id: 'p1' },
    { id: 'p2' },
    { id: 'p3' },
    { id: 'p4' },
  ];
  const state = createGameFromDeck(
    fourPlayers,
    [
      action('p1-red-reverse', 'red', 'reverse'),
      number('p2-red-5', 'red', 5),
      number('p3-red-7', 'red', 7),
      number('p4-red-9', 'red', 9),
      number('start-red-2', 'red', 2),
    ],
    1,
  );

  const firstPlace = playCard(state, 'p1', 'p1-red-reverse');
  assert.deepEqual(firstPlace.finishOrder, ['p1']);
  assert.equal(getCurrentPlayerId(firstPlace), 'p4');

  const secondPlace = playCard(firstPlace, 'p4', 'p4-red-9');
  assert.equal(secondPlace.status, 'playing');
  assert.deepEqual(secondPlace.finishOrder, ['p1', 'p4']);
  assert.equal(getCurrentPlayerId(secondPlace), 'p3');

  const finished = playCard(secondPlace, 'p3', 'p3-red-7');
  assert.deepEqual(finished.finishOrder, ['p1', 'p4', 'p3', 'p2']);
  assert.equal(finished.status, 'finished');
});

test('a Skip advances past the next active player after its player finishes', () => {
  const fourPlayers = [
    { id: 'p1' },
    { id: 'p2' },
    { id: 'p3' },
    { id: 'p4' },
  ];
  const state = createGameFromDeck(
    fourPlayers,
    [
      action('p1-red-skip', 'red', 'skip'),
      number('p2-red-5', 'red', 5),
      number('p3-red-7', 'red', 7),
      number('p4-red-9', 'red', 9),
      number('start-red-2', 'red', 2),
    ],
    1,
  );

  const firstPlace = playCard(state, 'p1', 'p1-red-skip');
  assert.deepEqual(firstPlace.finishOrder, ['p1']);
  assert.equal(getCurrentPlayerId(firstPlace), 'p3');

  const secondPlace = playCard(firstPlace, 'p3', 'p3-red-7');
  assert.equal(getCurrentPlayerId(secondPlace), 'p4');

  const finished = playCard(secondPlace, 'p4', 'p4-red-9');
  assert.deepEqual(finished.finishOrder, ['p1', 'p3', 'p4', 'p2']);
  assert.equal(finished.status, 'finished');
});

test('ranks multi-player stacked-draw finishers who each play their last draw card', () => {
  const threePlayers = [
    { id: 'p1' },
    { id: 'p2' },
    { id: 'p3' },
  ];
  const state = createGameFromDeck(
    threePlayers,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      action('p2-blue-draw2', 'blue', 'draw2'),
      number('p3-green-1', 'green', 1),
      number('start-red-9', 'red', 9),
      number('draw-green-5', 'green', 5),
      number('draw-yellow-6', 'yellow', 6),
      number('draw-blue-7', 'blue', 7),
      number('draw-red-2', 'red', 2),
    ],
    1,
    { stackingDrawCards: true },
  );

  // p1 plays their last card (+2) → p1 is ranked 1st immediately.
  // Game continues since p2 and p3 are still active.
  const firstStack = playCard(state, 'p1', 'p1-red-draw2');
  assert.deepEqual(firstStack.finishOrder, ['p1']);
  assert.equal(firstStack.status, 'playing');
  assert.equal(firstStack.pendingDraw, 2);

  // p2 plays their last card (+2) stacking onto the pending draw → p2 ranked 2nd.
  // Only p3 remains, so the round finishes immediately.
  const secondStack = playCard(firstStack, 'p2', 'p2-blue-draw2');
  assert.equal(secondStack.status, 'finished');
  assert.deepEqual(secondStack.finishOrder, ['p1', 'p2', 'p3']);
  assert.equal(secondStack.winnerId, 'p1');
});

test('detects a winner and calculates round score from opponents’ hands', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-reverse', 'red', 'reverse'),
      number('p2-blue-7', 'blue', 7),
      number('p1-red-5', 'red', 5),
      action('p2-yellow-draw2', 'yellow', 'draw2'),
      number('start-red-9', 'red', 9),
    ],
    2,
  );
  const afterReverse = playCard(state, 'p1', 'p1-red-reverse');
  assert.equal(getCurrentPlayerId(afterReverse), 'p1');
  const finished = playCard(afterReverse, 'p1', 'p1-red-5');

  assert.equal(finished.status, 'finished');
  assert.equal(finished.winnerId, 'p1');
  assert.equal(finished.roundScore, 27);
});

test('resolves a final Draw Two before calculating the winner’s score', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-draw2', 'red', 'draw2'),
      number('p2-blue-7', 'blue', 7),
      number('start-red-9', 'red', 9),
      number('draw-yellow-3', 'yellow', 3),
      number('draw-blue-8', 'blue', 8),
      number('draw-green-6', 'green', 6),
    ],
    1,
  );
  const finished = playCard(state, 'p1', 'p1-red-draw2');

  assert.equal(finished.status, 'finished');
  assert.equal(finished.winnerId, 'p1');
  assert.equal(finished.hands.p2.length, 3);
  assert.equal(finished.roundScore, 21);
});

test('tracks target score across rounds and blocks play after the match is won', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-reverse', 'red', 'reverse'),
      number('p2-blue-7', 'blue', 7),
      number('p1-red-5', 'red', 5),
      action('p2-yellow-draw2', 'yellow', 'draw2'),
      number('start-red-9', 'red', 9),
    ],
    2,
    { targetScore: 20 },
  );
  const afterReverse = playCard(state, 'p1', 'p1-red-reverse');
  const finished = playCard(afterReverse, 'p1', 'p1-red-5');

  assert.equal(finished.scoreboard.p1, 27);
  assert.equal(finished.matchWinnerId, 'p1');
  assert.throws(
    () => startNextRound(finished),
    (error) => error.code === 'MATCH_FINISHED',
  );
});

test('starts another round while preserving accumulated scores', () => {
  const state = createGameFromDeck(
    players,
    [
      action('p1-red-reverse', 'red', 'reverse'),
      number('p2-blue-7', 'blue', 7),
      number('p1-red-5', 'red', 5),
      action('p2-yellow-draw2', 'yellow', 'draw2'),
      number('start-red-9', 'red', 9),
    ],
    2,
    { targetScore: 100 },
  );
  const afterReverse = playCard(state, 'p1', 'p1-red-reverse');
  const finished = playCard(afterReverse, 'p1', 'p1-red-5');
  const nextRound = startNextRound(finished, () => 0);

  assert.equal(nextRound.roundNumber, 2);
  assert.equal(nextRound.status, 'playing');
  assert.equal(nextRound.hands.p1.length, 2);
  assert.equal(nextRound.scoreboard.p1, 27);
});

test('scores number, action, and wild cards correctly', () => {
  assert.equal(cardPoints(number('n', 'red', 8)), 8);
  assert.equal(cardPoints(action('s', 'red', 'skip')), 20);
  assert.equal(cardPoints(wild('w')), 50);
  assert.equal(cardPoints(wild('w4', 'wild_draw_four')), 50);
});
