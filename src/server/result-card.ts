import { Resvg } from "@resvg/resvg-js";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AnalysisSnapshot, Zona } from "@/lib/analysis";
import { maskNoPeserta } from "@/lib/analysis";
import {
  rationalizationRecommendation,
  targetSimulationRecommendation,
  type RationalizationSnapshot,
  type RationalizationVerdict,
  type TargetSimulationVerdict,
} from "@/lib/rationalization";

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT_FAMILY = "Noto Sans";
let bundledFontPath: Promise<string> | null = null;

export function prepareResultCardFont(): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    return Promise.resolve(resolve(process.cwd(), "server-assets/fonts/NotoSans.ttf"));
  }

  if (!bundledFontPath) {
    bundledFontPath = (async () => {
      const { useStorage } = await import("nitro/storage");
      const font = await useStorage("assets:fonts").getItemRaw("NotoSans.ttf");
      if (!font) throw new Error("Font kartu hasil tidak tersedia.");

      const fontPath = join(tmpdir(), "cpnsguru-NotoSans.ttf");
      await writeFile(fontPath, Buffer.from(font));
      return fontPath;
    })().catch((error) => {
      bundledFontPath = null;
      throw error;
    });
  }

  return bundledFontPath;
}

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
    <text x="94" y="78" font-family="${FONT_FAMILY}" font-size="24" font-weight="700" fill="#8ECBF0">CPNSGURU.ID / SKD DATA DESK</text>
    <text x="94" y="128" font-family="${FONT_FAMILY}" font-size="44" font-weight="800" fill="#FFFFFF">HASIL ANALISIS</text>
    <text x="94" y="174" font-family="${FONT_FAMILY}" font-size="44" font-weight="800" fill="#FFFFFF">DAYA SAING SKD</text>
    <rect x="850" y="54" width="166" height="46" rx="8" fill="#FFFFFF" fill-opacity="0.12"/>
    <text x="933" y="85" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="21" font-weight="700" fill="#FFFFFF">DATA 2024</text>

    <rect x="48" y="250" width="984" height="1052" rx="18" fill="#FFFFFF" stroke="#D9E3EC"/>
    <text x="84" y="304" font-family="${FONT_FAMILY}" font-size="19" font-weight="700" fill="#718397">PESERTA</text>
    <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(nameLines, 84, 350, 36, 42)}</g>
    <text x="84" y="422" font-family="${FONT_FAMILY}" font-size="21" font-weight="700" fill="#0D6CBD">${escapeXml(clip(snapshot.nama_panggilan, 32))}</text>
    <line x1="84" y1="450" x2="996" y2="450" stroke="#DCE5ED"/>

    <g font-family="${FONT_FAMILY}">
      ${metric("TWK", score(snapshot.twk), 84)}
      ${metric("TIU", score(snapshot.tiu), 308)}
      ${metric("TKP", score(snapshot.tkp), 532)}
      ${metric("TOTAL", score(snapshot.total), 756, true)}
    </g>

    <rect x="84" y="636" width="438" height="94" rx="10" fill="${snapshot.lolos_pg ? "#E1F4EC" : "#FBE2E3"}"/>
    <text x="108" y="672" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#667A8E">AMBANG BATAS</text>
    <text x="108" y="708" font-family="${FONT_FAMILY}" font-size="27" font-weight="800" fill="${snapshot.lolos_pg ? "#167052" : "#A5363B"}">${snapshot.lolos_pg ? "LOLOS PASSING GRADE" : "BELUM LOLOS PG"}</text>
    <rect x="542" y="636" width="418" height="94" rx="10" fill="${zone.fill}"/>
    <text x="566" y="672" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#667A8E">ZONA DAYA SAING</text>
    <text x="566" y="708" font-family="${FONT_FAMILY}" font-size="27" font-weight="800" fill="${zone.color}">${escapeXml(snapshot.zona_label.toUpperCase())}</text>

    <text x="84" y="780" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#718397">FORMASI ACUAN</text>
    <g font-family="${FONT_FAMILY}" font-weight="700">${textLines(formationLines, 84, 818, 25, 31)}</g>
    <g font-family="${FONT_FAMILY}">${textLines(institutionLines, 84, 884, 21, 28)}</g>

    <rect x="84" y="930" width="876" height="104" rx="10" fill="#F2F7FB" stroke="#D6E4EF"/>
    <text x="108" y="968" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#0D6CBD">TARGET ${escapeXml(clip(snapshot.target_tahun, 12).toUpperCase())}</text>
    <g font-family="${FONT_FAMILY}" font-weight="700">${textLines(targetLines, 108, 1002, 22, 27)}</g>

    <text x="84" y="1080" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#718397">BACAAN NILAI</text>
    <g font-family="${FONT_FAMILY}">${textLines(analysisLines, 84, 1116, 21, 29)}</g>
    <text x="84" y="1212" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#718397">LANGKAH BERIKUTNYA</text>
    <g font-family="${FONT_FAMILY}">${textLines(recommendationLines, 84, 1248, 19, 26)}</g>

    <rect x="0" y="1318" width="1080" height="32" fill="#082D52"/>
    <text x="54" y="1340" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">Simulasi berbasis data SKD ${snapshot.dataset_year}; bukan jaminan kelulusan.</text>
    <text x="1026" y="1340" text-anchor="end" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">${escapeXml(generated)}</text>
  </svg>`;
}

export function renderResultCard(snapshot: AnalysisSnapshot, fontPath: string): Uint8Array {
  const renderer = new Resvg(renderResultCardSvg(snapshot), {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      loadSystemFonts: false,
      fontFiles: [fontPath],
      defaultFontFamily: FONT_FAMILY,
      sansSerifFamily: FONT_FAMILY,
    },
  });
  return renderer.render().asPng();
}

function verdictStyle(code: RationalizationVerdict): { fill: string; color: string } {
  if (code === "strong" || code === "rational") {
    return { fill: "#DDF4EA", color: "#167052" };
  }
  if (code === "borderline" || code === "less_rational") {
    return { fill: "#FFF0CF", color: "#925B08" };
  }
  return { fill: "#FBE2E3", color: "#A5363B" };
}

function signedScore(value: number | null): string {
  if (value === null) return "-";
  return value > 0 ? `+${value}` : String(value);
}

function targetVerdictStyle(code: TargetSimulationVerdict): { fill: string; color: string } {
  if (code === "very_competitive" || code === "competitive") {
    return { fill: "#DDF4EA", color: "#167052" };
  }
  if (code === "close") return { fill: "#FFF0CF", color: "#925B08" };
  return { fill: "#FBE2E3", color: "#A5363B" };
}

function renderTargetComparisonCardSvg(snapshot: RationalizationSnapshot): string {
  const target = snapshot.target_simulation!;
  const originalStyle = verdictStyle(snapshot.verdict.code);
  const targetStyle = targetVerdictStyle(target.verdict.code);
  const participant = snapshot.participant;
  const original = snapshot.formation;
  const originalPosition = snapshot.historical_position;
  const originalStats = snapshot.historical_stats;
  const nameLines = wrap(participant.name, 40, 2);
  const originalFormationLines = wrap(original.position, 67, 2);
  const originalInstitutionLines = wrap(original.institution, 75, 1);
  const targetFormationLines = wrap(target.position, 67, 2);
  const targetInstitutionLines = wrap(target.institution, 75, 1);
  const recommendationLines = wrap(targetSimulationRecommendation(target.verdict.code), 82, 3);
  const originalRank = originalPosition.overall_rank
    ? `${originalPosition.overall_rank}/${originalStats.attended}`
    : "-";
  const targetRank = target.simulated_rank ? `${target.simulated_rank}/${target.attended}` : "-";
  const generated = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(snapshot.generated_at));

  const scoreTile = (label: string, value: string, x: number, highlight = false) => `
    <rect x="${x}" y="438" width="204" height="104" rx="10" fill="${highlight ? "#E7F2FC" : "#F3F6F9"}" stroke="${highlight ? "#B9D7F2" : "#DCE5ED"}"/>
    <text x="${x + 18}" y="471" font-size="17" font-weight="700" fill="#667A8E">${label}</text>
    <text x="${x + 18}" y="519" font-size="40" font-weight="800" fill="${highlight ? "#0D6CBD" : "#102A43"}">${value}</text>`;
  const targetMetric = (label: string, value: string, x: number) => `
    <rect x="${x}" y="1070" width="194" height="82" rx="9" fill="#FFFFFF" stroke="#C9DBE9"/>
    <text x="${x + 14}" y="1098" font-size="15" font-weight="700" fill="#667A8E">${label}</text>
    <text x="${x + 14}" y="1134" font-size="29" font-weight="800" fill="#102A43">${value}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="1080" height="1350" fill="#F4F7FA"/>
    <rect width="1080" height="218" fill="#082D52"/>
    <rect x="64" y="50" width="8" height="116" fill="#38A3E3"/>
    <text x="94" y="78" font-family="${FONT_FAMILY}" font-size="24" font-weight="700" fill="#8ECBF0">CPNSGURU.ID / DATA SKD</text>
    <text x="94" y="128" font-family="${FONT_FAMILY}" font-size="42" font-weight="800" fill="#FFFFFF">SIMULASI TARGET SKD</text>
    <text x="94" y="174" font-family="${FONT_FAMILY}" font-size="29" font-weight="700" fill="#D8E8F4">NILAI SAMA, FORMASI BERBEDA</text>
    <rect x="850" y="54" width="166" height="46" rx="8" fill="#FFFFFF" fill-opacity="0.12"/>
    <text x="933" y="85" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="21" font-weight="700" fill="#FFFFFF">DATA ${snapshot.dataset_year}</text>

    <rect x="48" y="250" width="984" height="1052" rx="18" fill="#FFFFFF" stroke="#D9E3EC"/>
    <text x="84" y="300" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="#718397">PESERTA</text>
    <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(nameLines, 84, 340, 32, 38)}</g>
    <text x="84" y="414" font-family="${FONT_FAMILY}" font-size="17" fill="#667A8E">Pendidikan ${escapeXml(clip(participant.education, 45))} | No. ${escapeXml(maskNoPeserta(participant.participant_number))}</text>

    <g font-family="${FONT_FAMILY}">
      ${scoreTile("TWK", score(participant.twk), 84)}
      ${scoreTile("TIU", score(participant.tiu), 308)}
      ${scoreTile("TKP", score(participant.tkp), 532)}
      ${scoreTile("TOTAL", score(participant.total), 756, true)}
    </g>

    <rect x="84" y="570" width="876" height="228" rx="12" fill="#F7F9FB" stroke="#DCE5ED"/>
    <text x="108" y="608" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="#718397">FORMASI ASAL</text>
    <rect x="108" y="628" width="310" height="52" rx="9" fill="${originalStyle.fill}"/>
    <text x="263" y="662" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="21" font-weight="800" fill="${originalStyle.color}">${escapeXml(snapshot.verdict.label.toUpperCase())}</text>
    <text x="446" y="649" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#667A8E">POSISI ${originalRank}</text>
    <text x="446" y="676" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#667A8E">BATAS ${score(originalStats.cutoff.total)} | SELISIH ${signedScore(originalPosition.score_gap_to_shortlist_cutoff)}</text>
    <g font-family="${FONT_FAMILY}" font-weight="700">${textLines(originalFormationLines, 108, 724, 21, 27)}</g>
    <g font-family="${FONT_FAMILY}">${textLines(originalInstitutionLines, 108, 779, 17, 22)}</g>

    <rect x="84" y="820" width="876" height="340" rx="12" fill="#EEF6FC" stroke="#B9D7F2"/>
    <text x="108" y="858" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="#0D6CBD">TARGET PILIHAN / FORMASI UMUM</text>
    <rect x="108" y="878" width="350" height="54" rx="9" fill="${targetStyle.fill}"/>
    <text x="283" y="914" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="22" font-weight="800" fill="${targetStyle.color}">${escapeXml(target.verdict.label.toUpperCase())}</text>
    <text x="486" y="899" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#0D6CBD">KUOTA ${target.quota} | KAPASITAS SKB ${target.shortlist_capacity}</text>
    <text x="486" y="925" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#0D6CBD">PENDIDIKAN COCOK / TERVERIFIKASI</text>
    <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(targetFormationLines, 108, 970, 21, 27)}</g>
    <g font-family="${FONT_FAMILY}">${textLines(targetInstitutionLines, 108, 1042, 17, 22)}</g>
    <g font-family="${FONT_FAMILY}">
      ${targetMetric("POSISI SIMULASI", targetRank, 108)}
      ${targetMetric("BATAS SKB", score(target.cutoff.total), 322)}
      ${targetMetric("SELISIH", signedScore(target.score_gap_to_shortlist_cutoff), 536)}
      ${targetMetric("RASIO / KURSI", target.competition_ratio === null ? "-" : `${target.competition_ratio}x`, 750)}
    </g>

    <rect x="84" y="1182" width="876" height="104" rx="10" fill="#F2F7FB" stroke="#D6E4EF"/>
    <text x="108" y="1215" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#0D6CBD">KESIMPULAN TARGET</text>
    <g font-family="${FONT_FAMILY}">${textLines(recommendationLines, 108, 1245, 16, 21)}</g>

    <rect x="0" y="1318" width="1080" height="32" fill="#082D52"/>
    <text x="54" y="1340" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">Simulasi data resmi ${snapshot.dataset_year}; bukan prediksi atau jaminan kelulusan.</text>
    <text x="1026" y="1340" text-anchor="end" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">${escapeXml(generated)}</text>
  </svg>`;
}

