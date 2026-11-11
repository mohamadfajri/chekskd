import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import Papa from "papaparse";

const website = "https://chekskd.vercel.app";
const target = path.resolve("output/SKD-2024-status-PDF-2026-11-09T08-17-30/CARI PDF INSTANSI PUSAT.html");
const names = JSON.parse(await readFile(new URL("./institusi_sscasn_2024.json", import.meta.url), "utf8"));
const requested = [
  ["Kementerian Koordinator Bidang Politik dan Keamanan", "1010"],
  ["Kementerian Koordinator Bidang Hukum, HAM, Imigrasi dan Pemasyarakatan"],
  ["Kementerian Koordinator Bidang Perekonomian", "1020"],
  ["Kementerian Koordinator Bidang Pembangunan Manusia dan Kebudayaan", "1030"],
  ["Kementerian Koordinator Bidang Pangan"],
  ["Kementerian Sekretariat Negara", "4001"],
  ["Kementerian Dalam Negeri", "3001"],
  ["Kementerian Luar Negeri", "3002"],
  ["Kementerian Pertahanan", "3003"],
  ["Kementerian Agama", "3012"],
  ["Kejaksaan", "4002"],
  ["Kementerian Hak Asasi Manusia", "3004"],
  ["Kementerian Imigrasi dan Pemasyarakatan", "3004"],
  ["Kementerian Keuangan", "3005"],
  ["Kementerian Pendidikan Dasar dan Menengah", "3010"],
  ["Kementerian Pendidikan Tinggi, Sains dan Teknologi", "3010"],
  ["Kementerian Kebudayaan", "3010"],
  ["Kementerian Kesehatan", "3011"],
  ["Kementerian Sosial", "3014"],
  ["Kementerian Ketenagakerjaan", "3013"],
  ["Kementerian Pelindungan Pekerja Migran Indonesia / Kepala BP2MI", "4051"],
  ["Kementerian Perindustrian", "3020"],
  ["Kementerian Perdagangan", "3019"],
  ["Kementerian Energi dan Sumber Daya Mineral", "3008"],
  ["Kementerian Pekerjaan Umum", "3021"],
  ["Kementerian Perumahan dan Kawasan Permukiman", "3021"],
  ["Kementerian Desa dan Pembangunan Daerah Tertinggal"],
  ["Kementerian Transmigrasi"],
  ["Kementerian Perhubungan", "3009"],
  ["Kementerian Komunikasi dan Digital", "3018"],
  ["Kementerian Pertanian", "3006"],
  ["Kementerian Kehutanan", "3015"],
  ["Kementerian Kelautan dan Perikanan", "3016"],
  ["Kementerian Agraria dan Tata Ruang / Kepala BPN", "4024"],
  ["Kementerian Perencanaan Pembangunan Nasional / Kepala Bappenas", "4017"],
  ["Kementerian Pendayagunaan Aparatur Negara dan Reformasi Birokrasi", "2060"],
  ["Kementerian Kependudukan dan Pembangunan Keluarga / Kepala BKKBN", "4020"],
  ["Kementerian Lingkungan Hidup / Kepala BPLH", "3015"],
  ["Kementerian Investasi dan Hilirisasi / Kepala BKPM", "4021"],
  ["Kementerian Koperasi", "2010"],
  ["Kementerian Usaha Mikro, Kecil dan Menengah (UMKM)", "2010"],
  ["Kementerian Pariwisata", "3022"],
  ["Kementerian Ekonomi Kreatif / Kepala Bekraf", "3022"],
  ["Kementerian Pemberdayaan Perempuan dan Perlindungan Anak", "2050"],
  ["Kementerian Pemuda dan Olahraga", "2100"],
  ["Badan Pusat Statistik (BPS)", "4016"],
  ["BNPB", "4043"],
  ["BADAN SIBER", "4010"],
  ["IKN", "4069"],
  ["KPK", "4047"],
];
const shared = new Set(["3004", "3010", "3021", "3015", "2010", "3022"]);
const need = {
  "3002": ["Kemenlu", "File lokal hanya daftar peserta lulus; bukan rekap nilai SKD."],
  "3018": ["Kominfo", "File lokal hanya hasil integrasi SKD-SKB."],
  "2060": ["KemenPANRB", "File lokal hanya hasil integrasi SKD-SKB."],
  "4021": ["Kementerian Investasi BKPM", "File lokal hanya hasil integrasi SKD-SKB."],
  "2010": ["Kemenkop UKM", "Cari satu PDF Kemenkop UKM 2024 untuk dua nama ini. File lokal hanya integrasi."],
  "2100": ["Kemenpora", "File lokal hanya hasil integrasi SKD-SKB."],
  "4047": ["Komisi Pemberantasan Korupsi", "File lokal hanya hasil integrasi SKD-SKB."],
};
const wantedCodes = new Set(requested.map(([, code]) => code).filter(Boolean));
for (const code of wantedCodes) if (!names[code]) throw new Error(`Kode tidak ada di katalog: ${code}`);

