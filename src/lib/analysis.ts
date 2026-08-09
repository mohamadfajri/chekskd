/**
 * Pure business logic: passing grade, zona, analysis text, token, masking.
 * Kept framework-free so it's easy to port or unit-test.
 */

export const PASSING_GRADE = { twk: 65, tiu: 80, tkp: 166 } as const;

export type Zona = "aman" | "waspada" | "rawan";

export interface ScoreInput {
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
}

export function lolosPassingGrade(s: ScoreInput): boolean {
  return (
    (s.twk ?? 0) >= PASSING_GRADE.twk &&
    (s.tiu ?? 0) >= PASSING_GRADE.tiu &&
    (s.tkp ?? 0) >= PASSING_GRADE.tkp
  );
}

export function getZona(total: number | null): Zona {
  const t = total ?? 0;
  if (t >= 420) return "aman";
  if (t >= 380) return "waspada";
  return "rawan";
}

export function zonaLabel(z: Zona): string {
  switch (z) {
    case "aman":
      return "Zona Aman Relatif";
    case "waspada":
      return "Zona Waspada";
    case "rawan":
      return "Zona Rawan";
  }
}

export function zonaColor(z: Zona): string {
  switch (z) {
    case "aman":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "waspada":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "rawan":
      return "text-rose-700 bg-rose-50 border-rose-200";
  }
}

/** Mask nomor peserta: tampilkan 3 depan + 3 belakang, sisanya bintang. */
export function maskNoPeserta(no?: string | null): string {
  if (!no) return "-";
  const s = String(no);
  if (s.length <= 6) return s.slice(0, 1) + "***" + s.slice(-1);
  return s.slice(0, 3) + "****" + s.slice(-3);
}

/** Token format RSKD-XXXXXXXX (8 karakter alfanumerik upper, tanpa 0/O/1/I). */
export function generateToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = new Uint8Array(8);
  globalThis.crypto.getRandomValues(random);
  let out = "";
  for (const value of random) {
    out += alphabet[value % alphabet.length];
  }
  return `RSKD-${out}`;
}

export function extractResultToken(value: string): string | null {
  return value.toUpperCase().match(/\bRSKD-[A-HJ-NP-Z2-9]{5,8}\b/)?.[0] ?? null;
}

export interface AnalysisContext {
  nama_panggilan: string;
  nama_peserta: string;
  formasi: string;
  instansi: string;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  target_tahun?: string | null;
  target_instansi?: string | null;
  target_formasi?: string | null;
  rencana?: string | null;
}

export interface AnalysisSnapshot {
  version: 1;
  generated_at: string;
  dataset_year: 2024;
  nama_panggilan: string;
  nama_peserta: string;
  formasi: string;
  instansi: string;
  twk: number | null;
  tiu: number | null;
  tkp: number | null;
  total: number | null;
  lolos_pg: boolean;
  zona: Zona;
  zona_label: string;
  target_tahun: string | null;
  target_instansi: string | null;
  target_formasi: string | null;
  rencana: string | null;
  analysis_summary: string;
  recommendation: string;
}

function analisaByZona(zona: Zona, lolos: boolean): string {
  if (!lolos) {
    return "Nilai belum memenuhi ambang batas pada sedikitnya satu subtes. Subtes terendah menjadi prioritas latihan sebelum seleksi berikutnya.";
  }
  switch (zona) {
    case "aman":
      return "Nilai berada pada kelompok cukup kompetitif secara skor. Posisi akhirnya tetap bergantung pada kuota dan peserta di formasi yang dipilih.";
    case "waspada":
      return "Nilai berada pada zona waspada. Pemilihan formasi dan kenaikan skor akan sangat memengaruhi daya saing.";
    case "rawan":
      return "Nilai masih berada pada zona yang perlu ditingkatkan, terutama bila targetnya merupakan formasi dengan persaingan tinggi.";
  }
}

