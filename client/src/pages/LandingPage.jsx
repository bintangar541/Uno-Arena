import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLink from '../components/common/BrandLink.jsx';
import './LandingPage.css';

const discardSequence = [
  { value: '7', color: 'red' },
  { value: '↻', color: 'green' },
  { value: '+2', color: 'blue' },
  { value: '4', color: 'yellow' },
];

const handCards = [
  { value: '5', color: 'blue', rotation: '-13deg' },
  { value: '↻', color: 'yellow', rotation: '-7deg' },
  { value: '2', color: 'green', rotation: '1deg' },
  { value: '9', color: 'red', rotation: '9deg' },
];

function Card({ value, color, rotation = '0deg', className = '' }) {
  return (
    <div
      className={`landing-playing-card ${className}`}
      style={{ '--card-rotation': rotation }}
      aria-hidden="true"
    >
      <span className={`uno-card-face uno-face-${color}`}>
        <span className="uno-card-corner uno-card-corner-top">{value}</span>
        <span className="uno-card-oval">
          <span className={`uno-card-symbol${/^\d$/.test(value) ? ' is-number' : ''}`}>
            {value}
          </span>
        </span>
        <span className="uno-card-corner uno-card-corner-bottom">{value}</span>
      </span>
    </div>
  );
}

function HeroCardScene() {
  const [discardIndex, setDiscardIndex] = useState(0);
  const discardCard = discardSequence[discardIndex];

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setDiscardIndex((index) => (index + 1) % discardSequence.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hero-scene" aria-hidden="true">
      <div className="hero-table">
        <span className="table-ring table-ring-outer" />
        <span className="table-ring table-ring-inner" />
      </div>
      <div className="scene-cards">
        <Card value="3" color="yellow" rotation="-18deg" className="scene-card scene-card-one" />
        <Card value="↻" color="blue" rotation="14deg" className="scene-card scene-card-two" />
        <Card value="5" color="green" rotation="-8deg" className="scene-card scene-card-three" />
        <Card value="8" color="red" rotation="19deg" className="scene-card scene-card-four" />
        <div className="scene-discard-slot">
          <Card
            key={`${discardCard.value}-${discardCard.color}`}
            {...discardCard}
            rotation="-4deg"
            className="scene-active-card"
          />
        </div>
        <div className="scene-hand">
          {handCards.map((card) => (
            <Card
              {...card}
              className="scene-hand-card"
              key={`${card.value}-${card.color}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const howToPlay = [
  [
    '01',
    'Bikin room atau join pake kode',
    'Buat meja privat khusus buat sirkel kamu, atau langsung masuk pake kode room dari temen.',
    '2-4 PEMAIN',
  ],
  [
    '02',
    'Pasang rules favorit tongkrongan',
    'Bebas aktifin Stacking (+2/+4 ditumpuk), Jump-In, batasan timer mikir, sampai target skor akhir.',
    'CUSTOM RULES',
  ],
  [
    '03',
    'Adu taktik sampai kartu habis',
    'Awas lupa teriak UNO pas sisa satu kartu! Kurang orang? Ada bot cerdas 3 level yang siap diajak tanding.',
    'BOT 3 LEVEL',
  ],
];

export default function LandingPage() {
  return (
    <div className="landing-page" id="top">
      <header className="landing-header">
        <div className="landing-header-inner">
          <BrandLink />
          <nav className="landing-nav" aria-label="Navigasi utama">
            <a href="#how-to-play">Cara main</a>
          </nav>
          <Link className="landing-header-cta" to="/dashboard">
            Gas main <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <HeroCardScene />
          <div className="hero-copy">
            <p className="landing-eyebrow">UNO MULTIPLAYER <span>/</span> SERU BARENG</p>
            <h1>
              Sisa satu kartu,
              <br />
              <em>malah kena +4.</em>
            </h1>
            <p className="hero-description">
              Bikin room privat, atur rules sesukamu, terus ajak temen mabar
              langsung dari browser. Nggak perlu download, nggak ribet bikin akun.
            </p>
            <div className="hero-actions">
              <Link className="hero-primary-action" to="/dashboard">
                Bikin room <span aria-hidden="true">↗</span>
              </Link>
              <Link className="hero-secondary-action" to="/dashboard#join-room">
                Punya kode room? Gabung di sini
              </Link>
            </div>
            <p className="hero-facts">ROOM PRIVAT <i /> CUSTOM RULES <i /> BOT 3 LEVEL</p>
          </div>
          <a className="hero-scroll" href="#how-to-play">
            <span />
            LIHAT CARA MAIN
          </a>
        </section>

        <section className="how-section" id="how-to-play">
          <div className="section-lead">
            <p className="section-kicker">CARA MAIN</p>
            <h2>Gampang mulainya,<br />rusuh pas mainnya.</h2>
          </div>
          <ol className="how-list">
            {howToPlay.map(([number, title, detail, tag]) => (
              <li key={number}>
                <span className="step-number">{number}</span>
                <div className="step-content">
                  <div className="step-title-row">
                    <h3>{title}</h3>
                    <span className="step-tag">{tag}</span>
                  </div>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-last-call">
          <div>
            <p className="section-kicker">UDAH SIAP RUSUH BARENG?</p>
            <h2>Ayo kumpul di meja.</h2>
          </div>
          <div className="last-call-actions">
            <Link className="last-call-button" to="/dashboard">Buat room baru</Link>
            <Link className="last-call-link" to="/dashboard#join-room">Gabung pakai kode ↗</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <BrandLink />
        <p>UNO Arena · Mabar game kartu seru langsung dari browser.</p>
        <p className="landing-footer-credit">Dibuat oleh Bintang Ardhian Pratama</p>
        <a href="#top">Kembali ke atas ↑</a>
      </footer>
    </div>
  );
}
