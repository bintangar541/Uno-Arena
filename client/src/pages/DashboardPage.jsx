import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandLink from '../components/common/BrandLink.jsx';
import {
  clearGuestSession,
  connectSocket,
  getGuestSession,
  requestSocketEvent,
  saveGuestSession,
  socket,
} from '../socket/client.js';
import {
  getGuestMatches,
  getGuestProfile,
  saveGuestProfileName,
} from '../storage/guestMatchHistory.js';
import './DashboardPage.css';

const apiUrl = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : '')
).replace(/\/+$/, '');
const defaultRules = {
  stackingDrawCards: false,
  jumpIn: false,
  drawUntilPlayable: false,
  forcePlay: false,
  startingHand: 7,
  turnTimer: 30,
  targetScore: 500,
  maximumPlayers: 4,
};

const ruleControls = [
  {
    name: 'startingHand',
    label: 'Kartu awal',
    options: [
      { value: 5, label: '5' },
      { value: 7, label: '7' },
      { value: 10, label: '10' },
    ],
  },
  {
    name: 'maximumPlayers',
    label: 'Maks. pemain',
    options: [
      { value: 2, label: '2' },
      { value: 3, label: '3' },
      { value: 4, label: '4' },
    ],
  },
  {
    name: 'turnTimer',
    label: 'Timer giliran',
    options: [
      { value: 15, label: '15 dtk' },
      { value: 30, label: '30 dtk' },
      { value: 60, label: '60 dtk' },
    ],
  },
  {
    name: 'targetScore',
    label: 'Target skor',
    options: [
      { value: 0, label: 'Tanpa batas' },
      { value: 300, label: '300' },
      { value: 500, label: '500' },
      { value: 1000, label: '1000' },
    ],
  },
];

