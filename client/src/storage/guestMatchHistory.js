const PROFILE_KEY = 'uno-arena-guest-profile';
const HISTORY_KEY_PREFIX = 'uno-arena-match-history:';
const HISTORY_LIMIT = 50;

function readStoredJson(key, fallback) {
  const stored = localStorage.getItem(key);
  if (!stored) {
    return fallback;
  }

  try {
    return JSON.parse(stored);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    localStorage.removeItem(key);
    return fallback;
  }
}

function readMatches(profileId) {
  const key = `${HISTORY_KEY_PREFIX}${profileId}`;
  const matches = readStoredJson(key, []);
  if (!Array.isArray(matches)) {
    localStorage.removeItem(key);
    return [];
  }
  return matches;
}

export function getGuestProfile() {
  const profile = readStoredJson(PROFILE_KEY, null);
  if (
    profile
    && typeof profile.id === 'string'
    && typeof profile.name === 'string'
  ) {
    return profile;
  }

  const profileId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const newProfile = { id: profileId, name: '' };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(newProfile));
  return newProfile;
}

export function saveGuestProfileName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('Guest profile name must be a non-empty string.');
  }

  const profile = getGuestProfile();
  const updatedProfile = { ...profile, name: name.trim() };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(updatedProfile));
}

export function getGuestMatches() {
  const profile = getGuestProfile();
  return readMatches(profile.id);
}

export function recordGuestMatch(match) {
  if (!match || typeof match.id !== 'string' || !match.id) {
    throw new TypeError('A match record needs a unique id.');
  }

  const profile = getGuestProfile();
  const key = `${HISTORY_KEY_PREFIX}${profile.id}`;
  const matches = readMatches(profile.id);
  if (matches.some((savedMatch) => savedMatch.id === match.id)) {
    return false;
  }

  localStorage.setItem(
    key,
    JSON.stringify([{ ...match }, ...matches].slice(0, HISTORY_LIMIT)),
  );
  return true;
}
