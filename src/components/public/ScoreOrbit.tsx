import { useState, type CSSProperties } from "react";
import { ArrowUpRight, MoveUpRight, Pause, Play, SlidersHorizontal } from "lucide-react";

const samples = [
  { label: "Formasi A", cutoff: 385, heights: [25, 39, 57, 74, 88, 100, 84, 65, 43, 26, 16, 8] },
  { label: "Formasi B", cutoff: 425, heights: [8, 17, 26, 39, 53, 69, 84, 100, 88, 64, 40, 22] },
  { label: "Formasi C", cutoff: 450, heights: [6, 12, 18, 26, 38, 49, 62, 80, 100, 92, 70, 45] },
];

/** Illustrative distribution; deliberately independent of real participant data. */
export function ScoreOrbit() {
  const [score, setScore] = useState(410);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const sample = samples[sampleIndex];
  const gap = score - sample.cutoff;
  const position = ((score - 250) / 300) * 100;
  return (
    <div className={`score-orbit ${paused ? "is-paused" : ""}`}>
      <div className="orbit-toolbar">
        <span>
          <i /> LAB POSISI NILAI
        </span>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "Putar animasi" : "Jeda animasi"}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>
      <div
        className="orbit-stage"
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") return;
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty(
            "--tilt",
            `${((event.clientX - bounds.left) / bounds.width - 0.5) * 7}deg`,
          );
        }}
        onPointerLeave={(event) => event.currentTarget.style.setProperty("--tilt", "0deg")}
      >
        <div className="orbit-ring ring-one" aria-hidden="true" />
        <div className="orbit-ring ring-two" aria-hidden="true" />
        <div className="orbit-score">
          <span>NILAI SIMULASI</span>
          <strong>
            {score}
            <small>/550</small>
          </strong>
          <span className={gap >= 0 ? "gap-positive" : "gap-negative"}>
            <MoveUpRight size={13} />
            {gap >= 0 ? "+" : ""}
            {gap} dari batas contoh
          </span>
        </div>
        <div className="orbit-callout">
          <span>BATAS HISTORIS</span>
          <strong>
            {sample.cutoff}
            <ArrowUpRight size={17} />
          </strong>
        </div>
        <div className="chart-perspective" aria-hidden="true">
          <div className="chart-floor">
            <div className="chart-columns">
              {sample.heights.map((height, index) => (
                <div
                  className={`chart-column ${index > 6 ? "is-highlight" : ""}`}
                  key={index}
                  style={
                    { "--bar-height": `${height * 1.5}px`, "--bar-order": index } as CSSProperties
                  }
                >
                  <i />
                  <b />
                </div>
              ))}
            </div>
            <div className="chart-baseline">
              <span>250</span>
              <span>DISTRIBUSI NILAI</span>
              <span>550</span>
            </div>
          </div>
        </div>
        <div className="orbit-caption">
          <i /> Satu nilai bisa punya posisi berbeda.
        </div>
      </div>
      <div className="orbit-controls">
        <div className="orbit-tabs" role="group" aria-label="Pilih contoh formasi">
          {samples.map((item, index) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={sampleIndex === index}
              onClick={() => setSampleIndex(index)}
            >
              {item.label}
            </button>
          ))}
          <span>CONTOH</span>
        </div>
        <div className="orbit-slider-label">
          <label htmlFor="simulation-score">
            <SlidersHorizontal size={13} /> Geser untuk mencoba nilaimu
          </label>
          <output htmlFor="simulation-score" aria-live="polite">
            {score}
          </output>
        </div>
        <input
          id="simulation-score"
          type="range"
          min="250"
          max="550"
          step="1"
          value={score}
          onChange={(event) => setScore(Number(event.target.value))}
          style={{ "--score-position": `${position}%` } as CSSProperties}
        />
        <p>Ilustrasi interaktif, bukan hasil atau prediksi kelulusan.</p>
      </div>
    </div>
  );
}
