import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGuestMatches,
  getGuestProfile,
  recordGuestMatch,
  saveGuestProfileName,
} from './guestMatchHistory.js';

test('stores guest match history once per round on the current browser profile', () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });

  try {
    saveGuestProfileName('Bintang');
    const match = {
      id: 'room-1:1',
      place: 1,
      winnerName: 'Bintang',
      finishOrder: [{ name: 'Bintang', place: 1 }],
    };

    assert.equal(recordGuestMatch(match), true);
    assert.equal(recordGuestMatch(match), false);
    assert.equal(getGuestProfile().name, 'Bintang');
    assert.deepEqual(getGuestMatches(), [match]);
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousStorage);
    } else {
      delete globalThis.localStorage;
    }
  }
});
