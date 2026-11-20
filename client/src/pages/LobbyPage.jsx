import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BrandLink from '../components/common/BrandLink.jsx';
import {
  clearGuestSession,
  connectSocket,
  getGuestSession,
  saveGuestSession,
  socket,
} from '../socket/client.js';
import './LobbyPage.css';

const ruleLabels = {
  stackingDrawCards: 'Stacking',
  jumpIn: 'Jump-In',
  drawUntilPlayable: 'Draw until playable',
  forcePlay: 'Force play',
};

const difficultyOptions = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

function updateSession(response, name) {
  saveGuestSession({
    roomCode: response.room.code,
    playerId: response.playerId,
    reconnectToken: response.reconnectToken,
    name,
  });
}

export default function LobbyPage() {
  const navigate = useNavigate();
  const session = getGuestSession();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [copied, setCopied] = useState(false);
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const copyTimerRef = useRef(null);
  const isHost = room?.hostId === session?.playerId;
  const ownPlayer = useMemo(
    () => room?.players.find((player) => player.id === session?.playerId),
    [room, session?.playerId],
  );
  const allHumansReady = room?.players
    .filter((player) => !player.isBot)
    .every((player) => player.ready);

  useEffect(() => {
    if (!session?.reconnectToken) {
      setError('Sesi tamu tidak ditemukan. Buat atau gabung room dari dashboard.');
      return undefined;
    }

    const acceptRoom = (response) => {
      setRoom(response.room);
      setError('');
      updateSession(response, session.name);
      if (response.room.status === 'playing') {
        navigate('/game', { replace: true });
      }
    };
    const onRoomUpdated = (updatedRoom) => {
      setRoom(updatedRoom);
      if (updatedRoom.status === 'playing') {
        navigate('/game', { replace: true });
      }
    };
    const onGameStarted = () => navigate('/game', { replace: true });
    const onError = (socketError) => {
      if (['NOT_IN_ROOM', 'RECONNECT_EXPIRED'].includes(socketError?.code)) {
        clearGuestSession();
        navigate('/dashboard', { replace: true });
        return;
      }
      setError(socketError?.message || 'Koneksi room gagal.');
    };
    const onRoomClosed = () => {
      clearGuestSession();
      navigate('/dashboard', { replace: true });
    };
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:created', acceptRoom);
    socket.on('room:joined', acceptRoom);
    socket.on('player:reconnected', acceptRoom);
    socket.on('room:updated', onRoomUpdated);
    socket.on('game:started', onGameStarted);
    socket.on('error', onError);
    socket.on('room:closed', onRoomClosed);
    socket.on('session:expired', onRoomClosed);
    connectSocket();
    if (socket.connected) {
      socket.emit('game:request-state', {});
    } else {
      socket.once('connect', () => socket.emit('game:request-state', {}));
    }

    return () => {
      socket.off('room:created', acceptRoom);
      socket.off('room:joined', acceptRoom);
      socket.off('player:reconnected', acceptRoom);
      socket.off('room:updated', onRoomUpdated);
      socket.off('game:started', onGameStarted);
      socket.off('error', onError);
      socket.off('room:closed', onRoomClosed);
      socket.off('session:expired', onRoomClosed);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [navigate, session?.reconnectToken, session?.name]);

  useEffect(() => () => {
    window.clearTimeout(copyTimerRef.current);
  }, []);

  function setReady() {
    socket.emit('room:ready', { ready: !ownPlayer?.ready });
  }

  function addBot() {
    setError('');
    socket.emit('room:add-bot', { difficulty });
  }

  function removeBot(botId) {
    setError('');
    socket.emit('room:remove-bot', { botId });
  }

  function startGame() {
    setError('');
    socket.emit('game:start', {});
  }

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setNotice('');
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      setCopied(false);
      setNotice(`Bagikan kode ini ke teman: ${room.code}`);
    }
  }

  function leaveRoom() {
    socket.emit('room:leave', {});
    clearGuestSession();
    navigate('/dashboard');
  }

  const startDisabled = room ? room.players.length < 2 || !allHumansReady : true;

  return (
    <div className="lobby-page">
      <header className="lobby-header">
        <div className="lobby-header-inner">
          <BrandLink />
          <div className="lobby-header-actions">
            <p className={`lobby-connection-status ${socketConnected ? 'is-connected' : ''}`} aria-live="polite">
              <span aria-hidden="true" />
              {socketConnected ? 'Server terhubung' : 'Menghubungkan server'}
            </p>
            <button
              className="lobby-button lobby-button-secondary lobby-leave-button"
              onClick={leaveRoom}
              type="button"
            >
              Keluar dari room
            </button>
          </div>
        </div>
      </header>

      <main className="lobby-main">
        <section className="lobby-welcome" aria-labelledby="lobby-title">
          <h1 id="lobby-title">Siapkan meja bermain.</h1>
          <p>
            Bagikan kode ke temanmu, tambahkan bot untuk mengisi kursi, lalu mulai saat semua pemain siap.
          </p>
        </section>

        {error && <p className="lobby-alert" role="alert">{error}</p>}

        {!room ? (
          <p className="lobby-loading" role="status">Menyambungkan kembali ke room...</p>
        ) : (
          <div className="lobby-content">
            <section className="lobby-main-column" aria-label="Kode dan pemain room">
              <div className="lobby-room-code">
                <div className="lobby-room-code-row">
                  <p className="lobby-room-code-value">
                    <span className="lobby-sr-only">Kode room </span>
                    {room.code}
                  </p>
                  <button
                    className="lobby-button lobby-button-secondary lobby-copy-button"
                    onClick={() => void copyRoomCode()}
                    type="button"
                  >
                    <span aria-live="polite">{copied ? 'Tersalin' : 'Salin'}</span>
                  </button>
                </div>
                <p className="lobby-player-count">
                  <strong>{room.players.length} / {room.rules.maximumPlayers}</strong> pemain
                </p>
                {notice && <p className="lobby-notice" role="status" aria-live="polite">{notice}</p>}
              </div>

              <section className="lobby-player-section" aria-label="Pemain room">
                <div className="lobby-slots">
                  {room.players.map((player, index) => (
                    <div className="lobby-player-slot" key={player.id}>
                      <div className="lobby-player-identity">
                        <span className="lobby-seat-number">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="lobby-player-copy">
                          <p className="lobby-player-name">
                            {player.name}
                            {player.id === room.hostId && (
                              <span className="lobby-host-badge">HOST</span>
                            )}
                          </p>
                          <p className="lobby-player-detail">
                            {player.isBot
                              ? `Bot · ${player.difficulty}`
                              : player.connected
                                ? 'Pemain tamu'
                                : 'Terputus — menunggu reconnect'}
                          </p>
                        </div>
                      </div>
                      <div className="lobby-player-state">
                        <span className={`lobby-ready-status ${player.ready ? 'is-ready' : 'is-waiting'}`}>
                          {player.ready ? 'Siap' : 'Belum siap'}
                        </span>
                        {isHost && player.isBot && room.status === 'waiting' && (
                          <button
                            aria-label={`Hapus ${player.name}`}
                            className="lobby-button lobby-button-secondary lobby-remove-button"
                            onClick={() => removeBot(player.id)}
                            type="button"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {Array.from({
                    length: Math.max(0, room.rules.maximumPlayers - room.players.length),
                  }, (_, index) => (
                    <div className="lobby-empty-slot" key={`empty-${index}`}>
                      <span>Menunggu teman...</span>
                      {index === 0 && isHost && room.status === 'waiting' && (
                        <button
                          aria-label={`Tambah bot level ${difficulty}`}
                          className="lobby-button lobby-button-secondary lobby-add-bot-button"
                          disabled={room.players.length >= room.rules.maximumPlayers}
                          onClick={addBot}
                          type="button"
                        >
                          + Tambah bot
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {isHost && room.status === 'waiting' && (
                <fieldset className="lobby-bot-difficulty">
                  <legend>Level bot</legend>
                  <div className="lobby-difficulty-options">
                    {difficultyOptions.map((option) => (
                      <label className="lobby-difficulty-option" key={option.value}>
                        <input
                          checked={difficulty === option.value}
                          name="bot-difficulty"
                          onChange={() => setDifficulty(option.value)}
                          type="radio"
                          value={option.value}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="lobby-actions">
                {!ownPlayer?.isBot && room.status === 'waiting' && (
                  <button
                    className={`lobby-button ${ownPlayer?.ready ? 'lobby-button-secondary' : 'lobby-button-primary'}`}
                    onClick={setReady}
                    type="button"
                  >
                    {ownPlayer?.ready ? 'Batalkan siap' : 'Saya siap'}
                  </button>
                )}
                {isHost && room.status === 'waiting' && (
                  <div className="lobby-start-action">
                    <button
                      aria-describedby={startDisabled ? 'start-game-hint' : undefined}
                      className={`lobby-button ${startDisabled ? 'lobby-button-secondary' : 'lobby-button-primary'}`}
                      disabled={startDisabled}
                      onClick={startGame}
                      type="button"
                    >
                      Mulai game
                    </button>
                    {startDisabled && (
                      <p className="lobby-action-hint" id="start-game-hint">
                        {room.players.length < 2
                          ? 'Butuh minimal 2 pemain'
                          : 'Tunggu semua pemain siap'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <aside className="lobby-rules" aria-labelledby="lobby-rules-title">
              <h2 id="lobby-rules-title">Aturan meja</h2>
              <p className="lobby-rule-summary">
                {room.rules.startingHand} kartu · {room.rules.maximumPlayers} pemain ·{' '}
                {room.rules.turnTimer === 0 ? 'timer mati' : `${room.rules.turnTimer} detik`} · target{' '}
                {room.rules.targetScore === 0 ? 'tanpa batas' : room.rules.targetScore}
              </p>
              {Object.entries(ruleLabels).some(([rule]) => room.rules[rule]) ? (
                <ul className="lobby-active-rules">
                  {Object.entries(ruleLabels)
                    .filter(([rule]) => room.rules[rule])
                    .map(([rule, label]) => <li key={rule}>{label}</li>)}
                </ul>
              ) : (
                <p className="lobby-standard-rules">Aturan standar.</p>
              )}
              <p className="lobby-server-note">
                {room.status === 'waiting'
                  ? 'Room berjalan di memori server dan hilang jika server dimulai ulang.'
                  : 'Game sudah aktif.'}
              </p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
