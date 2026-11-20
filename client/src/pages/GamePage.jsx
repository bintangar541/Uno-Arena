import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { Link, useNavigate } from 'react-router-dom';
import BrandLink from '../components/common/BrandLink.jsx';
import {
  clearGuestSession,
  connectSocket,
  getGuestSession,
  socket,
} from '../socket/client.js';
import { recordGuestMatch } from '../storage/guestMatchHistory.js';

gsap.registerPlugin(MotionPathPlugin);

const cardLabels = {
  skip: 'SKIP',
  reverse: 'REV',
  draw2: '+2',
  wild: 'WILD',
  wild_draw_four: '+4',
};

const cardCornerLabels = {
  skip: '⊘',
  reverse: '↻',
  draw2: '+2',
  wild: 'W',
  wild_draw_four: '+4',
};

function CardArtwork({ card, label }) {
  const centerLabel = card.type === 'number' ? label : cardCornerLabels[card.type];
  return (
    <span className={`uno-card-face uno-face-${card.color}`}>
      <span className="uno-card-corner uno-card-corner-top">{cardCornerLabels[card.type] ?? label}</span>
      <span className={`uno-card-oval${card.color === 'wild' ? ' uno-card-oval-wild' : ''}`}>
        {card.color === 'wild' && (
          <span className="uno-wild-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
        <span className={`uno-card-symbol${card.type === 'number' ? ' is-number' : ''}`}>
          {centerLabel}
        </span>
      </span>
      <span className="uno-card-corner uno-card-corner-bottom">
        {cardCornerLabels[card.type] ?? label}
      </span>
    </span>
  );
}

function canCombineCards(firstCard, candidate) {
  if (firstCard.type === 'number') {
    return candidate.type === 'number' && candidate.value === firstCard.value;
  }
  const firstIsDrawCard = firstCard.type === 'draw2' || firstCard.type === 'wild_draw_four';
  const candidateIsDrawCard = candidate.type === 'draw2' || candidate.type === 'wild_draw_four';
  return firstIsDrawCard && candidateIsDrawCard;
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function CardFace({
  card,
  disabled,
  onClick,
  selected = false,
  cardRef,
  style,
  className = '',
  dimmed = true,
}) {
  const label = card.type === 'number' ? card.value : cardLabels[card.type];
  return (
    <button
      aria-label={`${card.color} ${card.type === 'number' ? card.value : card.type}`}
      className={`uno-card relative flex h-28 w-[4.25rem] shrink-0 items-center justify-center rounded-[0.85rem] border-2 shadow-lg transition duration-150 sm:h-32 sm:w-[4.75rem] ${
        disabled ? `cursor-not-allowed ${dimmed ? 'is-dimmed' : ''}` : 'cursor-pointer hover:brightness-110'
      } ${
        selected ? 'is-selected ring-2 ring-[#d8f36a]' : ''
      } ${className}`}
      disabled={disabled}
      onClick={onClick}
      ref={cardRef}
      style={style}
      type="button"
    >
      <CardArtwork card={card} label={label} />
    </button>
  );
}

function CardBack({ className = '' }) {
  return (
    <span className={`card-back flex h-9 w-6 items-center justify-center rounded-md border border-white/60 bg-[#252a2b] shadow-md ${className}`}>
      <span className="flex h-6 w-4 items-center justify-center rounded border border-[#d8f36a]/70 text-[5px] font-black italic text-[#d8f36a]">
        UNO
      </span>
    </span>
  );
}

function Opponent({ player, isTurn, isUno, registerElement }) {
  return (
    <div
      className={`opponent-seat flex min-w-32 items-center gap-3 rounded-xl border px-3 py-2 ${
        isTurn ? 'is-turn border-[#d8f36a]/60 bg-[#d8f36a]/[0.07]' : 'border-white/10 bg-black/10'
      }`}
      ref={(element) => registerElement(player.id, element)}
    >
      <span className="player-avatar flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-black text-white/65">
        {player.name.slice(0, 1).toUpperCase()}
      </span>
      <div>
        <p className="flex items-center gap-1.5">
          <span className="max-w-28 truncate text-xs font-bold text-white">{player.name}</span>
          {isUno && (
            <span className="rounded-full bg-[#f05252] px-1.5 py-0.5 text-[8px] font-black text-white">
              UNO
            </span>
          )}
        </p>
        <p className="mt-1 text-[10px] text-white/45">
          <span
            className="opponent-card-count-pop inline-block"
            key={`${player.cardCount}-${player.finishPlace ?? ''}`}
          >
            {player.finishPlace ? `Peringkat ke-${player.finishPlace}` : `${player.cardCount} kartu`}
          </span>
          {player.isBot ? ' · BOT' : ''}
          {player.finishPlace === 1 ? ' · WINNER' : ''}
        </p>
      </div>
      {!player.finishPlace && (
        <span className="relative ml-auto h-9 w-7 shrink-0" aria-hidden="true">
          <CardBack className="absolute left-0 top-0 rotate-[-12deg]" />
          <CardBack className="absolute left-1 top-0 rotate-[8deg]" />
        </span>
      )}
      {isTurn && <span className="ml-auto h-2 w-2 rounded-full bg-[#d8f36a]" />}
    </div>
  );
}

function createMatchRecord(session, state) {
  const finishOrder = state.finishOrder.flatMap((playerId, index) => {
    const player = state.players.find((candidate) => candidate.id === playerId);
    return player
      ? [{
        playerId,
        name: player.name,
        place: index + 1,
        cardCount: player.cardCount,
        score: state.scoreboard[playerId] ?? 0,
      }]
      : [];
  });
  const ownResult = finishOrder.find((player) => player.playerId === session.playerId);
  if (!ownResult) {
    return null;
  }

  return {
    id: `${state.matchId ?? session.roomCode}:${state.roundNumber}`,
    roomCode: session.roomCode,
    roundNumber: state.roundNumber,
    playedAt: new Date().toISOString(),
    playerName: session.name,
    place: ownResult.place,
    playerScore: ownResult.score,
    playerCount: finishOrder.length,
    winnerId: state.winnerId,
    winnerName: finishOrder[0]?.name ?? 'Pemain',
    roundScore: state.roundScore ?? 0,
    finishOrder,
  };
}

export default function GamePage() {
  const session = getGuestSession();
  const navigate = useNavigate();
  const [game, setGame] = useState(null);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [selectedComboCardIds, setSelectedComboCardIds] = useState([]);
  const [lastEvent, setLastEvent] = useState('');
  const [timerDeadline, setTimerDeadline] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [playedCard, setPlayedCard] = useState(null);
  const [flyingCards, setFlyingCards] = useState([]);
  const playerNames = useRef(new Map());
  const opponentElements = useRef(new Map());
  const handCardElements = useRef(new Map());
  const flightElements = useRef(new Map());
  const flightAnimations = useRef(new Map());
  const discardElement = useRef(null);
  const discardCardElement = useRef(null);
  const turnBadgeElement = useRef(null);
  const eventBannerElement = useRef(null);
  const animationCounter = useRef(0);
  const previousHandCardIds = useRef(null);
  const handAnimation = useRef(null);
  const discardAnimation = useRef(null);
  const isMyTurn = Boolean(
    game && session?.playerId && game.currentPlayerId === session.playerId,
  );
  const myPlayer = game?.players.find((player) => player.id === session?.playerId);
  const opponents = useMemo(
    () => game?.players    .filter((player) => (
      player.id !== session?.playerId
      && player.cardCount > 0
      && !player.finishPlace
    )) ?? [],
    [game?.players, session?.playerId],
  );
  const playableCards = new Set(game?.playableCardIds ?? []);
  playerNames.current = new Map(game?.players.map((player) => [player.id, player.name]) ?? []);
  const isHost = room?.hostId === session?.playerId;
  const secondsRemaining = timerDeadline
    ? Math.max(0, Math.ceil((timerDeadline - now) / 1000))
    : null;
  const unoDeadline = game?.unoWindow?.declared
    ? null
    : game?.unoWindow?.deadlineAt ?? null;
  const unoSecondsRemaining = unoDeadline
    ? Math.max(0, Math.ceil((unoDeadline - now) / 1000))
    : null;
  const registerOpponentElement = useCallback((playerId, element) => {
    if (element) {
      opponentElements.current.set(playerId, element);
    } else {
      opponentElements.current.delete(playerId);
    }
  }, []);

  useEffect(() => {
    if (!session?.reconnectToken) {
      setError('Sesi tamu tidak ditemukan. Kembali ke dashboard dan bergabung ke room.');
      return undefined;
    }

    const onGameState = (state) => {
      setGame(state);
      setTimerDeadline(state.turnTimerDeadline);
      setError('');
      if (state.currentPlayerId !== session.playerId || state.status !== 'playing') {
        setSelectedComboCardIds([]);
      }
      if (state.status === 'finished') {
        try {
          const match = createMatchRecord(session, state);
          if (match) {
            recordGuestMatch(match);
          }
        } catch (storageError) {
          console.error('Could not save guest match history:', storageError);
          setError(`Riwayat pertandingan gagal disimpan: ${storageError.message}`);
        }
      }
      if (state.lastAction?.type === 'player-finished') {
        const player = state.players.find(
          (candidate) => candidate.id === state.lastAction.playerId,
        );
        setLastEvent(`${player?.name ?? 'Pemain'} mendapat peringkat ke-${state.lastAction.place}.`);
      } else if (state.status === 'finished') {
        setLastEvent('Ronde selesai.');
      }
    };
    const onRoom = (updatedRoom) => setRoom(updatedRoom);
    const onCardPlayed = ({ playerId, card, cards, color }) => {
      const playedCards = Array.isArray(cards) && cards.length > 0 ? cards : [card];
      const topCard = playedCards[playedCards.length - 1];
      if (!topCard) {
        return;
      }
      const playerName = playerNames.current.get(playerId)
        ?? (playerId === session.playerId ? session.name : 'Pemain');
      setPlayedCard({ cardId: topCard.id, playerId });
      setLastEvent(
        playedCards.length > 1
          ? `${playerName} memainkan ${playedCards.length} kartu bersama · ${color}.`
          : `${playerName} memainkan ${topCard.type === 'number' ? topCard.value : topCard.type} · ${color}.`,
      );

      if (prefersReducedMotion()) {
        return;
      }

      const isOwnPlay = playerId === session.playerId;
      const target = discardElement.current?.getBoundingClientRect();
      if (!target) {
        return;
      }

      const width = 68;
      const height = 112;
      const endLeft = target.left + (target.width - width) / 2;
      const endTop = target.top + (target.height - height) / 2;
      const flights = playedCards.flatMap((playedCard, index) => {
        const sourceElement = isOwnPlay
          ? handCardElements.current.get(playedCard.id)
          : opponentElements.current.get(playerId);
        const source = sourceElement?.getBoundingClientRect();
        if (!source) {
          return [];
        }

        const spread = (index - (playedCards.length - 1) / 2) * 5;
        const startLeft = source.left + (source.width - width) / 2 + spread;
        const startTop = source.top + (source.height - height) / 2;
        const id = `${playedCard.id}-${animationCounter.current += 1}`;
        return [{
          id,
          card: playedCard,
          isOwnPlay,
          startLeft,
          startTop,
          deltaX: endLeft - startLeft,
          deltaY: endTop - startTop,
        }];
      });
      setFlyingCards((current) => [...current, ...flights]);
    };
    const onCardDrawn = ({ playerId, count }) => {
      const playerName = playerNames.current.get(playerId) ?? 'Pemain';
      setLastEvent(`${playerName} mengambil ${count} kartu.`);
    };
    const onUnoDeclared = ({ playerId }) => {
      const playerName = playerNames.current.get(playerId) ?? 'Pemain';
      setLastEvent(`${playerName} menyatakan UNO!`);
    };
    const onUnoCaught = ({ playerId, caughtPlayerId, count }) => {
      const catcherName = playerNames.current.get(playerId) ?? 'Pemain';
      const caughtName = playerNames.current.get(caughtPlayerId) ?? 'Pemain';
      setLastEvent(`${catcherName} menangkap UNO ${caughtName}. ${caughtName} mengambil ${count} kartu.`);
    };
    const onMatchRematched = () => setLastEvent('Pertandingan baru dimulai.');
    const onReconnected = (response) => setRoom(response.room);
    const onRoomClosed = () => {
      clearGuestSession();
      navigate('/dashboard', { replace: true });
    };
    const onTimerUpdated = ({ deadline }) => setTimerDeadline(deadline);
    const onTimerExpired = ({ playerId }) => {
      setTimerDeadline(null);
      setLastEvent(`${playerNames.current.get(playerId) ?? 'Pemain'} kehabisan waktu.`);
    };
    const onError = (socketError) => {
      if (['NOT_IN_ROOM', 'RECONNECT_EXPIRED'].includes(socketError?.code)) {
        clearGuestSession();
        navigate('/dashboard', { replace: true });
        return;
      }
      setError(socketError?.message || 'Aksi tidak dapat diproses.');
    };
    const onDisconnected = ({ playerId }) => {
      const playerName = playerNames.current.get(playerId) ?? 'Pemain';
      setLastEvent(`${playerName} terputus. Menunggu reconnect.`);
    };
    const onConnect = () => socket.emit('game:request-state', {});

    socket.on('game:state-updated', onGameState);
    socket.on('room:updated', onRoom);
    socket.on('game:card-played', onCardPlayed);
    socket.on('game:card-drawn', onCardDrawn);
    socket.on('game:uno-declared', onUnoDeclared);
    socket.on('game:uno-caught', onUnoCaught);
    socket.on('game:match-rematched', onMatchRematched);
    socket.on('player:disconnected', onDisconnected);
    socket.on('player:reconnected', onReconnected);
    socket.on('room:closed', onRoomClosed);
    socket.on('game:timer-updated', onTimerUpdated);
    socket.on('game:timer-expired', onTimerExpired);
    socket.on('error', onError);
    socket.on('session:expired', onRoomClosed);
    connectSocket();
    if (socket.connected) {
      socket.emit('game:request-state', {});
    } else {
      socket.once('connect', onConnect);
    }

    return () => {
      socket.off('game:state-updated', onGameState);
      socket.off('room:updated', onRoom);
      socket.off('game:card-played', onCardPlayed);
      socket.off('game:card-drawn', onCardDrawn);
      socket.off('game:uno-declared', onUnoDeclared);
      socket.off('game:uno-caught', onUnoCaught);
      socket.off('game:match-rematched', onMatchRematched);
      socket.off('player:disconnected', onDisconnected);
      socket.off('player:reconnected', onReconnected);
      socket.off('room:closed', onRoomClosed);
      socket.off('game:timer-updated', onTimerUpdated);
      socket.off('game:timer-expired', onTimerExpired);
      socket.off('error', onError);
      socket.off('session:expired', onRoomClosed);
      socket.off('connect', onConnect);
    };
  }, [navigate, session?.reconnectToken, session?.playerId, session?.name]);

  useEffect(() => {
    for (const [index, flight] of flyingCards.entries()) {
      if (flightAnimations.current.has(flight.id)) {
        continue;
      }
      const element = flightElements.current.get(flight.id);
      if (!element) {
        continue;
      }
      const inner = element.querySelector('.card-flight-inner');
      const animation = gsap.timeline({
        delay: index * 0.08,
        onComplete: () => {
          setFlyingCards((current) => current.filter(
            (currentFlight) => currentFlight.id !== flight.id,
          ));
          flightAnimations.current.delete(flight.id);
        },
      });
      const arcHeight = Math.min(
        36,
        Math.max(14, Math.hypot(flight.deltaX, flight.deltaY) * 0.06),
      );
      animation.fromTo(
        element,
        { x: 0, y: 0, opacity: 0, scale: 0.68, rotation: -7, transformOrigin: '50% 50%' },
        {
          motionPath: {
            path: [
              { x: 0, y: 0 },
              { x: flight.deltaX * 0.25, y: flight.deltaY * 0.25 - arcHeight },
              { x: flight.deltaX * 0.75, y: flight.deltaY * 0.75 - arcHeight },
              { x: flight.deltaX, y: flight.deltaY },
            ],
            curviness: 1.15,
          },
          scale: 0.96,
          rotation: 3,
          duration: 1.35,
          ease: 'power2.inOut',
        },
        0,
      );
      animation.fromTo(
        element,
        { opacity: 0 },
        { opacity: 1, duration: 0.32, ease: 'power1.out' },
        0.04,
      );
      animation.to(
        element,
        { scale: 1, rotation: 0, duration: 0.18, ease: 'power2.out' },
        1.35,
      );
      if (!flight.isOwnPlay && inner) {
        animation.fromTo(
          inner,
          { rotationY: 0 },
          { rotationY: 180, duration: 0.85, ease: 'power2.inOut' },
          0.24,
        );
      }
      animation.to(
        element,
        { opacity: 0, duration: 0.2, ease: 'power1.out' },
        1.48,
      );
      flightAnimations.current.set(flight.id, animation);
    }
  }, [flyingCards]);

  useEffect(() => {
    const hand = game?.hand;
    if (!hand) {
      return;
    }
    const previousIds = previousHandCardIds.current;
    const nextIds = new Set(hand.map((card) => card.id));
    if (previousIds && !prefersReducedMotion()) {
      const newCards = hand
        .filter((card) => !previousIds.has(card.id))
        .map((card) => handCardElements.current.get(card.id))
        .filter(Boolean);
      if (newCards.length > 0) {
        handAnimation.current?.kill();
        handAnimation.current = gsap.fromTo(
          newCards,
          { y: 12, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.42,
            stagger: 0.05,
            ease: 'power2.out',
            overwrite: 'auto',
          },
        );
      }
    }
    previousHandCardIds.current = nextIds;
  }, [game?.hand]);

  useEffect(() => {
    const card = discardCardElement.current;
    if (
      !playedCard
      || playedCard.cardId !== game?.topCard?.id
      || !card
      || prefersReducedMotion()
    ) {
      return;
    }
    discardAnimation.current?.kill();
    discardAnimation.current = gsap.fromTo(
      card,
      { y: -14, scale: 0.84, rotation: -5, opacity: 0.7 },
      {
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        duration: 0.68,
        ease: 'power2.out',
        overwrite: 'auto',
      },
    );
  }, [playedCard, game?.topCard?.id]);

  useEffect(() => {
    const badge = turnBadgeElement.current;
    if (!badge || !game?.currentPlayerId || prefersReducedMotion()) {
      return;
    }
    gsap.fromTo(
      badge,
      { scale: 0.96, opacity: 0.72 },
      { scale: 1, opacity: 1, duration: 0.7, ease: 'power2.out', overwrite: 'auto' },
    );
  }, [game?.currentPlayerId]);

  useEffect(() => {
    const banner = eventBannerElement.current;
    if (!banner || !lastEvent || prefersReducedMotion()) {
      return;
    }
    gsap.fromTo(
      banner,
      { y: 5, opacity: 0.55 },
      { y: 0, opacity: 1, duration: 0.22, ease: 'power2.out', overwrite: 'auto' },
    );
  }, [lastEvent]);

  useEffect(() => () => {
    for (const animation of flightAnimations.current.values()) {
      animation.kill();
    }
    handAnimation.current?.kill();
    discardAnimation.current?.kill();
    gsap.killTweensOf(
      [turnBadgeElement.current, eventBannerElement.current].filter(Boolean),
    );
    flightAnimations.current.clear();
  }, []);

  useEffect(() => {
    if (!timerDeadline && !unoDeadline) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (!timerDeadline && unoDeadline && currentTime >= unoDeadline) {
        window.clearInterval(interval);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [timerDeadline, unoDeadline]);

  function playSelectedCards(cardIds) {
    setError('');
    socket.emit('game:play-card', { cardIds });
    setSelectedComboCardIds([]);
  }

  function selectCard(card) {
    if (game?.colorChoiceRequired) {
      return;
    }
    const firstSelectedCard = game.hand.find(
      (candidate) => candidate.id === selectedComboCardIds[0],
    );
    if (firstSelectedCard) {
      if (!canCombineCards(firstSelectedCard, card)) {
        return;
      }
      setSelectedComboCardIds((current) => {
        if (current.includes(card.id)) {
          if (current.length === 1) {
            return [];
          }
          return current[0] === card.id
            ? current.slice(1)
            : current.filter((id) => id !== card.id);
        }
        return [...current, card.id];
      });
      return;
    }
    if (!playableCards.has(card.id)) {
      return;
    }
    const comboCardIds = game.drawnCardId
      ? [card.id]
      : game.hand
        .filter((candidate) => canCombineCards(card, candidate))
        .map((candidate) => candidate.id);
    if (comboCardIds.length > 1) {
      setSelectedComboCardIds([card.id]);
      return;
    }
    playSelectedCards([card.id]);
  }

  function isCardSelectable(card) {
    if (game?.colorChoiceRequired) {
      return false;
    }
    const firstSelectedCard = game?.hand.find(
      (candidate) => candidate.id === selectedComboCardIds[0],
    );
    return firstSelectedCard
      ? canCombineCards(firstSelectedCard, card)
      : playableCards.has(card.id);
  }

  function drawCard() {
    setError('');
    setSelectedComboCardIds([]);
    socket.emit('game:draw-card', {});
  }

  function passTurn() {
    setError('');
    setSelectedComboCardIds([]);
    socket.emit('game:pass-turn', {});
  }

  function declareUno() {
    setError('');
    socket.emit('game:declare-uno', {});
  }

  function catchUno() {
    setError('');
    socket.emit('game:catch-uno', {});
  }

  function chooseColor(color) {
    setError('');
    socket.emit('game:choose-color', { color });
  }

  function startNextRound() {
    setError('');
    socket.emit('game:next-round', {});
  }

  function rematchGame() {
    setError('');
    socket.emit('game:rematch', {});
  }

  const isUnoAvailable = Boolean(
    game?.unoWindow
      && game.unoWindow.playerId === session?.playerId
      && !game.unoWindow.declared
      && game.unoWindow.deadlineAt > now,
  );
  const isUnoCatchAvailable = Boolean(
    game?.status === 'playing'
      && myPlayer
      && !myPlayer.finishPlace
      && game.unoWindow
      && game.unoWindow.playerId !== session?.playerId
      && !game.unoWindow.declared
      && game.unoWindow.deadlineAt > now,
  );
  const canDraw = isMyTurn && !game?.drawnCardId && game?.status === 'playing';
  const canPass = isMyTurn
    && Boolean(game?.drawnCardId)
    && !game?.playableCardIds.includes(game.drawnCardId);
  const activePlayerName = game?.players.find(
    (player) => player.id === game?.currentPlayerId,
  )?.name;
  const turnLabel = isMyTurn
    ? 'Giliranmu'
    : activePlayerName
      ? `Giliran ${activePlayerName}`
      : 'Menghubungkan';

  return (
    <div className="game-screen flex min-h-screen flex-col text-[#f5f5f0]">
      <header className="game-topbar">
        <div className="mx-auto flex h-[4.25rem] w-full max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-8">
          <BrandLink />
          <div className="game-topbar-meta flex items-center gap-3">
            {room?.code && (
              <span className="room-stamp hidden sm:inline-flex">
                ROOM <b>{room.code}</b>
              </span>
            )}
            <Link
              className="leave-table-link"
              to="/lobby"
            >
              <span aria-hidden="true">←</span> Lobby
            </Link>
          </div>
        </div>
      </header>

      <main className="game-main mx-auto flex w-full max-w-[90rem] flex-1 flex-col px-4 py-5 sm:px-8 sm:py-7">
        <div className="game-heading">
          <div className="game-title">
            <p className="game-kicker">
              <span className="live-dot" /> ROOM IN PROGRESS <span className="kicker-divider">/</span> RONDE {game?.roundNumber ?? '—'}
            </p>
            <h1>
              {game?.status === 'finished' ? 'Ronde selesai' : 'Meja'}<span className="title-period">.</span>
            </h1>
          </div>
          <div
            className={`turn-pill ${isMyTurn ? 'turn-pill-mine' : ''}`}
            ref={turnBadgeElement}
          >
            <span className="turn-pill-label">GILIRAN SEKARANG</span>
            <span className="turn-pill-value"><i />{turnLabel}</span>
          </div>
          {secondsRemaining !== null && (
              <span className={`game-clock ${
                secondsRemaining <= 5
                  ? 'game-clock-urgent'
                  : ''
              }`}>
                <span>SISA WAKTU</span>
                <b>{Math.floor(secondsRemaining / 60).toString().padStart(2, '0')}:
                  {(secondsRemaining % 60).toString().padStart(2, '0')}</b>
              </span>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-[#f05252]/25 bg-[#f05252]/[0.06] px-4 py-3 text-sm text-[#ff8585]" role="alert">
            {error}
          </p>
        )}

        {!game ? (
          <div className="game-loading mt-8">
            <span className="loading-mark" aria-hidden="true">U</span>
            Menyambungkan ke meja permainan...
          </div>
        ) : (
          <>
            <section
              className="arena-table mt-5 flex flex-1 flex-col justify-between p-4 sm:mt-7 sm:p-7"
              aria-label="Meja permainan UNO"
            >
              <div className="game-table-topline">
                <span>ARENA <b>{room?.code ?? 'PRIVATE TABLE'}</b></span>
                <span>{game.players.length} PEMAIN <i /> CLASSIC RULES</span>
              </div>

              <div className="game-opponents flex flex-wrap justify-center gap-3">
                {opponents.map((player) => (
                  <Opponent
                    isTurn={game.currentPlayerId === player.id}
                    isUno={game.unoWindow?.playerId === player.id && !game.unoWindow.declared}
                    key={player.id}
                    player={player}
                    registerElement={registerOpponentElement}
                  />
                ))}
              </div>

              <div className="game-play-zone my-6 flex flex-wrap items-center justify-center gap-7 sm:my-8 sm:gap-12">
                <div className="table-mark" aria-hidden="true">UA</div>
                <div className="flex flex-col items-center gap-2">
                  <button
                    aria-label="Ambil kartu"
                    className={`draw-pile flex h-28 w-[4.25rem] items-center justify-center rounded-xl border-2 text-3xl font-black text-white transition sm:h-32 sm:w-[4.75rem] ${
                      canDraw ? 'cursor-pointer hover:-translate-y-1 hover:border-[#d8f36a]' : 'cursor-not-allowed opacity-45'
                    }`}
                    disabled={!canDraw}
                    onClick={drawCard}
                    type="button"
                  >
                    <span>U</span>
                  </button>
                  <span className="pile-caption">
                    <b>{game.drawPileCount}</b> KARTU
                  </span>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className="relative" ref={discardElement}>
                    {game.topCard ? (
                      <CardFace
                        card={game.topCard}
                        cardRef={(element) => {
                          discardCardElement.current = element;
                        }}
                        disabled
                        dimmed={false}
                        className={
                          playedCard?.cardId === game.topCard.id
                            ? 'is-discard-landing'
                            : ''
                        }
                        key={playedCard?.cardId === game.topCard.id
                          ? `${game.topCard.id}-${playedCard.playerId}`
                          : game.topCard.id}
                      />
                    ) : (
                      <div className="h-28 w-[4.25rem] rounded-xl border border-dashed border-white/25 sm:h-32 sm:w-[4.75rem]" />
                    )}
                  </div>
                  <span className="discard-caption flex items-center gap-2">
                    <span className={`color-chip color-chip-${game.currentColor}`} />
                    TOP CARD <b>{game.currentColor.toUpperCase()}</b>
                  </span>
                </div>
                <span
                  className={`direction-mark ${game.direction < 0 ? 'direction-reverse' : ''}`}
                  aria-label={game.direction < 0 ? 'Arah berlawanan' : 'Arah permainan'}
                >
                  {game.direction < 0 ? '↶' : '↷'}
                </span>
              </div>

              {isUnoCatchAvailable && (
                <div className="uno-catch-banner mx-auto mb-4 flex flex-wrap items-center justify-center gap-3 px-4 py-3">
                  <p>
                    {playerNames.current.get(game.unoWindow.playerId) ?? 'Pemain'} lupa menyatakan UNO?
                  </p>
                  <button
                    aria-label={`Tangkap UNO sebelum ${unoSecondsRemaining} detik`}
                    className="catch-uno-button"
                    onClick={catchUno}
                    type="button"
                  >
                    TANGKAP UNO! · {unoSecondsRemaining}s
                  </button>
                </div>
              )}

              <div className="game-table-footer flex flex-wrap items-center justify-center gap-3">
                <span className="table-rule-chip">
                  {game.pendingDraw > 0 ? `PENALTI +${game.pendingDraw}` : `RONDE ${game.roundNumber}`}
                </span>
                {game.rules.stackingDrawCards && (
                  <span className="table-rule-chip">
                    STACKING
                  </span>
                )}
              </div>
            </section>

            <section className="player-zone mt-5" aria-label="Kartu di tangan">
              <div className="player-zone-heading mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="player-nameplate">
                    <span className="player-nameplate-icon">
                      {(myPlayer?.name ?? session?.name ?? 'P').slice(0, 1).toUpperCase()}
                    </span>
                    <b>{myPlayer?.name ?? session?.name}</b>
                    <span className="player-hand-count">
                      {myPlayer?.finishPlace
                        ? `Peringkat ke-${myPlayer.finishPlace} · menunggu hasil`
                        : `${game.hand.length} kartu`}
                    </span>
                  </p>
                  <p className="player-zone-hint">PILIH KARTU YANG COCOK DENGAN WARNA ATAU ANGKA</p>
                </div>
                <div className="player-actions flex items-center gap-2">
                  {canPass && (
                    <button
                      className="secondary-game-action"
                      onClick={passTurn}
                      type="button"
                    >
                      Lewati giliran
                    </button>
                  )}
                  {isUnoAvailable && (
                    <button
                      aria-label={`Deklarasikan UNO dalam ${unoSecondsRemaining} detik`}
                      className="uno-call-button"
                      onClick={declareUno}
                      type="button"
                    >
                      UNO! · {unoSecondsRemaining}s
                    </button>
                  )}
                </div>
              </div>
              <div className="player-hand-scroll overflow-x-auto pb-3">
                <div className="player-hand flex min-h-32 w-max min-w-full items-end justify-center gap-0 px-1 pt-3">
                  {game.hand.map((card, index) => (
                    <CardFace
                      card={card}
                      cardRef={(element) => {
                        if (element) {
                          handCardElements.current.set(card.id, element);
                        } else {
                          handCardElements.current.delete(card.id);
                        }
                      }}
                      disabled={!isCardSelectable(card)}
                      key={card.id}
                      onClick={() => selectCard(card)}
                      selected={selectedComboCardIds.includes(card.id)}
                      style={{
                        '--card-rotation': `${(index - (game.hand.length - 1) / 2) * 1.15}deg`,
                      }}
                    />
                  ))}
                </div>
              </div>
              {selectedComboCardIds.length > 0 && (
                <div className="combo-actions mt-2 flex flex-wrap items-center justify-center gap-2">
                  <p className="combo-note mr-1">
                    {selectedComboCardIds.length} kartu dipilih · angka sama atau +2/+4
                  </p>
                  <button
                    className="secondary-game-action"
                    onClick={() => setSelectedComboCardIds([])}
                    type="button"
                  >
                    Batal
                  </button>
                  <button
                    className="play-combo-button"
                    onClick={() => playSelectedCards(selectedComboCardIds)}
                    type="button"
                  >
                    Mainkan {selectedComboCardIds.length} kartu
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {lastEvent && (
          <p
            className="game-event mt-3 text-center text-xs"
            ref={eventBannerElement}
            aria-live="polite"
          >
            {lastEvent}
          </p>
        )}
      </main>

      {flyingCards.map((flight) => {
        const label = flight.card.type === 'number'
          ? flight.card.value
          : cardLabels[flight.card.type];
        return (
          <div
            aria-hidden="true"
            className="card-flight"
            key={flight.id}
            ref={(element) => {
              if (element) {
                flightElements.current.set(flight.id, element);
              } else {
                flightElements.current.delete(flight.id);
              }
            }}
            style={{
              left: `${flight.startLeft}px`,
              top: `${flight.startTop}px`,
            }}
          >
            <div className={`card-flight-inner${flight.isOwnPlay ? ' card-flight-inner-face-up' : ''}`}>
              <div className="card-flight-back"><span>UNO</span></div>
              <div className="card-flight-front">
                <CardArtwork card={flight.card} label={label} />
              </div>
            </div>
          </div>
        );
      })}

      {game?.colorChoiceRequired && (
        <div className="color-choice-backdrop" role="dialog" aria-modal="true" aria-labelledby="color-title">
          <div className="color-choice-panel">
            <p>WILD CARD</p>
            <h2 id="color-title">Pilih warna berikutnya</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[
                ['red', 'Merah', 'bg-[#ed4d48]'],
                ['yellow', 'Kuning', 'bg-[#f0c943] text-[#342c15]'],
                ['green', 'Hijau', 'bg-[#39a96b]'],
                ['blue', 'Biru', 'bg-[#478de0]'],
              ].map(([color, label, style]) => (
                <button
                  className={`color-choice-option min-h-12 rounded-xl font-bold text-white ${style}`}
                  key={color}
                  onClick={() => chooseColor(color)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {game?.status === 'finished' && (
        <div className="result-backdrop" role="dialog" aria-modal="true" aria-labelledby="result-title">
          <div className="result-panel">
            <p className="result-kicker">HASIL RONDE {game.roundNumber}</p>
            <h2 id="result-title">
              {game.winnerId === session?.playerId
                ? 'Kamu menang!'
                : `${game.players.find((player) => player.id === game.winnerId)?.name ?? 'Pemain'} menang`}
            </h2>
            <p className="result-score">Skor ronde <b>{game.roundScore}</b></p>
            {game.matchWinnerId && (
              <p className="result-champion-note">Pertandingan selesai — target skor tercapai.</p>
            )}
            <div className="result-scoreboard mt-5 space-y-2 text-sm">
              <div className="result-table-head grid grid-cols-[1fr_auto_auto] gap-3 px-2">
                <span>Pemain</span>
                <span>Kartu</span>
                <span>Skor total</span>
              </div>
              {game.finishOrder.map((playerId, index) => {
                const player = game.players.find((candidate) => candidate.id === playerId);
                if (!player) {
                  return null;
                }
                const placeLabel = index === 0
                  ? 'WINNER'
                  : index === game.finishOrder.length - 1
                    ? 'KALAH · TERAKHIR'
                    : `PERINGKAT ${index + 1}`;
                return (
                  <div className="result-row grid grid-cols-[1fr_auto_auto] items-center gap-3 px-2 py-2" key={player.id}>
                    <span className="min-w-0 text-left">
                      <span className="block truncate">{index + 1}. {player.name}</span>
                      <span className="result-place mt-0.5 block">{placeLabel}</span>
                    </span>
                    <span className="text-center">{player.cardCount}</span>
                    <strong className="result-total text-right">{game.scoreboard[player.id]}</strong>
                  </div>
                );
              })}
            </div>
            <Link
              className="result-secondary-action mt-6 inline-flex min-h-11 items-center"
              to="/lobby"
            >
              Kembali ke lobby
            </Link>
            {!game.matchWinnerId && isHost && (
              <button
                className="result-primary-action ml-2 mt-6 inline-flex min-h-11 items-center"
                onClick={startNextRound}
                type="button"
              >
                Main lagi · ronde berikutnya
              </button>
            )}
            {!game.matchWinnerId && !isHost && (
              <p className="mt-5 text-xs text-white/40">Menunggu host memulai ronde berikutnya.</p>
            )}
            {game.matchWinnerId && isHost && (
              <button
                className="result-primary-action ml-2 mt-6 inline-flex min-h-11 items-center"
                onClick={rematchGame}
                type="button"
              >
                Rematch
              </button>
            )}
            {game.matchWinnerId && !isHost && (
              <p className="mt-5 text-xs text-white/40">Menunggu host memulai rematch.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
