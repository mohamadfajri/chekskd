import { Resvg } from "@resvg/resvg-js";
import type { AnalysisSnapshot, Zona } from "@/lib/analysis";

const WIDTH = 1080;
const HEIGHT = 1350;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clip(value: string | null | undefined, max = 120): string {
  const text = value?.trim() || "-";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function wrap(value: string, maxChars: number, maxLines: number): string[] {
  const words = clip(value, maxChars * maxLines * 2).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:]?$/, "")}...`;
  }
  return lines;
}

function textLines(lines: string[], x: number, y: number, size: number, lineHeight: number) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" font-size="${size}" fill="#17324D">${escapeXml(line)}</text>`,
    )
    .join("");
}

function zoneStyle(zona: Zona): { fill: string; color: string } {
  if (zona === "aman") return { fill: "#DDF4EA", color: "#167052" };
  if (zona === "waspada") return { fill: "#FFF0CF", color: "#925B08" };
  return { fill: "#FBE2E3", color: "#A5363B" };
}

function score(value: number | null): string {
  return value === null ? "-" : String(value);
}

export function renderResultCardSvg(snapshot: AnalysisSnapshot): string {
  const zone = zoneStyle(snapshot.zona);
  const nameLines = wrap(snapshot.nama_peserta, 38, 2);
  const formationLines = wrap(snapshot.formasi, 48, 2);
  const institutionLines = wrap(snapshot.instansi, 50, 2);
  const analysisLines = wrap(snapshot.analysis_summary, 72, 3);
  const recommendationLines = wrap(snapshot.recommendation, 72, 3);
  const target =
    [snapshot.target_instansi, snapshot.target_formasi].filter(Boolean).join(" / ") ||
    "Belum menentukan target khusus";
  const targetLines = wrap(target, 58, 2);
  const generated = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(snapshot.generated_at));

  const metric = (label: string, value: string, x: number, highlight = false) => `
    <rect x="${x}" y="480" width="204" height="126" rx="10" fill="${highlight ? "#E7F2FC" : "#F3F6F9"}" stroke="${highlight ? "#B9D7F2" : "#DCE5ED"}"/>
    <text x="${x + 20}" y="518" font-size="20" font-weight="700" fill="#667A8E">${label}</text>
    <text x="${x + 20}" y="578" font-size="50" font-weight="800" fill="${highlight ? "#0D6CBD" : "#102A43"}">${value}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="1080" height="1350" fill="#F4F7FA"/>
    <rect x="0" y="0" width="1080" height="218" fill="#082D52"/>
    <rect x="64" y="50" width="8" height="116" fill="#38A3E3"/>
    <text x="94" y="78" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#8ECBF0">CPNSGURU.ID / SKD DATA DESK</text>
    <text x="94" y="128" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#FFFFFF">HASIL ANALISIS</text>
    <text x="94" y="174" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="#FFFFFF">DAYA SAING SKD</text>
    <rect x="850" y="54" width="166" height="46" rx="8" fill="#FFFFFF" fill-opacity="0.12"/>
    <text x="933" y="85" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#FFFFFF">DATA 2024</text>

    <rect x="48" y="250" width="984" height="1052" rx="18" fill="#FFFFFF" stroke="#D9E3EC"/>
    <text x="84" y="304" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#718397">PESERTA</text>
    <g font-family="Arial, sans-serif" font-weight="800">${textLines(nameLines, 84, 350, 36, 42)}</g>
    <text x="84" y="422" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#0D6CBD">${escapeXml(clip(snapshot.nama_panggilan, 32))}</text>
    <line x1="84" y1="450" x2="996" y2="450" stroke="#DCE5ED"/>

    <g font-family="Arial, sans-serif">
      ${metric("TWK", score(snapshot.twk), 84)}
      ${metric("TIU", score(snapshot.tiu), 308)}
      ${metric("TKP", score(snapshot.tkp), 532)}
      ${metric("TOTAL", score(snapshot.total), 756, true)}
    </g>

    <rect x="84" y="636" width="438" height="94" rx="10" fill="${snapshot.lolos_pg ? "#E1F4EC" : "#FBE2E3"}"/>
    <text x="108" y="672" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#667A8E">AMBANG BATAS</text>
    <text x="108" y="708" font-family="Arial, sans-serif" font-size="27" font-weight="800" fill="${snapshot.lolos_pg ? "#167052" : "#A5363B"}">${snapshot.lolos_pg ? "LOLOS PASSING GRADE" : "BELUM LOLOS PG"}</text>
    <rect x="542" y="636" width="418" height="94" rx="10" fill="${zone.fill}"/>
    <text x="566" y="672" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#667A8E">ZONA DAYA SAING</text>
    <text x="566" y="708" font-family="Arial, sans-serif" font-size="27" font-weight="800" fill="${zone.color}">${escapeXml(snapshot.zona_label.toUpperCase())}</text>

    <text x="84" y="780" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#718397">FORMASI ACUAN</text>
    <g font-family="Arial, sans-serif" font-weight="700">${textLines(formationLines, 84, 818, 25, 31)}</g>
    <g font-family="Arial, sans-serif">${textLines(institutionLines, 84, 884, 21, 28)}</g>

    <rect x="84" y="930" width="876" height="104" rx="10" fill="#F2F7FB" stroke="#D6E4EF"/>
    <text x="108" y="968" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0D6CBD">TARGET ${escapeXml(clip(snapshot.target_tahun, 12).toUpperCase())}</text>
    <g font-family="Arial, sans-serif" font-weight="700">${textLines(targetLines, 108, 1002, 22, 27)}</g>

    <text x="84" y="1080" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#718397">BACAAN NILAI</text>
    <g font-family="Arial, sans-serif">${textLines(analysisLines, 84, 1116, 21, 29)}</g>
    <text x="84" y="1212" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#718397">LANGKAH BERIKUTNYA</text>
    <g font-family="Arial, sans-serif">${textLines(recommendationLines, 84, 1248, 19, 26)}</g>

    <rect x="0" y="1318" width="1080" height="32" fill="#082D52"/>
    <text x="54" y="1340" font-family="Arial, sans-serif" font-size="14" fill="#D8E8F4">Simulasi berbasis data SKD ${snapshot.dataset_year}; bukan jaminan kelulusan.</text>
    <text x="1026" y="1340" text-anchor="end" font-family="Arial, sans-serif" font-size="14" fill="#D8E8F4">${escapeXml(generated)}</text>
  </svg>`;
}

export function renderResultCard(snapshot: AnalysisSnapshot): Uint8Array {
  const renderer = new Resvg(renderResultCardSvg(snapshot), {
    fitTo: { mode: "width", value: WIDTH },
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  });
  return renderer.render().asPng();
}
