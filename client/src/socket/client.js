import { io } from 'socket.io-client';

const SESSION_KEY = 'uno-arena-guest-session';
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function readSession() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export const socket = io(apiUrl, {
  autoConnect: false,
  auth: {},
});

export function connectSocket() {
  const session = readSession();
  socket.auth = session?.reconnectToken
    ? { reconnectToken: session.reconnectToken }
    : {};
  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}

export function getGuestSession() {
  return readSession();
}

export function saveGuestSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearGuestSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function requestSocketEvent(requestName, responseName, payload) {
  connectSocket();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      socket.off(responseName, onSuccess);
      socket.off('error', onError);
      reject(new Error('Server tidak merespons. Periksa koneksi lalu coba lagi.'));
    }, 10_000);

    function onSuccess(response) {
      window.clearTimeout(timeout);
      socket.off('error', onError);
      resolve(response);
    }

    function onError(error) {
      window.clearTimeout(timeout);
      socket.off(responseName, onSuccess);
      const requestError = new Error(error?.message || 'Aksi tidak dapat diproses.');
      requestError.code = error?.code;
      reject(requestError);
    }

    socket.once(responseName, onSuccess);
    socket.once('error', onError);
    socket.emit(requestName, payload);
  });
}