function rekomendasi(zona: Zona, lolos: boolean, rencana?: string | null): string {
  if (!lolos) {
    return "Susun latihan terarah untuk subtes terendah dan ukur ulang progres sebelum menentukan target formasi.";
  }
  const suffixTryout =
    rencana === "Pakai nilai lama"
      ? " Sebelum memutuskan tetap pakai nilai lama, ada baiknya mengukur kemampuan terbaru lewat tryout pemantapan."
      : "";
  switch (zona) {
    case "aman":
      return (
        "Bandingkan kuota, jumlah peserta, dan kecocokan pendidikan sebelum memilih formasi. Pertahankan performa dengan latihan berkala." +
        suffixTryout
      );
    case "waspada":
      return "Prioritaskan kenaikan skor dan hindari memilih target hanya dari nama instansi. Gunakan data persaingan ketika formasi resmi tersedia.";
    case "rawan":
      return (
        "Mulai persiapan ulang secara terstruktur. Tryout berkala membantu memetakan progres sebelum memilih target." +
        suffixTryout
      );
  }
}

export function buildAnalysisSnapshot(ctx: AnalysisContext): AnalysisSnapshot {
  const zona = getZona(ctx.total);
  const lolos = lolosPassingGrade(ctx);
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    dataset_year: 2024,
    nama_panggilan: ctx.nama_panggilan,
    nama_peserta: ctx.nama_peserta,
    formasi: ctx.formasi,
    instansi: ctx.instansi,
    twk: ctx.twk,
    tiu: ctx.tiu,
    tkp: ctx.tkp,
    total: ctx.total,
    lolos_pg: lolos,
    zona,
    zona_label: zonaLabel(zona),
    target_tahun: ctx.target_tahun ?? null,
    target_instansi: ctx.target_instansi ?? null,
    target_formasi: ctx.target_formasi ?? null,
    rencana: ctx.rencana ?? null,
    analysis_summary: analisaByZona(zona, lolos),
    recommendation: rekomendasi(zona, lolos, ctx.rencana),
  };
}

export function buildAnalysisText(ctx: AnalysisContext): {
  text: string;
  zona: Zona;
  lolos: boolean;
} {
  const snapshot = buildAnalysisSnapshot(ctx);
  const statusPg = snapshot.lolos_pg ? "Lolos PG" : "Belum Lolos PG";

  const text = [
    `Halo Kak ${ctx.nama_panggilan}, ini hasil analisa rasionalisasi SKD Kakak.`,
    ``,
    `Nama pada data: ${ctx.nama_peserta}`,
    `Formasi acuan: ${ctx.formasi}`,
    `Instansi: ${ctx.instansi}`,
    ``,
    `Nilai SKD:`,
    `TWK: ${ctx.twk ?? "-"}`,
    `TIU: ${ctx.tiu ?? "-"}`,
    `TKP: ${ctx.tkp ?? "-"}`,
    `Total: ${ctx.total ?? "-"}`,
    ``,
    `Status ambang batas: ${statusPg}`,
    `Zona daya saing: ${snapshot.zona_label}`,
    ``,
    `Analisa:`,
    snapshot.analysis_summary,
    ``,
    `Saran cpnsguru.id:`,
    snapshot.recommendation,
    ``,
    `Mau ukur kemampuan terbaru sebelum memutuskan pakai nilai lama atau tes ulang? Kakak bisa coba Tryout Prediksi SKD cpnsguru.id.`,
  ].join("\n");

  return { text, zona: snapshot.zona, lolos: snapshot.lolos_pg };
}

export function buildHermesCaption(snapshot: AnalysisSnapshot): string {
  return [
    `Halo Kak ${snapshot.nama_panggilan}, kartu analisis daya saing SKD sudah siap.`,
    `Total ${snapshot.total ?? "-"} | ${snapshot.lolos_pg ? "Lolos PG" : "Belum Lolos PG"} | ${snapshot.zona_label}`,
    "Hasil ini merupakan simulasi berbasis data SKD 2024, bukan jaminan kelulusan.",
  ].join("\n");
}

const DEFAULT_WHATSAPP_BOT_NUMBER = "6282265507384";

export function normalizeWhatsAppNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

export function buildWhatsAppUrl(token: string): string {
  const configuredNumber =
    (import.meta.env.VITE_WHATSAPP_BOT_NUMBER as string | undefined) ?? DEFAULT_WHATSAPP_BOT_NUMBER;
  const normalizedNumber = normalizeWhatsAppNumber(configuredNumber);
  const number =
    /^62\d{8,13}$/.test(normalizedNumber) && normalizedNumber !== "6281234567890"
      ? normalizedNumber
      : DEFAULT_WHATSAPP_BOT_NUMBER;
  const msg = `CEK ${token}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;
}
