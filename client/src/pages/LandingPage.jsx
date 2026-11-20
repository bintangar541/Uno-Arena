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
  ['01', 'Buat meja atau masuk pakai kode', 'Room privat, jadi kamu yang tentukan siapa ikut main.', '2-4 PEMAIN'],
  ['02', 'Atur aturan sebelum mulai', 'Tentukan stacking, Jump-In, timer, dan aturan lain.', 'CUSTOM RULES'],
  ['03', 'Main sampai kartu terakhir', 'Server mengatur giliran dan memvalidasi setiap kartu.', 'BOT 3 LEVEL'],
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
            Masuk arena <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <HeroCardScene />
          <div className="hero-copy">
            <p className="landing-eyebrow">UNO ONLINE <span>/</span> MAIN BARENG</p>
            <h1>
              Satu kartu.
              <br />
              <em>Semua panik.</em>
            </h1>
            <p className="hero-description">
              Bikin meja privat, atur rules sesukamu, lalu ajak teman main
              langsung dari browser. Nggak ada download, nggak perlu akun.
            </p>
            <div className="hero-actions">
              <Link className="hero-primary-action" to="/dashboard">
                Bikin meja <span aria-hidden="true">↗</span>
              </Link>
              <Link className="hero-secondary-action" to="/dashboard#join-room">
                Punya kode room? Gabung
              </Link>
            </div>
            <p className="hero-facts">ROOM PRIVAT <i /> BOT 3 LEVEL <i /> CUSTOM RULES</p>
          </div>
          <a className="hero-scroll" href="#how-to-play">
            <span />
            GULIR, LIHAT CARANYA
          </a>
        </section>

        <section className="how-section" id="how-to-play">
          <div className="section-lead">
            <p className="section-kicker">CARA MAIN</p>
            <h2>Mulai cepat.<br />Rusuhnya belakangan.</h2>
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
            <p className="section-kicker">KODE ROOM SUDAH ADA?</p>
            <h2>Ketemu di meja.</h2>
          </div>
          <div className="last-call-actions">
            <Link className="last-call-button" to="/dashboard">Buat room</Link>
            <Link className="last-call-link" to="/dashboard#join-room">Gabung pakai kode ↗</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <BrandLink />
        <p>UNO Arena · Main bareng, bukan sendirian.</p>
        <p className="landing-footer-credit">Dibuat oleh Bintang Ardhian Pratama</p>
        <a href="#top">Ke atas ↑</a>
      </footer>
    </div>
  );
}
