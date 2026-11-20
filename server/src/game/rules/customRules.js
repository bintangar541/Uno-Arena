export const DEFAULT_CUSTOM_RULES = Object.freeze({
  stackingDrawCards: false,
  jumpIn: false,
  drawUntilPlayable: false,
  forcePlay: false,
  startingHand: 7,
  turnTimer: 30,
  targetScore: 500,
  maximumPlayers: 4,
});

export function normalizeCustomRules(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Custom rules must be an object.');
  }

  const providedRules = { ...input };
  if (Object.hasOwn(providedRules, 'sevenO')) {
    if (typeof providedRules.sevenO !== 'boolean') {
      throw new TypeError('sevenO must be a boolean.');
    }
    delete providedRules.sevenO;
  }

  const unknownRule = Object.keys(providedRules).find(
    (key) => !Object.hasOwn(DEFAULT_CUSTOM_RULES, key),
  );
  if (unknownRule) {
    throw new TypeError(`Unknown custom rule: ${unknownRule}.`);
  }

  const rules = { ...DEFAULT_CUSTOM_RULES, ...providedRules };
  for (const key of [
    'stackingDrawCards',
    'jumpIn',
    'drawUntilPlayable',
    'forcePlay',
  ]) {
    if (typeof rules[key] !== 'boolean') {
      throw new TypeError(`${key} must be a boolean.`);
    }
  }

  if (!Number.isInteger(rules.startingHand) || rules.startingHand < 1 || rules.startingHand > 20) {
    throw new RangeError('startingHand must be an integer from 1 to 20.');
  }
  if (
    !Number.isInteger(rules.turnTimer)
    || rules.turnTimer < 0
    || rules.turnTimer > 180
    || (rules.turnTimer > 0 && rules.turnTimer < 10)
  ) {
    throw new RangeError('turnTimer must be 0 (disabled) or between 10 and 180 seconds.');
  }
  if (!Number.isInteger(rules.targetScore) || rules.targetScore < 0) {
    throw new RangeError('targetScore must be a non-negative integer; 0 disables the limit.');
  }
  if (!Number.isInteger(rules.maximumPlayers) || rules.maximumPlayers < 2 || rules.maximumPlayers > 4) {
    throw new RangeError('maximumPlayers must be between two and four.');
  }

  return Object.freeze(rules);
}
