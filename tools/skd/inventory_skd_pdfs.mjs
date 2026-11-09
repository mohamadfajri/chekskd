import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { aesenConnection } from "../../src/server/aesenConnection.ts";

const imported = "01 - SUDAH masuk database";
const pending = "02 - BELUM masuk database";
const statuses = {
  review: "01 - Menunggu review",
  verified: "02 - Verified belum terbit",
  published: "03 - Sudah terbit",
};
const nameKey = (name) => name.trim().replace(/\s+/g, " ").toUpperCase();
const codeInFile = (name) =>
  /^2024-(\d{4})-/.exec(name)?.[1] ?? (/^KEMENHUB\.PDF$/i.test(name) ? "3009" : null);
const pureSkdName = (name) => /hasil[-_ ]+skd/i.test(name) && !/skb|integrasi|duplikat/i.test(name);
const format = (number) => Number(number).toLocaleString("id-ID");
const relativeLink = (...parts) => `./${parts.join("/").split(/[\\/]/).map(encodeURIComponent).join("/")}`;
const table = (header, rows) =>
  [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");

async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { values } = parseArgs({
    options: { archive: { type: "string" }, "pdf-root": { type: "string", default: "FILE SKD 2024" } },
  });
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!values.archive || !url || !secret || !process.env.AESEN_DATABASE_URL)
    throw new Error("Butuh --archive, koneksi Supabase server, dan AESEN_DATABASE_URL.");
  const sb = createClient(url, secret, { auth: { persistSession: false } });
  const { data: sources, error } = await sb
    .from("skd_sources")
    .select("file_name,document_type,sha256,skd_batches!inner(institution_name,status,selection_year,participant_count)")
    .eq("skd_batches.selection_year", 2024)
    .eq("document_type", "skd")
    .order("file_name");
  if (error) throw new Error(`Sumber SKD tidak terbaca: ${error.code}`);
  const aesen = new pg.Client(aesenConnection(process.env.AESEN_DATABASE_URL));
  const archive = new DatabaseSync(values.archive, { readOnly: true });
  let central;
  let codeByName;
  try {
    await aesen.connect();
    ({ rows: central } = await aesen.query(`
      select i.name, sum(f.passed_admin)::int as applicants
      from aesen.institutions i join aesen.formations f on f.institution = i.name
      where i.level = 'pusat' group by i.name order by applicants desc, i.name`));
    codeByName = new Map(archive.prepare(
      "select distinct trim(ins_nm) as name, cast(ins_kd as integer) as code from formasi",
    ).all().map(({ name, code }) => [nameKey(name), String(code)]));
  } finally {
    archive.close();
    await aesen.end();
  }
  const files = (await readdir(values["pdf-root"], { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name));
  const filesByName = new Map();
  for (const { name, parentPath } of files) {
    const key = nameKey(name);
    filesByName.set(key, [...(filesByName.get(key) ?? []), path.resolve(parentPath, name)]);
  }
  const sourceNames = new Set();
  const sourceCodes = new Set();
  const tracked = [];
  const toCopy = [];
  for (const source of sources) {
    const { file_name: name, sha256: expected, skd_batches: batch } = source;
    if (path.basename(name) !== name) throw new Error("Nama PDF sumber bukan nama file tunggal.");
    const nameId = nameKey(name);
    const code = codeInFile(name) ?? codeByName.get(nameKey(batch.institution_name));
    if (code) sourceCodes.add(code);
    sourceNames.add(nameId);
    const matches = filesByName.get(nameId) ?? [];
    const folder = path.join(imported, statuses[batch.status] ?? "04 - Status database lain");
    const isMatch = matches.length === 1 && (!expected || expected.toLowerCase() === await checksum(matches[0]));
    if (isMatch && !toCopy.some((x) => x.folder === folder && x.name === name))
      toCopy.push({ folder, name, source: matches[0] });
    tracked.push([batch.institution_name, name, batch.status, format(batch.participant_count),
      isMatch ? `[Buka PDF](${relativeLink(folder, name)})`
        : matches.length === 0 ? "Tidak ditemukan lokal" : "Nama ganda / checksum berbeda"]);
  }
  const localOnly = new Map();
  const otherDocs = new Map();
  const pendingFiles = [];
  for (const { name, parentPath } of files) {
    const code = codeInFile(name);
    if (sourceNames.has(nameKey(name))) continue;
    let label;
    if (/duplikat/i.test(name)) label = "03 - Duplikat";
    else if (code && pureSkdName(name)) {
      localOnly.set(code, name);
      label = "01 - Hasil SKD siap diproses";
    } else if (/skb|integrasi|pelaksanaan|daftar-peserta-lulus|^(?!2024)20\d{2}-/i.test(name)) {
      if (code) otherDocs.set(code, "Hanya PDF integrasi atau dokumen lain");
      label = "02 - Bukan hasil SKD 2024";
    } else {
      label = "04 - Perlu cek isi";
    }
    const folder = path.join(pending, label);
    toCopy.push({ folder, name, source: path.resolve(parentPath, name) });
    pendingFiles.push([name, label, `[Buka PDF](${relativeLink(folder, name)})`]);
  }
  const exceptions = new Map([
    ["3002", "Daftar peserta lulus, bukan rekap Hasil SKD"],
    ["3015", "Pengumuman pelaksanaan SKD, bukan hasil"],
    ["2060", "Arsip bernama Hasil SKD, tetapi isi berupa integrasi"],
  ]);
  const missing = [];
  const available = [];
  for (const { name, applicants } of central) {
    const code = codeByName.get(nameKey(name));
    if (!code) throw new Error(`Kode instansi belum dipetakan: ${name}`);
    if (sourceCodes.has(code)) continue;
    if (localOnly.has(code)) available.push([code, name, localOnly.get(code)]);
    else missing.push([code, name, format(applicants), exceptions.get(code) ?? otherDocs.get(code) ?? "Belum ditemukan"]);
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const output = path.resolve("output", `SKD-2024-status-PDF-${timestamp}`);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output);
  for (const folder of new Set([
    path.join(pending, "01 - Hasil SKD siap diproses"), ...toCopy.map((row) => row.folder),
  ])) await mkdir(path.join(output, folder), { recursive: true });
  for (const { folder, name, source } of toCopy)
    await copyFile(source, path.join(output, folder, name));
  const notes = [
    "# Inventaris PDF SKD 2024",
    `Diperiksa: ${new Date().toISOString()}. Salinan PDF; folder asli tidak diubah.`,
    `Supabase: ${tracked.length} sumber. Salinan PDF: ${toCopy.length}. Aesen: ${central.length} instansi pusat.`,
    "Status database berarti data parser tercatat, bukan jaminan PDF juga tersedia di Supabase Storage.",
    "Identitas PDF lokal dicocokkan dengan nama sumber Supabase; checksum dibandingkan bila tersedia.",
    "## Sudah Masuk Database",
    table(["Instansi", "PDF", "Status", "Peserta", "Salinan"], tracked),
    "## File Lokal Belum Masuk Database",
    table(["PDF", "Kelompok", "Salinan"], pendingFiles),
    "## PDF Lokal Belum Diimpor (Pusat)",
    available.length ? table(["Kode", "Instansi", "PDF"], available) : "Tidak ditemukan dalam folder utama.",
    "## Cari PDF Hasil SKD (Pusat)",
    `${missing.length} instansi. Urut berdasarkan jumlah pelamar lolos administrasi di katalog Aesen 2024. Cari lampiran nilai/rekap hasil SKD, bukan SKB, integrasi, jadwal, atau daftar kelulusan akhir.`,
    table(["Kode", "Instansi", "Pelamar MS (Aesen)", "Temuan lokal"], missing),
    "Cakupan: folder FILE SKD 2024, pemeriksaan sampel arsip PDF unduhan di data/raw, metadata Supabase, dan kode instansi arsip SSCASN 2024. 'Belum ditemukan' bukan berarti PDF tidak pernah diterbitkan.",
  ];
  await writeFile(path.join(output, "DAFTAR STATUS PDF.md"), notes.join("\n\n") + "\n");
  await writeFile(path.join(output, "CARI PDF INSTANSI PUSAT.html"), searchPage(missing));
  console.log(JSON.stringify({
    output, db: tracked.length, copies: toCopy.length, missing: missing.length,
    pending: pendingFiles.length, available: available.length,
    byStatus: Object.fromEntries(Object.keys(statuses).map(
      (status) => [status, tracked.filter((row) => row[2] === status).length],
    )), priorities: missing.slice(0, 8),
  }));
}