function useServerStatus() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiUrl}/api/health`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Health check failed with HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((health) => {
        setStatus(health.status === 'ok' ? 'online' : 'unavailable');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setStatus('unavailable');
        }
      });

    return () => controller.abort();
  }, []);

  return status;
}

function ServiceStatus({ status }) {
  const labels = {
    checking: 'Memeriksa server',
    online: 'Server terhubung',
    unavailable: 'Server tidak terhubung',
  };

  return (
    <p
      className={`dashboard-status dashboard-status--${status}`}
      aria-live="polite"
    >
      <span className="dashboard-status-dot" />
      {labels[status]}
    </p>
  );
}

function SegmentedControl({ name, label, options, value, onChange }) {
  return (
    <fieldset className="dashboard-control">
      <legend>{label}</legend>
      <div className={`dashboard-segments dashboard-segments--${options.length}`}>
        {options.map((option) => (
          <label className="dashboard-segment" key={option.value}>
            <input
              checked={value === option.value}
              name={name}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function DashboardPage() {
  const serverStatus = useServerStatus();
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState(
    () => getGuestSession()?.name ?? getGuestProfile().name,
  );
  const [roomCode, setRoomCode] = useState('');
  const [rules, setRules] = useState(defaultRules);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [matchHistory, setMatchHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');

  const matchWins = matchHistory.filter((match) => match.place === 1).length;
  const winRate = matchHistory.length
    ? Math.round((matchWins / matchHistory.length) * 100)
    : 0;
  const hasPlayerName = playerName.trim().length >= 2;
  const hasRoomCode = roomCode.length === 6;
  const createDisabled = busy || serverStatus !== 'online' || !hasPlayerName;
  const joinDisabled = busy || serverStatus !== 'online' || !hasPlayerName || !hasRoomCode;
  const createHint = [
    busy && 'Sedang diproses…',
    !hasPlayerName && 'Isi nama dulu',
    serverStatus !== 'online' && 'Tunggu server terhubung',
  ].filter(Boolean).join(' · ');
  const joinHint = [
    busy && 'Sedang diproses…',
    !hasPlayerName && 'Isi nama dulu',
    !hasRoomCode && 'Isi kode room dulu',
    serverStatus !== 'online' && 'Tunggu server terhubung',
  ].filter(Boolean).join(' · ');

  useEffect(() => {
    try {
      setMatchHistory(getGuestMatches());
    } catch (error) {
      console.error('Could not read guest match history:', error);
      setHistoryError('Riwayat pertandingan tidak dapat dibaca dari penyimpanan browser.');
    }
  }, []);

  useEffect(() => {
    if (!getGuestSession()?.reconnectToken) {
      return undefined;
    }
    const handleReconnect = (session) => {
      saveGuestSession({ ...session, name: getGuestSession()?.name ?? playerName });
      navigate('/lobby', { replace: true });
    };
    const handleExpiredSession = () => {
      clearGuestSession();
      setActionError('Sesi room sebelumnya sudah berakhir. Kamu bisa membuat atau bergabung ke room baru.');
    };
    socket.on('player:reconnected', handleReconnect);
    socket.on('session:expired', handleExpiredSession);
    connectSocket();
    return () => {
      socket.off('player:reconnected', handleReconnect);
      socket.off('session:expired', handleExpiredSession);
    };
  }, [navigate, playerName]);

  async function enterRoom(eventName, responseName, payload) {
    setBusy(true);
    setActionError('');
    try {
      const response = await requestSocketEvent(eventName, responseName, payload);
      saveGuestProfileName(playerName.trim());
      saveGuestSession({
        roomCode: response.room.code,
        playerId: response.playerId,
        reconnectToken: response.reconnectToken,
        name: playerName.trim(),
      });
      navigate('/lobby');
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCreateRoom(event) {
    event.preventDefault();
    void enterRoom('room:create', 'room:created', {
      name: playerName,
      rules,
    });
  }

  function handleJoinRoom(event) {
    event.preventDefault();
    void enterRoom('room:join', 'room:joined', {
      name: playerName,
      code: roomCode,
    });
  }

  function toggleRule(rule) {
    setRules((current) => ({ ...current, [rule]: !current[rule] }));
  }

  function setRuleValue(rule, value) {
    setRules((current) => ({ ...current, [rule]: value }));
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <BrandLink />
          <div className="dashboard-header-actions">
            <ServiceStatus status={serverStatus} />
            <Link className="dashboard-home-link" to="/">Beranda</Link>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-welcome" aria-labelledby="dashboard-title">
          <div className="dashboard-welcome-copy">
            <h1 id="dashboard-title">Selamat datang di arena.</h1>
            <p>
              Masuk sebagai tamu, bikin meja privat, atau gabung pakai kode teman.
              Tidak perlu akun.
            </p>
          </div>
        </section>

        <div className="dashboard-name-row">
          <label className="dashboard-name-field">
            <span>Nama pemain</span>
            <input
              autoComplete="nickname"
              maxLength={20}
              minLength={2}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Contoh: Bintang"
              required
              value={playerName}
            />
          </label>
        </div>

        <section className="dashboard-paths" aria-label="Buat atau gabung room">
          <form
            className="dashboard-path"
            onSubmit={handleCreateRoom}
          >
            <h2>Buat room</h2>
            <p className="dashboard-path-description">Atur meja privatmu sebelum mulai.</p>

            <div className="dashboard-control-grid">
              {ruleControls.map((control) => (
                <SegmentedControl
                  {...control}
                  key={control.name}
                  onChange={(value) => setRuleValue(control.name, value)}
                  value={rules[control.name]}
                />
              ))}
            </div>

            <details className="dashboard-advanced">
              <summary>Aturan lanjutan</summary>
              <div className="dashboard-rule-toggles">
                {[
                  ['stackingDrawCards', 'Stacking draw cards'],
                  ['jumpIn', 'Jump-In'],
                  ['drawUntilPlayable', 'Draw until playable'],
                  ['forcePlay', 'Force play'],
                ].map(([rule, label]) => (
                  <label className="dashboard-rule-toggle" key={rule}>
                    <input
                      checked={rules[rule]}
                      onChange={() => toggleRule(rule)}
                      type="checkbox"
                    />
                    <span className="dashboard-toggle-switch" aria-hidden="true" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </details>

            <div className="dashboard-button-row">
              <button
                aria-describedby={createDisabled ? 'create-room-hint' : undefined}
                className="dashboard-button dashboard-button-primary"
                disabled={createDisabled}
                type="submit"
              >
                Buat room
              </button>
              {createDisabled && (
                <p className="dashboard-button-hint" id="create-room-hint">{createHint}</p>
              )}
            </div>
          </form>

          <form
            className="dashboard-path dashboard-join-path"
            id="join-room"
            onSubmit={handleJoinRoom}
          >
            <h2>Gabung pakai kode</h2>
            <p className="dashboard-path-description">Masukkan kode dari temanmu.</p>
            <div className="dashboard-join-row">
              <label className="dashboard-code-field">
                <span>Kode room</span>
                <input
                  autoCapitalize="characters"
                  autoComplete="off"
                  inputMode="text"
                  onChange={(event) => setRoomCode(
                    event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6),
                  )}
                  pattern="[A-Z2-9]{6}"
                  placeholder="ABC123"
                  required
                  spellCheck="false"
                  value={roomCode}
                />
              </label>
              <div className="dashboard-join-submit">
                <button
                  aria-describedby={joinDisabled ? 'join-room-hint' : undefined}
                  className="dashboard-button dashboard-button-secondary"
                  disabled={joinDisabled}
                  type="submit"
                >
                  Gabung room
                </button>
                {joinDisabled && (
                  <p className="dashboard-button-hint" id="join-room-hint">{joinHint}</p>
                )}
              </div>
            </div>
          </form>
        </section>

        {actionError && (
          <p className="dashboard-alert" role="alert">{actionError}</p>
        )}

        <section className="dashboard-history" aria-labelledby="match-history-title">
          <div className="dashboard-history-heading">
            <h2 id="match-history-title">Riwayat pertandingan</h2>
            <p className="dashboard-stats">
              {matchHistory.length} pertandingan · {matchWins} menang · {winRate}% win rate
            </p>
          </div>
          {historyError && (
            <p className="dashboard-alert" role="alert">{historyError}</p>
          )}
          {matchHistory.length === 0 ? (
            <div className="dashboard-empty-history">
              <p>Belum ada ronde. Meja masih kosong.</p>
              <span>Hasil ronde tersimpan di browser ini, tanpa login.</span>
            </div>
          ) : (
            <ul className="dashboard-match-list">
              {matchHistory.slice(0, 5).map((match) => (
                <li className="dashboard-match" key={match.id}>
                  <div>
                    <p className="dashboard-match-result">
                      {match.place === 1 ? 'Menang' : `Peringkat ke-${match.place}`}
                      <span>
                        Ronde {match.roundNumber} · {match.playerCount} pemain
                      </span>
                    </p>
                    <p className="dashboard-match-order">
                      Urutan: {match.finishOrder.map((player) => player.name).join(' → ')}
                    </p>
                    <time dateTime={match.playedAt}>
                      {new Date(match.playedAt).toLocaleString('id-ID')}
                    </time>
                  </div>
                  <div className="dashboard-match-score">
                    <p>Pemenang: {match.winnerName}</p>
                    <strong>Skor kamu: {match.playerScore}</strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