function renderTopRecommendationsCardSvgLegacy(snapshot: RationalizationSnapshot): string {
  const recommendations = snapshot.target_recommendations ?? [];
  const participant = snapshot.participant;
  const original = snapshot.formation;
  const originalPosition = snapshot.historical_position;
  const originalStats = snapshot.historical_stats;
  const summary = snapshot.recommendation_summary;
  const nameLines = wrap(participant.name, 40, 2);
  const originalRank = originalPosition.overall_rank
    ? `${originalPosition.overall_rank}/${originalStats.attended}`
    : "-";
  const generated = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(snapshot.generated_at));

  const scoreTile = (label: string, value: string, x: number, highlight = false) => `
    <rect x="${x}" y="422" width="204" height="98" rx="10" fill="${highlight ? "#E7F2FC" : "#F3F6F9"}" stroke="${highlight ? "#B9D7F2" : "#DCE5ED"}"/>
    <text x="${x + 18}" y="454" font-size="16" font-weight="700" fill="#667A8E">${label}</text>
    <text x="${x + 18}" y="498" font-size="37" font-weight="800" fill="${highlight ? "#0D6CBD" : "#102A43"}">${value}</text>`;

  const recommendationRow = (item: (typeof recommendations)[number], index: number) => {
    const y = 728 + index * 162;
    const style = targetVerdictStyle(item.verdict.code);
    const positionLines = wrap(item.position, 55, 2);
    const relation = item.is_preferred
      ? "TARGET PILIHAN"
      : item.is_mode_fallback
        ? "LINTAS JABATAN"
        : item.position_relation === "same_position"
          ? "JABATAN SAMA"
          : "JABATAN SEJENIS";
    const rank = item.simulated_rank ? `${item.simulated_rank}/${item.attended}` : "-";
    const confidence = item.confidence?.label ?? "Data terbatas";

    return `
      <rect x="84" y="${y}" width="876" height="146" rx="11" fill="#F8FAFC" stroke="#D7E3EC"/>
      <circle cx="116" cy="${y + 30}" r="18" fill="#0D6CBD"/>
      <text x="116" y="${y + 37}" text-anchor="middle" font-size="19" font-weight="800" fill="#FFFFFF">${index + 1}</text>
      <rect x="146" y="${y + 12}" width="210" height="34" rx="7" fill="${style.fill}"/>
      <text x="251" y="${y + 35}" text-anchor="middle" font-size="15" font-weight="800" fill="${style.color}">${escapeXml(item.verdict.label.toUpperCase())}</text>
      <text x="374" y="${y + 35}" font-size="13" font-weight="700" fill="#718397">${relation} | ${escapeXml(confidence.toUpperCase())}</text>
      <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(positionLines, 146, y + 72, 18, 22)}</g>
      <text x="146" y="${y + 126}" font-size="15" fill="#667A8E">${escapeXml(clip(item.institution, 68))}</text>
      <text x="710" y="${y + 64}" font-size="15" font-weight="700" fill="#667A8E">POSISI</text>
      <text x="936" y="${y + 64}" text-anchor="end" font-size="22" font-weight="800" fill="#102A43">${rank}</text>
      <text x="710" y="${y + 92}" font-size="15" font-weight="700" fill="#667A8E">BATAS / SELISIH</text>
      <text x="936" y="${y + 92}" text-anchor="end" font-size="19" font-weight="800" fill="#102A43">${score(item.cutoff.total)} / ${signedScore(item.score_gap_to_shortlist_cutoff)}</text>
      <text x="710" y="${y + 120}" font-size="15" font-weight="700" fill="#667A8E">KUOTA / RASIO</text>
      <text x="936" y="${y + 120}" text-anchor="end" font-size="18" font-weight="800" fill="#102A43">${item.quota} / ${item.competition_ratio === null ? "-" : `${item.competition_ratio}x`}</text>`;
  };

  const modeLabel = summary?.mode_label ?? "Rekomendasi otomatis";
  const coverage = summary?.scope_note ?? "Cakupan mengikuti formasi terverifikasi dalam database.";

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="1080" height="1350" fill="#F4F7FA"/>
    <rect width="1080" height="218" fill="#082D52"/>
    <rect x="64" y="50" width="8" height="116" fill="#38A3E3"/>
    <text x="94" y="78" font-family="${FONT_FAMILY}" font-size="24" font-weight="700" fill="#8ECBF0">CPNSGURU.ID / DATA SKD</text>
    <text x="94" y="128" font-family="${FONT_FAMILY}" font-size="42" font-weight="800" fill="#FFFFFF">3 TARGET RASIONAL</text>
    <text x="94" y="174" font-family="${FONT_FAMILY}" font-size="27" font-weight="700" fill="#D8E8F4">${escapeXml(modeLabel.toUpperCase())}</text>
    <rect x="850" y="54" width="166" height="46" rx="8" fill="#FFFFFF" fill-opacity="0.12"/>
    <text x="933" y="85" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="21" font-weight="700" fill="#FFFFFF">DATA ${snapshot.dataset_year}</text>

    <rect x="48" y="250" width="984" height="1052" rx="18" fill="#FFFFFF" stroke="#D9E3EC"/>
    <text x="84" y="300" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="#718397">PESERTA</text>
    <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(nameLines, 84, 340, 31, 37)}</g>
    <text x="84" y="400" font-family="${FONT_FAMILY}" font-size="16" fill="#667A8E">Pendidikan ${escapeXml(clip(participant.education, 45))} | No. ${escapeXml(maskNoPeserta(participant.participant_number))}</text>

    <g font-family="${FONT_FAMILY}">
      ${scoreTile("TWK", score(participant.twk), 84)}
      ${scoreTile("TIU", score(participant.tiu), 308)}
      ${scoreTile("TKP", score(participant.tkp), 532)}
      ${scoreTile("TOTAL", score(participant.total), 756, true)}
    </g>

    <rect x="84" y="544" width="876" height="108" rx="11" fill="#F2F7FB" stroke="#D6E4EF"/>
    <text x="108" y="578" font-family="${FONT_FAMILY}" font-size="15" font-weight="700" fill="#718397">POSISI HISTORIS FORMASI ASAL</text>
    <text x="108" y="615" font-family="${FONT_FAMILY}" font-size="20" font-weight="800" fill="#17324D">${escapeXml(clip(original.position, 54))}</text>
    <text x="108" y="640" font-family="${FONT_FAMILY}" font-size="15" fill="#667A8E">${escapeXml(clip(original.institution, 58))}</text>
    <text x="936" y="594" text-anchor="end" font-family="${FONT_FAMILY}" font-size="18" font-weight="800" fill="#0D6CBD">POSISI ${originalRank}</text>
    <text x="936" y="625" text-anchor="end" font-family="${FONT_FAMILY}" font-size="16" font-weight="700" fill="#667A8E">BATAS ${score(originalStats.cutoff.total)} | SELISIH ${signedScore(originalPosition.score_gap_to_shortlist_cutoff)}</text>

    <text x="84" y="700" font-family="${FONT_FAMILY}" font-size="17" font-weight="800" fill="#0D6CBD">REKOMENDASI FORMASI UMUM / PENDIDIKAN COCOK</text>
    <g font-family="${FONT_FAMILY}">
      ${recommendations.slice(0, 3).map(recommendationRow).join("")}
    </g>

    <rect x="84" y="1222" width="876" height="64" rx="9" fill="#EEF6FC" stroke="#B9D7F2"/>
    <text x="108" y="1248" font-family="${FONT_FAMILY}" font-size="14" font-weight="700" fill="#0D6CBD">CAKUPAN DATA</text>
    <text x="108" y="1272" font-family="${FONT_FAMILY}" font-size="14" fill="#395A73">${escapeXml(clip(coverage, 105))}</text>

    <rect x="0" y="1318" width="1080" height="32" fill="#082D52"/>
    <text x="54" y="1340" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">Simulasi historis; periksa kembali syarat resmi dan bukan jaminan kelulusan.</text>
    <text x="1026" y="1340" text-anchor="end" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">${escapeXml(generated)}</text>
  </svg>`;
}

function renderTopRecommendationsCardSvg(
  snapshot: RationalizationSnapshot,
  resultToken?: string | null,
): string {
  const recommendations = snapshot.target_recommendations ?? [];
  const participant = snapshot.participant;
  const original = snapshot.formation;
  const originalPosition = snapshot.historical_position;
  const originalStats = snapshot.historical_stats;
  const summary = snapshot.recommendation_summary;
  const originalRank = originalPosition.overall_rank ? String(originalPosition.overall_rank) : "-";
  const percentile =
    originalPosition.top_percent === null
      ? "-"
      : `${Math.max(0, Math.round(100 - originalPosition.top_percent))}%`;
  const originalPositionLines = wrap(original.position, 37, 2);
  const originalInstitutionLines = wrap(original.institution, 42, 2);
  const generated = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(snapshot.generated_at));

  const recommendationColumn = (item: (typeof recommendations)[number], index: number) => {
    const x = 54 + index * 324;
    const style = targetVerdictStyle(item.verdict.code);
    const institutionLines = wrap(item.institution, 25, 2);
    const positionLines = wrap(item.position, 31, 2);
    const location = clip(item.location || "Lokasi tidak dirinci", 30);
    const rank = item.simulated_rank ? String(item.simulated_rank) : "-";
    const pool = item.eligible_pool ?? item.passing_grade ?? item.attended;

    return `
      <g transform="translate(${x} 0)">
        <circle cx="24" cy="682" r="20" fill="${index === 2 ? "#F04418" : "#159455"}"/>
        <text x="24" y="690" text-anchor="middle" font-size="21" font-weight="800" fill="#FFFFFF">${index + 1}</text>
        <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(institutionLines, 58, 676, 18, 22)}</g>
        <text x="58" y="727" font-size="14" fill="#516581">${escapeXml(location)}</text>
        <rect x="58" y="744" width="174" height="34" rx="7" fill="${style.fill}"/>
        <text x="145" y="767" text-anchor="middle" font-size="13" font-weight="800" fill="${style.color}">${escapeXml(item.verdict.label.toUpperCase())}</text>
        <g font-family="${FONT_FAMILY}" font-weight="700">${textLines(positionLines, 58, 801, 13, 17)}</g>

        <rect x="0" y="840" width="96" height="76" rx="7" fill="#F7F9FC" stroke="#E2E8F0"/>
        <text x="48" y="866" text-anchor="middle" font-size="13" fill="#61708A">Posisiku</text>
        <text x="48" y="894" text-anchor="middle" font-size="25" font-weight="800" fill="#071B36">${rank}</text>
        <text x="48" y="910" text-anchor="middle" font-size="11" fill="#61708A">dari ${pool}</text>
        <rect x="102" y="840" width="96" height="76" rx="7" fill="#F7F9FC" stroke="#E2E8F0"/>
        <text x="150" y="866" text-anchor="middle" font-size="13" fill="#61708A">Kuota</text>
        <text x="150" y="899" text-anchor="middle" font-size="25" font-weight="800" fill="#071B36">${item.quota}</text>
        <rect x="204" y="840" width="96" height="76" rx="7" fill="#F7F9FC" stroke="#E2E8F0"/>
        <text x="252" y="866" text-anchor="middle" font-size="13" fill="#61708A">Peserta</text>
        <text x="252" y="899" text-anchor="middle" font-size="25" font-weight="800" fill="#071B36">${item.attended}</text>

        <line x1="0" y1="934" x2="300" y2="934" stroke="#E2E8F0"/>
        <text x="45" y="960" text-anchor="middle" font-size="13" fill="#61708A">Min</text>
        <text x="45" y="988" text-anchor="middle" font-size="22" font-weight="800" fill="#071B36">${score(item.minimum_total)}</text>
        <text x="150" y="960" text-anchor="middle" font-size="13" fill="#61708A">Median</text>
        <text x="150" y="988" text-anchor="middle" font-size="22" font-weight="800" fill="#071B36">${score(item.median_total)}</text>
        <text x="255" y="960" text-anchor="middle" font-size="13" fill="#61708A">Maks</text>
        <text x="255" y="988" text-anchor="middle" font-size="22" font-weight="800" fill="#071B36">${score(item.maximum_total)}</text>
      </g>`;
  };

  const modeLabel = summary?.mode_label ?? "Rekomendasi otomatis";
  const coverage = summary?.scope_note ?? "Cakupan mengikuti formasi terverifikasi dalam database.";
  const best = recommendations[0];
  const recommendationText = best
    ? `Nilai ${score(participant.total)} paling rasional diarahkan ke ${best.institution}. Posisi simulasi ${best.simulated_rank ?? "-"} dari ${best.eligible_pool ?? best.passing_grade ?? best.attended} peserta dengan kuota ${best.quota}. Tetap cek syarat pendidikan dan pengumuman resmi saat formasi dibuka.`
    : "Belum ada target yang cukup kuat untuk direkomendasikan dari data terverifikasi.";
  const recommendationLines = wrap(recommendationText, 61, 4);
  const coverageLines = wrap(coverage, 50, 4);
  const education = clip(participant.education, 32);
  const participantLabel = `${clip(participant.name, 28)} | ${maskNoPeserta(participant.participant_number)}`;
  const tokenLabel = clip(resultToken || "RSKD-XXXXXXXX", 18);
  const originalVerdict = verdictStyle(snapshot.verdict.code);

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#071B56"/>
        <stop offset="1" stop-color="#0872D9"/>
      </linearGradient>
      <linearGradient id="rank" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#123EA5"/>
        <stop offset="1" stop-color="#075EC4"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1350" fill="url(#frame)"/>
    <circle cx="1040" cy="-20" r="180" fill="#0C79E8" fill-opacity="0.38"/>
    <rect x="18" y="18" width="1044" height="1314" rx="20" fill="#FFFFFF"/>

    <g font-family="${FONT_FAMILY}">
      <rect x="54" y="42" width="58" height="58" rx="15" fill="#071B36"/>
      <path d="M69 87 L82 57 Q84 53 87 57 L101 87" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M87 58 L101 87" fill="none" stroke="#2F6BFF" stroke-width="7" stroke-linecap="round"/>
      <circle cx="94" cy="77" r="4" fill="#39D4D8"/>
      <text x="124" y="75" font-size="31" font-weight="800" fill="#071B36">Analisa<tspan fill="#2F6BFF">CPNS</tspan></text>
      <text x="126" y="94" font-size="10" font-weight="700" fill="#61758D">by <tspan fill="#697FE4">Mimin</tspan><tspan fill="#704F9E"> CPNS</tspan></text>
      <text x="1024" y="68" text-anchor="end" font-size="20" font-weight="800" fill="#071B56">CEK RASIONALISASI SKD</text>
      <text x="1024" y="94" text-anchor="end" font-size="15" font-weight="700" fill="#536681">#PilihFormasiDenganData</text>
      <line x1="18" y1="118" x2="1062" y2="118" stroke="#E8EDF4"/>

      <text x="62" y="169" font-size="37" font-weight="800" fill="#071B56">HASIL RASIONALISASI SKD-KU</text>
      <text x="62" y="203" font-size="17" fill="#536681">Berdasarkan data pengumuman CPNS ${snapshot.dataset_year} yang telah terindeks</text>
      <text x="1018" y="202" text-anchor="end" font-size="13" font-weight="700" fill="#718096">${escapeXml(participantLabel)}</text>

      <rect x="62" y="230" width="220" height="320" rx="14" fill="#FFFFFF" stroke="#DDE5EF" stroke-width="2"/>
      <text x="92" y="288" font-size="17" font-weight="800" fill="#071B56">NILAI SKD TOTAL</text>
      <text x="92" y="420" font-size="88" font-weight="800" fill="#1059C8">${score(participant.total)}</text>
      <path d="M112 455 Q154 433 202 446" fill="none" stroke="#FFC62C" stroke-width="8" stroke-linecap="round"/>
      <text x="92" y="502" font-size="13" font-weight="700" fill="#61708A">TWK ${score(participant.twk)}  ·  TIU ${score(participant.tiu)}  ·  TKP ${score(participant.tkp)}</text>

      <rect x="296" y="230" width="370" height="320" rx="14" fill="#FFFFFF" stroke="#DDE5EF" stroke-width="2"/>
      <circle cx="334" cy="278" r="24" fill="#EAF2FF"/>
      <rect x="324" y="270" width="20" height="15" rx="2" fill="#1763C6"/>
      <path d="M329 270 V265 H339 V270" fill="none" stroke="#1763C6" stroke-width="2"/>
      <text x="374" y="267" font-size="13" font-weight="700" fill="#61708A">JABATAN ACUAN</text>
      <g font-weight="800">${textLines(originalPositionLines, 374, 291, 17, 20)}</g>
      <line x1="322" y1="330" x2="640" y2="330" stroke="#E3E9F1"/>
      <circle cx="334" cy="371" r="24" fill="#EAF2FF"/>
      <path d="M321 368 L334 361 L347 368 L334 375 Z" fill="#1763C6"/>
      <text x="374" y="363" font-size="13" font-weight="700" fill="#61708A">PENDIDIKAN</text>
      <text x="374" y="388" font-size="17" font-weight="800" fill="#071B36">${escapeXml(education)}</text>
      <line x1="322" y1="414" x2="640" y2="414" stroke="#E3E9F1"/>
      <circle cx="334" cy="455" r="24" fill="#EAF2FF"/>
      <path d="M322 465 V450 L334 442 L346 450 V465 M327 465 V454 M334 465 V454 M341 465 V454" fill="none" stroke="#1763C6" stroke-width="3"/>
      <text x="374" y="447" font-size="13" font-weight="700" fill="#61708A">FORMASI ACUAN DARI</text>
      <g font-weight="800">${textLines(originalInstitutionLines, 374, 472, 15, 19)}</g>
      <text x="374" y="523" font-size="13" font-weight="700" fill="#1763C6">${escapeXml(modeLabel.toUpperCase())}</text>

      <rect x="682" y="230" width="336" height="320" rx="15" fill="url(#rank)"/>
      <text x="850" y="274" text-anchor="middle" font-size="16" fill="#FFFFFF">POSISI DALAM DATA TERINDEKS</text>
      <circle cx="748" cy="343" r="43" fill="#FFFFFF" fill-opacity="0.10"/>
      <path d="M727 323 H769 V337 Q769 356 748 365 Q727 356 727 337 Z M736 365 H760 M741 374 H755" fill="none" stroke="#FFD044" stroke-width="7" stroke-linecap="round"/>
      <text x="866" y="356" text-anchor="middle" font-size="60" font-weight="800" fill="#FFFFFF">${originalRank}</text>
      <text x="866" y="385" text-anchor="middle" font-size="17" fill="#FFFFFF">dari ${originalStats.attended} peserta</text>
      <line x1="710" y1="413" x2="990" y2="413" stroke="#FFFFFF" stroke-opacity="0.35"/>
      <text x="850" y="446" text-anchor="middle" font-size="15" fill="#FFFFFF">PERSENTIL</text>
      <text x="850" y="493" text-anchor="middle" font-size="45" font-weight="800" fill="#FFD044">${percentile}</text>
      <rect x="729" y="509" width="242" height="36" rx="18" fill="${originalVerdict.fill}"/>
      <text x="850" y="533" text-anchor="middle" font-size="15" font-weight="800" fill="${originalVerdict.color}">ZONA: ${escapeXml(snapshot.verdict.label.toUpperCase())}</text>

      <line x1="62" y1="594" x2="1018" y2="594" stroke="#E4EAF2"/>
      <text x="62" y="632" font-size="24" font-weight="800" fill="#071B56">3 FORMASI PALING <tspan fill="#159455">RASIONAL</tspan> UNTUK NILAI SKD-MU</text>
      <rect x="46" y="650" width="988" height="358" rx="14" fill="#FFFFFF" stroke="#DDE5EF" stroke-width="2"/>
      <line x1="370" y1="666" x2="370" y2="992" stroke="#E4EAF2"/>
      <line x1="694" y1="666" x2="694" y2="992" stroke="#E4EAF2"/>
      ${recommendations.slice(0, 3).map(recommendationColumn).join("")}

      <rect x="62" y="1030" width="956" height="174" rx="14" fill="#FFFFFF" stroke="#DDE5EF" stroke-width="2"/>
      <circle cx="112" cy="1082" r="31" fill="#1059C8"/>
      <circle cx="112" cy="1082" r="17" fill="none" stroke="#FFFFFF" stroke-width="4"/>
      <path d="M112 1082 L128 1066 M121 1066 H128 V1073" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="160" y="1068" font-size="17" font-weight="800" fill="#1059C8">REKOMENDASI</text>
      <g>${textLines(recommendationLines, 160, 1098, 14, 21)}</g>
      <line x1="650" y1="1052" x2="650" y2="1182" stroke="#CAD7E8"/>
      <text x="674" y="1068" font-size="15" font-weight="800" fill="#071B56">CAKUPAN ANALISIS</text>
      <g>${textLines(coverageLines, 674, 1098, 13, 19)}</g>
      <text x="674" y="1180" font-size="13" font-weight="700" fill="#1763C6">Data ${snapshot.dataset_year} · dibuat ${escapeXml(generated)}</text>

      <path d="M18 1228 Q18 1210 36 1210 H1044 Q1062 1210 1062 1228 V1312 Q1062 1332 1042 1332 H38 Q18 1332 18 1312 Z" fill="url(#rank)"/>
      <circle cx="70" cy="1268" r="20" fill="#FFFFFF" fill-opacity="0.16"/>
      <path d="M61 1268 L68 1275 L81 1260" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="104" y="1262" font-size="14" fill="#FFFFFF">Data berasal dari pengumuman resmi yang telah terindeks.</text>
      <text x="104" y="1287" font-size="14" fill="#FFFFFF">Bukan peringkat resmi instansi dan bukan jaminan kelulusan.</text>
      <text x="1022" y="1248" text-anchor="end" font-size="12" font-weight="700" fill="#CFE3FF">KODE HASIL KAMU</text>
      <rect x="806" y="1258" width="216" height="48" rx="10" fill="#FFFFFF" fill-opacity="0.08" stroke="#FFFFFF" stroke-opacity="0.55"/>
      <text x="914" y="1290" text-anchor="middle" font-size="19" font-weight="800" fill="#FFFFFF">${escapeXml(tokenLabel)}</text>
    </g>
  </svg>`;
}

