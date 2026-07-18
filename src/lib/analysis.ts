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

/** Token format RSKD-XXXXX (5 karakter alfanumerik upper, tanpa 0/O/1/I). */
export function generateToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RSKD-${out}`;
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
  rencana?: string | null;
}

function analisaByZona(zona: Zona, lolos: boolean): string {
  if (!lolos) {
    return "belum memenuhi ambang batas passing grade pada salah satu subtes. Fokus perbaikan pada subtes terendah biasanya memberi peningkatan skor total paling cepat.";
  }
  switch (zona) {
    case "aman":
      return "sudah berada pada zona relatif aman. Meski begitu, tingkat persaingan dan jumlah pelamar per formasi tetap menentukan ranking akhir.";
    case "waspada":
      return "berada pada zona waspada. Peluang tetap ada, namun sangat bergantung pada tingkat kompetisi formasi yang dipilih.";
    case "rawan":
      return "berada pada zona rawan. Peluang lolos ranking cukup tipis, terutama untuk formasi populer.";
  }
}

function rekomendasi(zona: Zona, lolos: boolean, rencana?: string | null): string {
  if (!lolos) {
    return "Kami sarankan mempertimbangkan tes ulang dan menyusun rencana latihan intensif pada subtes yang paling lemah sebelum masuk pendaftaran berikutnya.";
  }
  const suffixTryout =
    rencana === "Pakai nilai lama"
      ? " Sebelum memutuskan tetap pakai nilai lama, ada baiknya mengukur kemampuan terbaru lewat tryout pemantapan."
      : "";
  switch (zona) {
    case "aman":
      return (
        "Pilih formasi secara rasional (perhatikan rasio pendaftar vs kuota) dan lakukan tryout pemantapan untuk menjaga performa." +
        suffixTryout
      );
    case "waspada":
      return "Ikuti tryout untuk mengukur potensi kenaikan 20-30 poin. Jika latihan terarah, banyak peserta bisa naik ke zona aman dalam beberapa minggu.";
    case "rawan":
      return (
        "Sebaiknya mulai persiapan ulang secara terstruktur dan latihan intensif. Tryout berkala akan membantu memetakan progres." +
        suffixTryout
      );
  }
}

export function buildAnalysisText(ctx: AnalysisContext): {
  text: string;
  zona: Zona;
  lolos: boolean;
} {
  const zona = getZona(ctx.total);
  const lolos = lolosPassingGrade(ctx);
  const statusPg = lolos ? "Lolos PG" : "Belum Lolos PG";

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
    `Zona nilai: ${zonaLabel(zona)}`,
    ``,
    `Analisa:`,
    `Nilai Kakak ${analisaByZona(zona, lolos)} Perlu diingat, CPNS tidak hanya ditentukan oleh passing grade, tetapi juga ranking, jumlah pesaing, kuota formasi, dan strategi pemilihan formasi.`,
    ``,
    `Saran cpnsguru.id:`,
    rekomendasi(zona, lolos, ctx.rencana),
    ``,
    `Mau ukur kemampuan terbaru sebelum memutuskan pakai nilai lama atau tes ulang? Kakak bisa coba Tryout Prediksi SKD cpnsguru.id.`,
  ].join("\n");

  return { text, zona, lolos };
}

export function buildWhatsAppUrl(token: string): string {
  const number = (import.meta.env.VITE_WHATSAPP_BOT_NUMBER as string | undefined) ?? "";
  const msg = `Halo cpnsguru.id, saya mau lihat hasil lengkap rasionalisasi SKD. Kode: ${token}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;
}
