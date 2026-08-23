import { useEffect, useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  FileCheck2,
  Files,
  MessageCircle,
  Pause,
  Play,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

type JourneyStage = {
  eyebrow: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  state: string;
};

const stages: JourneyStage[] = [
  {
    eyebrow: "01 - Sumber",
    title: "Cari data resmi",
    description: "Mesin membaca hasil SKD dari PDF pengumuman instansi.",
    icon: Files,
    state: "Membaca sumber PDF",
  },
  {
    eyebrow: "02 - Peserta",
    title: "Cocokkan peserta",
    description: "Nama, instansi, formasi, dan nilai diperiksa bersama.",
    icon: UserCheck,
    state: "Mencocokkan peserta",
  },
  {
    eyebrow: "03 - Posisi",
    title: "Baca posisi nilai",
    description: "Nilai dibandingkan dengan distribusi dan batas historis.",
    icon: BarChart3,
    state: "Menghitung posisi nilai",
  },
  {
    eyebrow: "04 - WhatsApp",
    title: "Terima hasil analisis",
    description: "Ringkasan rasionalisasi dikirim sebagai kartu WhatsApp.",
    icon: MessageCircle,
    state: "Menyiapkan kartu WhatsApp",
  },
];

export function HomeJourney() {
  const [activeStage, setActiveStage] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) setPaused(true);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(
      () => setActiveStage((current) => (current + 1) % stages.length),
      2600,
    );
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <section className="home-journey" data-stage={activeStage}>
      <div className="home-journey-top">
        <span className="home-live-state font-mono">
          <i />
          {stages[activeStage].state}
        </span>
        <button
          type="button"
          className="home-motion-toggle"
          onClick={() => setPaused((current) => !current)}
          aria-label={paused ? "Jalankan animasi" : "Jeda animasi"}
          title={paused ? "Jalankan animasi" : "Jeda animasi"}
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
      </div>

      <div className="home-journey-canvas">
        <svg className="home-route" viewBox="0 0 1000 350" preserveAspectRatio="none" aria-hidden>
          <path d="M125 180 C220 115,280 245,375 180 S530 115,625 180 S780 245,875 180" />
        </svg>
        <span className="home-route-packet" aria-hidden />

        <div className="home-journey-nodes">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <button
                type="button"
                key={stage.eyebrow}
                className={`home-journey-node ${activeStage === index ? "is-active" : ""}`}
                onClick={() => setActiveStage(index)}
                aria-pressed={activeStage === index}
              >
                <span className="home-node-head">
                  <span className="font-mono">{stage.eyebrow}</span>
                  <span className="home-node-icon">
                    <Icon className="h-4 w-4" />
                  </span>
                </span>
                <strong>{stage.title}</strong>
                <small>{stage.description}</small>
                <span className="home-node-demo">{renderDemo(index)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="home-journey-bottom">
        <div className="home-step-dots" aria-label="Tahap animasi">
          {stages.map((stage, index) => (
            <button
              type="button"
              key={stage.eyebrow}
              className={activeStage === index ? "is-active" : ""}
              onClick={() => setActiveStage(index)}
              aria-label={`Buka ${stage.title}`}
            />
          ))}
        </div>
        <div className="home-active-copy">
          <p className="font-mono">
            Tahap {activeStage + 1} dari {stages.length}
          </p>
          <strong>{stages[activeStage].title}</strong>
          <span>
            {activeStage === 0
              ? "Mulai dengan nama atau nomor peserta."
              : stages[activeStage].description}
          </span>
        </div>
        <Link to="/search" className="public-primary-button home-journey-cta">
          Mulai cek data <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

export function HomeTrustStrip() {
  return (
    <section className="home-trust-strip" aria-label="Keunggulan AnalisaCPNS">
      <TrustItem
        icon={FileCheck2}
        title="Sumber dapat diperiksa"
        description="Terhubung ke PDF dan halaman asli."
      />
      <TrustItem
        icon={ShieldCheck}
        title="Nilai tidak berdiri sendiri"
        description="Dibaca dalam konteks persaingan."
      />
      <TrustItem
        icon={MessageCircle}
        title="Hasil ringkas di WhatsApp"
        description="Satu kartu analisis yang mudah disimpan."
      />
    </section>
  );
}

function TrustItem({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="home-trust-item">
      <span>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </div>
  );
}

function renderDemo(index: number) {
  if (index === 0) {
    return (
      <span className="home-pdf-demo">
        <i />
        <i />
        <i />
        <b>
          <Search className="h-3 w-3" /> Fadila Bijaksana
        </b>
      </span>
    );
  }
  if (index === 1) {
    return (
      <span className="home-person-demo">
        <b>
          <i>FB</i>
          <span>
            FAD*** BIJ******<small>Kejaksaan RI</small>
          </span>
        </b>
        <span className="home-score-demo">
          <i>
            TWK<strong>85</strong>
          </i>
          <i>
            TIU<strong>120</strong>
          </i>
          <i>
            TKP<strong>207</strong>
          </i>
        </span>
      </span>
    );
  }
  if (index === 2) {
    return (
      <span className="home-rank-demo">
        <b>
          {[18, 31, 50, 78, 94, 72, 46].map((height, item) => (
            <i key={item} style={{ height: `${height}%` }} />
          ))}
        </b>
        <span className="home-rank-marker" />
        <small className="font-mono">
          <span>NILAI 412</span>
          <span>BATAS 420</span>
        </small>
      </span>
    );
  }
  return (
    <span className="home-phone-demo">
      <small>
        <i />
        AnalisaCPNS
      </small>
      <span>CEK RSKD-MCCNWWT4</span>
      <b>
        <small>POSISI SKD</small>
        <strong>412</strong>
        <small>Target siap dibandingkan</small>
      </b>
    </span>
  );
}