const password = process.env.ADMIN_PASSWORD?.trim();
if (!password) throw new Error("ADMIN_PASSWORD belum tersedia.");
const response = await fetch(`${website}/api/admin/skd-batches`, {
  headers: { "x-admin-password": password },
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Admin produksi tidak dapat dibaca (${response.status}).`);
const { batches } = await response.json();
const published = new Map();
const pending = new Map();
for (const batch of batches) {
  if (batch.selection_year !== 2024 || !wantedCodes.has(batch.institution_code)) continue;
  if (batch.status === "published" && batch.participant_count > 0) published.set(batch.institution_code, batch);
  else pending.set(batch.institution_code, batch);
}

const staging = new Map();
const stagingRoot = path.resolve("data/staging/skd-satu-klik");
for (const file of await readdir(stagingRoot, { recursive: true, withFileTypes: true })) {
  if (!file.isFile() || !file.name.endsWith("-v3-staging.csv") || path.basename(file.parentPath) === "PEMERIKSAAN") continue;
  const csv = path.join(file.parentPath, file.name);
  const stream = createReadStream(csv, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const sample = [];
  try {
    for await (const line of lines) {
      sample.push(line);
      if (sample.length === 2) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  const row = Papa.parse(sample.join("\n"), { header: true }).data[0];
  const code = row?.kode_instansi;
  if (row?.tahun !== "2024" || !wantedCodes.has(code) || !/^3\./.test(row.parser_version ?? "")) continue;
  staging.set(code, csv);
}

const rows = requested.map(([name, code]) => {
  const batch = published.get(code) ?? pending.get(code);
  const historical = batch?.institution_name ?? names[code];
  const kind = !code ? "none" : published.has(code) ? "published" : pending.has(code) ? "pending" : staging.has(code) ? "staging" : "missing";
  return { name, code, historical, kind, batch, csv: staging.get(code) };
});
const counts = Object.fromEntries(["published", "pending", "staging", "missing", "none"].map(
  (kind) => [kind, rows.filter((row) => row.kind === kind).length],
));
const labels = { published: "Sudah terbit", pending: "Belum terbit", staging: "CSV siap diunggah", missing: "Perlu PDF SKD", none: "Tidak ada padanan langsung" };
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const localLink = (file) => path.relative(path.dirname(target), file).split(path.sep).map(encodeURIComponent).join("/");
const number = (n) => n.toLocaleString("id-ID");
const work = counts.pending + counts.staging + counts.missing;
const date = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Makassar", dateStyle: "long", timeStyle: "short" }).format(new Date());

const tableRows = rows.map(({ name, code, historical, kind, batch, csv }) => {
  const [keyword, hint] = need[code] ?? [historical, "Belum ada CSV staging yang ditemukan."];
  const query = `"hasil SKD" "2024" ${keyword} lampiran filetype:pdf`;
  const action = kind === "missing"
    ? `<a href="https://www.google.com/search?q=${encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer">Cari PDF</a>`
    : kind === "staging" ? `<a href="${localLink(csv)}">Buka CSV</a>` : "";
  const relation = code ? `${code} · ${historical}${shared.has(code) ? " · Sumber 2024 gabungan" : ""}` : "Tidak dipadankan dengan batch lain.";
  const detail = kind === "published" ? `${number(batch.participant_count)} peserta`
    : kind === "pending" ? `Batch Admin: ${batch.status}`
      : kind === "missing" ? hint : kind === "staging" ? "Belum tercatat di Admin produksi." : "Tidak ditemukan kode batch langsung di katalog 2024.";
  return `<tr data-kind="${kind}"${kind === "published" || kind === "none" ? " hidden" : ""}>
    <td><strong>${esc(name)}</strong><small>${esc(relation)}</small></td>
    <td><span class="status ${kind}">${labels[kind]}</span><small>${esc(detail)}</small></td>
    <td>${action}${kind === "missing" ? `<label><input type="checkbox" data-code="${code}" aria-label="Tandai PDF ditemukan untuk ${esc(name)}"> Ketemu</label>` : ""}</td>
  </tr>`;
}).join("\n");

await writeFile(target, `<!doctype html>
<html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>Instansi Pusat | Cakupan SKD 2024</title>
<style>
  :root{font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:#182c28;background:#f5f7f5}
  *{box-sizing:border-box}main{max-width:1060px;margin:28px auto;padding:0 18px}
  h1{font:700 32px/1.18 Georgia,serif;margin:0 0 6px}p{margin:0 0 12px}
  a{color:#105641;text-underline-offset:3px}small,.muted{color:#475b54}
  .toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:18px 0 10px}
  input[type=search],select{min-width:0;max-width:100%;border:1px solid #a5b7ae;border-radius:4px;padding:8px 10px;font:inherit;background:white}
  input[type=search]{flex:1 1 240px}input[type=checkbox]{accent-color:#14604c}
  table{width:100%;table-layout:fixed;border-collapse:collapse;background:white}
  th,td{padding:10px;border-bottom:1px solid #dce5df;text-align:left;vertical-align:top;overflow-wrap:anywhere}
  th{background:#e7efeb;color:#28453b;font-size:13px}th:first-child{width:51%}th:last-child{width:16%}
  small,label{display:block;margin-top:3px}.status{font-weight:700}.published{color:#14604c}.missing{color:#903e20}.staging{color:#184d8e}
  @media(max-width:540px){main{padding:0 10px;margin:16px auto}h1{font-size:25px}th,td{padding:7px 5px;font-size:13px}th:last-child{width:19%}}
</style>
<main>
  <h1>Cakupan SKD 2024 Instansi Pusat</h1>
  <p class="muted">${rows.length} nama dari daftar kamu. Dicek ${esc(date)} WITA di <a href="${website}">CekSKD produksi</a>.</p>
  <p><strong>${counts.published} terbit</strong> · <strong>${work} belum tampil</strong> · ${counts.none} tanpa padanan langsung.</p>
  <p class="muted">Beberapa nama menunjuk ke sumber SKD 2024 yang sama. <a href="https://peraturan.bpk.go.id/Details/305115/perpres-no-139-tahun-2024">Penataan kementerian</a></p>
  <div class="toolbar">
    <input id="search" type="search" aria-label="Cari instansi atau kode" placeholder="Cari instansi, nama lama, atau kode">
    <select id="view" aria-label="Filter status">
      <option value="work">Belum tampil (${work})</option>
      <option value="missing">Perlu PDF (${counts.missing})</option>
      <option value="staging">CSV siap diunggah (${counts.staging})</option>
      <option value="pending">Batch belum terbit (${counts.pending})</option>
      <option value="published">Sudah terbit (${counts.published})</option>
      <option value="none">Tanpa padanan langsung (${counts.none})</option>
      <option value="all">Semua (${rows.length})</option>
    </select>
    <output id="count" aria-live="polite"></output>
  </div>
  <table><thead><tr><th>Instansi / sumber 2024</th><th>Status</th><th>Tindakan</th></tr></thead>
  <tbody>${tableRows}<tr id="empty" hidden><td colspan="3">Tidak ada instansi yang cocok.</td></tr></tbody></table>
</main>
<script>
  const rows = Array.from(document.querySelectorAll('[data-kind]'));
  const search = document.querySelector('#search');
  const view = document.querySelector('#view');
  const checks = Array.from(document.querySelectorAll('[data-code]'));
  const storageKey = 'cekskd-pdf-found-2024';
  let found = new Set();
  try { found = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch {}
  const refresh = () => {
    let count = 0;
    for (const row of rows) {
      const kind = row.dataset.kind;
      const selected = view.value === 'all' || view.value === kind ||
        (view.value === 'work' && ['missing', 'staging', 'pending'].includes(kind));
      row.hidden = !selected || !row.textContent.toLowerCase().includes(search.value.trim().toLowerCase());
      if (!row.hidden) count++;
    }
    document.querySelector('#count').value = count + ' nama';
    document.querySelector('#empty').hidden = count !== 0;
  };
  for (const check of checks) {
    check.checked = found.has(check.dataset.code);
    check.addEventListener('change', () => {
      if (check.checked) found.add(check.dataset.code);
      else found.delete(check.dataset.code);
      for (const other of checks) if (other.dataset.code === check.dataset.code) other.checked = check.checked;
      try { localStorage.setItem(storageKey, JSON.stringify([...found])); } catch {}
    });
  }
  search.addEventListener('input', refresh);
  view.addEventListener('change', refresh);
  refresh();
</script></html>
`, "utf8");

console.log(JSON.stringify({
  target, counts,
  work: rows.filter((row) => ["missing", "staging", "pending"].includes(row.kind))
    .map(({ name, code, kind, csv }) => ({ name, code, kind, csv })),
  noMatch: rows.filter((row) => row.kind === "none").map(({ name }) => name),
}));