export function renderRationalizationCardSvg(
  snapshot: RationalizationSnapshot,
  resultToken?: string | null,
): string {
  if (snapshot.target_recommendations?.length)
    return renderTopRecommendationsCardSvg(snapshot, resultToken);
  if (snapshot.target_simulation) return renderTargetComparisonCardSvg(snapshot);

  const verdict = verdictStyle(snapshot.verdict.code);
  const participant = snapshot.participant;
  const formation = snapshot.formation;
  const position = snapshot.historical_position;
  const stats = snapshot.historical_stats;
  const nameLines = wrap(participant.name, 39, 2);
  const formationLines = wrap(formation.position, 54, 2);
  const institutionLines = wrap(formation.institution, 55, 2);
  const recommendationLines = wrap(rationalizationRecommendation(snapshot.verdict.code), 76, 3);
  const rank = position.overall_rank ? `${position.overall_rank} / ${stats.attended}` : "-";
  const topPercent = position.top_percent === null ? "-" : `${position.top_percent}%`;
  const ratio = stats.competition_ratio === null ? "-" : `${stats.competition_ratio}x`;
  const generated = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(snapshot.generated_at));

  const scoreMetric = (label: string, value: string, x: number, highlight = false) => `
    <rect x="${x}" y="430" width="204" height="116" rx="10" fill="${highlight ? "#E7F2FC" : "#F3F6F9"}" stroke="${highlight ? "#B9D7F2" : "#DCE5ED"}"/>
    <text x="${x + 20}" y="466" font-size="18" font-weight="700" fill="#667A8E">${label}</text>
    <text x="${x + 20}" y="522" font-size="46" font-weight="800" fill="${highlight ? "#0D6CBD" : "#102A43"}">${value}</text>`;
  const historyMetric = (label: string, value: string, x: number) => `
    <rect x="${x}" y="720" width="204" height="112" rx="10" fill="#F3F6F9" stroke="#DCE5ED"/>
    <text x="${x + 18}" y="756" font-size="17" font-weight="700" fill="#667A8E">${label}</text>
    <text x="${x + 18}" y="806" font-size="35" font-weight="800" fill="#102A43">${value}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="1080" height="1350" fill="#F4F7FA"/>
    <rect width="1080" height="218" fill="#082D52"/>
    <rect x="64" y="50" width="8" height="116" fill="#38A3E3"/>
    <text x="94" y="78" font-family="${FONT_FAMILY}" font-size="24" font-weight="700" fill="#8ECBF0">CPNSGURU.ID / DATA SKD</text>
    <text x="94" y="128" font-family="${FONT_FAMILY}" font-size="44" font-weight="800" fill="#FFFFFF">HASIL RASIONALISASI</text>
    <text x="94" y="174" font-family="${FONT_FAMILY}" font-size="31" font-weight="700" fill="#D8E8F4">POSISI HISTORIS FORMASI</text>
    <rect x="850" y="54" width="166" height="46" rx="8" fill="#FFFFFF" fill-opacity="0.12"/>
    <text x="933" y="85" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="21" font-weight="700" fill="#FFFFFF">DATA ${snapshot.dataset_year}</text>

    <rect x="48" y="250" width="984" height="1052" rx="18" fill="#FFFFFF" stroke="#D9E3EC"/>
    <text x="84" y="304" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#718397">PESERTA</text>
    <g font-family="${FONT_FAMILY}" font-weight="800">${textLines(nameLines, 84, 348, 34, 40)}</g>
    <text x="84" y="405" font-family="${FONT_FAMILY}" font-size="18" fill="#667A8E">No. ${escapeXml(maskNoPeserta(participant.participant_number))} | Status resmi ${escapeXml(participant.official_status)}</text>

    <g font-family="${FONT_FAMILY}">
      ${scoreMetric("TWK", score(participant.twk), 84)}
      ${scoreMetric("TIU", score(participant.tiu), 308)}
      ${scoreMetric("TKP", score(participant.tkp), 532)}
      ${scoreMetric("TOTAL", score(participant.total), 756, true)}
    </g>

    <rect x="84" y="578" width="876" height="110" rx="12" fill="${verdict.fill}"/>
    <text x="112" y="616" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#667A8E">HASIL RASIONALISASI</text>
    <text x="112" y="662" font-family="${FONT_FAMILY}" font-size="34" font-weight="800" fill="${verdict.color}">${escapeXml(snapshot.verdict.label.toUpperCase())}</text>

    <g font-family="${FONT_FAMILY}">
      ${historyMetric("PERINGKAT", rank, 84)}
      ${historyMetric("TOP PESERTA", topPercent, 308)}
      ${historyMetric("SELISIH BATAS", signedScore(position.score_gap_to_shortlist_cutoff), 532)}
      ${historyMetric("RASIO / KURSI", ratio, 756)}
    </g>

    <text x="84" y="882" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#718397">ACUAN HISTORIS FORMASI</text>
    <text x="84" y="925" font-family="${FONT_FAMILY}" font-size="23" font-weight="700" fill="#17324D">Kuota ${formation.quota}  |  Peserta ${stats.participants}  |  Hadir ${stats.attended}  |  Lolos PG ${stats.passing_grade}</text>
    <text x="84" y="962" font-family="${FONT_FAMILY}" font-size="23" fill="#17324D">Batas peserta SKB: ${score(stats.cutoff.total)}  |  Median: ${score(stats.median_total)}  |  Tertinggi: ${score(stats.maximum_total)}</text>

    <line x1="84" y1="994" x2="960" y2="994" stroke="#DCE5ED"/>
    <text x="84" y="1034" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" fill="#718397">FORMASI ACUAN</text>
    <g font-family="${FONT_FAMILY}" font-weight="700">${textLines(formationLines, 84, 1071, 23, 29)}</g>
    <g font-family="${FONT_FAMILY}">${textLines(institutionLines, 84, 1134, 20, 26)}</g>

    <rect x="84" y="1182" width="876" height="92" rx="10" fill="#F2F7FB" stroke="#D6E4EF"/>
    <text x="108" y="1215" font-family="${FONT_FAMILY}" font-size="17" font-weight="700" fill="#0D6CBD">SARAN BERIKUTNYA</text>
    <g font-family="${FONT_FAMILY}">${textLines(recommendationLines, 108, 1247, 17, 22)}</g>

    <rect x="0" y="1318" width="1080" height="32" fill="#082D52"/>
    <text x="54" y="1340" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">Acuan hasil resmi ${snapshot.dataset_year}; bukan prediksi atau jaminan kelulusan.</text>
    <text x="1026" y="1340" text-anchor="end" font-family="${FONT_FAMILY}" font-size="14" fill="#D8E8F4">${escapeXml(generated)}</text>
  </svg>`;
}

export function renderRationalizationCard(
  snapshot: RationalizationSnapshot,
  fontPath: string,
  resultToken?: string | null,
): Uint8Array {
  const renderer = new Resvg(renderRationalizationCardSvg(snapshot, resultToken), {
    fitTo: { mode: "width", value: WIDTH },
    font: {
      loadSystemFonts: false,
      fontFiles: [fontPath],
      defaultFontFamily: FONT_FAMILY,
      sansSerifFamily: FONT_FAMILY,
    },
  });
  return renderer.render().asPng();
}