const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]);

function searchPage(rows) {
  const records = rows.map(([code, name, count, note]) => {
    const query = `"hasil SKD" "2024" "${name}" lampiran filetype:pdf`;
    const href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return `<tr data-record>
      <td><input type="checkbox" data-code="${escape(code)}" aria-label="Tandai PDF ditemukan: ${escape(name)}"></td>
      <td><strong>${escape(name)}</strong><small>${escape(code)} &middot; ${escape(note)}</small></td>
      <td class="number">${escape(count)}</td>
      <td><a href="${escape(href)}" target="_blank" rel="noopener noreferrer">Cari PDF</a></td>
    </tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cari PDF SKD 2024 | Instansi Pusat</title>
<style>
  :root{font:16px/1.5 "Segoe UI",system-ui,sans-serif;color:#192a28;background:#f4f7f5}
  *{box-sizing:border-box}
  main{max-width:1010px;margin:32px auto;padding:0 18px}
  h1{font-family:Georgia,serif;font-size:32px;line-height:1.15;margin:0 0 8px}
  p{margin:0 0 18px;color:#465a54} a{color:#125743;text-underline-offset:3px}
  .toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:20px 0 12px}
  input[type=search]{min-width:0;flex:1 1 240px;padding:9px 12px;border:1px solid #9eb2a8;border-radius:4px;font:inherit}
  input[type=checkbox]{width:17px;height:17px;accent-color:#14604c;vertical-align:middle}
  a:focus-visible,input:focus-visible{outline:2px solid #155cec;outline-offset:3px}
  table{width:100%;border-collapse:collapse;background:white}
  th,td{padding:11px 10px;border-bottom:1px solid #dce5df;text-align:left}
  th{background:#e7f0eb;color:#28453b;font-size:13px}
  td:first-child,th:first-child{text-align:center;width:56px} td:last-child{white-space:nowrap}
  td:nth-child(2){overflow-wrap:anywhere}
  .number{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  small{display:block;color:#4e625a;font-size:12px;margin-top:3px}
  #count{font-size:13px;color:#465a54}
  @media(max-width:540px){main{padding:0 10px;margin-top:20px}h1{font-size:25px}th,td{padding:8px 5px;font-size:12px}td:first-child,th:first-child{width:auto}}
</style>
<main>
  <h1>Cari PDF SKD 2024</h1>
  <p>Instansi pusat &middot; Diurutkan berdasarkan jumlah pelamar lolos administrasi.</p>
  <p>Cari lampiran <strong>Hasil SKD</strong> berisi nilai, bukan jadwal, hasil SKB, atau integrasi SKD-SKB.</p>
  <p><a href="${relativeLink(imported)}/">Sudah masuk database</a> &middot;
     <a href="${relativeLink(pending)}/">Belum masuk database</a></p>
  <div class="toolbar">
    <input type="search" id="filter" aria-label="Cari instansi atau kode" placeholder="Cari instansi atau kode">
    <label><input type="checkbox" id="only"> Belum ditandai</label>
    <span id="count" aria-live="polite"></span>
  </div>
  <table>
    <thead><tr><th>Ketemu</th><th>Instansi</th><th class="number">Pelamar</th><th>Pencarian</th></tr></thead>
    <tbody>${records}<tr id="empty" hidden><td colspan="4">Tidak ada instansi yang cocok.</td></tr></tbody>
  </table>
</main>
<script>
  const filter = document.querySelector('#filter');
  const only = document.querySelector('#only');
  const rows = Array.from(document.querySelectorAll('[data-record]'));
  const storageKey = 'cekskd-pdf-found-2024';
  let found = new Set();
  try { found = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch {}
  function refresh() {
    let visible = 0;
    rows.forEach(row => {
      const check = row.querySelector('input');
      row.hidden = !row.textContent.toLowerCase().includes(filter.value.trim().toLowerCase())
        || (only.checked && check.checked);
      if (!row.hidden) visible++;
    });
    document.querySelector('#count').textContent = visible + ' dari ' + rows.length + ' instansi';
    document.querySelector('#empty').hidden = visible !== 0;
  }
  rows.forEach(row => {
    const check = row.querySelector('input');
    check.checked = found.has(check.dataset.code);
    check.addEventListener('change', () => {
      if (check.checked) found.add(check.dataset.code);
      else found.delete(check.dataset.code);
      try { localStorage.setItem(storageKey, JSON.stringify([...found])); } catch {}
      refresh();
    });
  });
  filter.addEventListener('input', refresh);
  only.addEventListener('change', refresh);
  refresh();
</script>
</html>`;
}

main().catch((error) => {
  console.error(error.code ? `Inventaris gagal (${error.code}).` : error.message);
  process.exitCode = 1;
});
