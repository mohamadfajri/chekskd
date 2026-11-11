from __future__ import annotations

import argparse
from collections import Counter
import csv
from dataclasses import dataclass
from datetime import datetime
from hashlib import file_digest
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import pymupdf


ROOT = Path(__file__).resolve().parents[2]
TOOLS = Path(__file__).resolve().parent
PDF_DIRS = (ROOT / "output/pdfinstansi", ROOT / "output/PDF INSTANSI", ROOT / "FILE SKD 2024")
RECAP = "REKAPITULASI HASIL SELEKSI KOMPETENSI DASAR"
INTEGRATION = re.compile(r"HASIL INTEGRASI SKD (?:DAN|[-/])\s*SKB")
YEAR = re.compile(r"PENGADAAN (?:CASN|CPNS) (20\d{2})")
CODE = re.compile(r"\bINSTANSI\s*:\s*(\d{4})\s*-")
SCORE_TABLE = re.compile(r"\b(?:NO|NOMOR)\.? PESERTA\b.*\b(?:TAHUN SKD|TWK|TIU|TKP)\b")
PARTICIPANT_NUMBER = re.compile(r"\b24\d{15,18}\b")


@dataclass(frozen=True)
class Profile:
    code: str
    label: str
    name: str
    patterns: tuple[str, ...]


PROFILES = (
    Profile("4008", "BPK", "Badan Pemeriksa Keuangan", ("bpk.pdf", "2024-4008-*-hasil-skd.pdf")),
    Profile("3006", "Kementan", "Kementerian Pertanian", ("lampiran i hasil skd cpns kementerian pertanian*.pdf", "2024-3006-*-hasil-skd.pdf")),
    Profile("3015", "KLHK", "Kementerian Lingkungan Hidup dan Kehutanan", ("lamp 1. rekapitulasi hasil skd cpns klhk*.pdf", "2024-3015-*-hasil-skd.pdf")),
    Profile("4041", "KPU", "Setjen Komisi Pemilihan Umum", ("89_pengumuman hasil skd cpns ta 2024*.pdf", "2024-4041-*-hasil-skd.pdf")),
    Profile("3004", "Kemenkumham", "Kementerian Hukum dan Hak Asasi Manusia", ("3004_*.pdf", "2024-3004-*-hasil-skd.pdf")),
    Profile("3012", "Kemenag", "Kementerian Agama", ("lampiran hasil skd cpns 2024.pdf", "2024-3012-*-hasil-skd.pdf")),
    Profile("4024", "ATR-BPN", "Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional", ("20241119145153.pdf", "2024-4024-*-hasil-skd.pdf")),
    Profile("4062", "Bawaslu", "Badan Pengawas Pemilihan Umum", ("bawaslu.pdf", "2024-4062-*-hasil-skd.pdf")),
    Profile("4031", "BPOM", "Badan Pengawas Obat dan Makanan", ("bpom.pdf", "2024-4031-*-hasil-skd.pdf")),
    Profile("3020", "Kemenperin", "Kementerian Perindustrian", ("kemenperin.pdf", "2024-3020-*-hasil-skd.pdf")),
    Profile("3016", "KKP", "Kementerian Kelautan dan Perikanan", ("kkp 2024.pdf", "2024-3016-*-hasil-skd.pdf")),
)
CATALOG_LABELS = {
    "2050": "KemenPPPA", "3001": "Kemendagri", "3008": "ESDM",
    "3010": "Kemendikbudristek", "3014": "Kemensos", "4006": "DPR-RI",
    "4009": "Wantannas", "4020": "BKKBN", "4023": "BPKP",
    "4035": "BMKG", "4069": "Otorita-IKN", "6100": "Pemprov-Jabar",
}
CATALOG_NAMES = json.loads((TOOLS / "institusi_sscasn_2024.json").read_text(encoding="utf-8"))
BY_CODE = {
    code: Profile(code, CATALOG_LABELS.get(code, code), name, (f"2024-{code}-*-hasil-skd.pdf",))
    for code, name in CATALOG_NAMES.items()
}
BY_CODE.update({profile.code: profile for profile in PROFILES})
ANNOUNCEMENT_PAGES = {
    "4041": (9, "KOMISI PEMILIHAN UMUM"),
    "3020": (2, "KEMENTERIAN PERINDUSTRIAN"),
    "3001": (22, "KEMENTERIAN DALAM NEGERI"),
    "3008": (11, "ENERGI DAN SUMBER DAYA MINERAL"),
    "3010": (2, "KEMENTERIAN PENDIDIKAN"),
    "3014": (4, "KEMENTERIAN SOSIAL"),
    "4006": (2, "DEWAN PERWAKILAN RAKYAT"),
    "4035": (3, "BMKG"),
    "4069": (1, "OTORITA IBU KOTA NUSANTARA"),
}


@dataclass(frozen=True)
class PdfCheck:
    code: str
    pages: int
    ignored_preamble: frozenset[int]
    ignored_legend: frozenset[int] = frozenset()
    ignored_appendix: frozenset[int] = frozenset()


class HoldBatch(ValueError):
    pass


INTAKE_ERRORS = (HoldBatch, OSError, RuntimeError, subprocess.CalledProcessError)


@dataclass
class QueueItem:
    pdf: Path
    check: PdfCheck | None = None
    status: str = "MENUNGGU"
    note: str = ""
    digest: str | None = None


def inbox_pdfs(folder: Path | None = None) -> list[Path]:
    if folder is None:
        folder = next((candidate for candidate in PDF_DIRS[:2] if candidate.is_dir()), PDF_DIRS[0])
    if not folder.is_dir():
        raise HoldBatch(f"Folder PDF tidak ditemukan: {folder}")
    files = sorted(
        (file for file in folder.iterdir() if file.is_file() and file.suffix.lower() == ".pdf"),
        key=lambda file: file.name.casefold(),
    )
    if not files:
        raise HoldBatch(f"Tidak ada PDF di folder: {folder}")
    return files


def locate_pdf(profile: Profile) -> Path:
    for folder in PDF_DIRS:
        if not folder.is_dir():
            continue
        found = {
            file
            for file in folder.iterdir()
            if file.is_file() and any(file.match(pattern) for pattern in profile.patterns)
        }
        if len(found) > 1:
            raise HoldBatch(f"Ada beberapa PDF {profile.label}. Seret PDF yang tepat ke file launcher.")
        if found:
            return found.pop()
    raise HoldBatch(f"PDF {profile.label} tidak ditemukan. Seret PDF ke file launcher untuk memilihnya.")


def compact(text: str) -> str:
    return " ".join(text.upper().split())


def is_trailing_legend(text: str) -> bool:
    return (
        text.startswith("KETERANGAN:")
        and all(re.search(rf"(?<!\S)-\s*{label}\s*:", text) for label in ("P/L", "TL", "TH"))
        and not SCORE_TABLE.search(text)
        and not PARTICIPANT_NUMBER.search(text)
        and RECAP not in text
        and not CODE.search(text)
    )


def is_announcement_page(text: str) -> bool:
    has_score_columns = all(re.search(rf"\b{label}\b", text) for label in ("TWK", "TIU", "TKP"))
    return bool(text and not SCORE_TABLE.search(text) and not (has_score_columns and PARTICIPANT_NUMBER.search(text)))


def is_skb_syllabus(pages: list[str]) -> bool:
    title = "MATERI POKOK SOAL SELEKSI KOMPETENSI BIDANG"
    return (
        len(pages) >= 2
        and pages[0].startswith("MENTERI PENDAYAGUNAAN APARATUR NEGARA DAN REFORMASI BIROKRASI")
        and title in pages[0]
        and f"DAFTAR {title}" in pages[1]
        and all("NO NAMA JABATAN MATERI POKOK" in text for text in pages[1:])
        and all(
            not SCORE_TABLE.search(text) and not PARTICIPANT_NUMBER.search(text)
            and not INTEGRATION.search(text) and RECAP not in text
            and "NILAI SELEKSI KOMPETENSI DASAR" not in text
            for text in pages
        )
    )


def find_skb_appendix(document: pymupdf.Document, code: str, recap_index: int) -> frozenset[int]:
    # Only the reviewed Kemendagri layout has this trailing ministry letter and syllabus.
    start = len(document) - 104
    if code != "3001" or start <= recap_index:
        return frozenset()
    first = compact(document[start].get_text(sort=True))
    if not first.startswith("MENTERI PENDAYAGUNAAN APARATUR NEGARA"):
        return frozenset()
    pages = [first, *(compact(document[index].get_text(sort=True)) for index in range(start + 1, len(document)))]
    return frozenset(range(start + 1, len(document) + 1)) if is_skb_syllabus(pages) else frozenset()


def inspect_pdf(pdf: Path, expected_code: str | None = None) -> PdfCheck:
    if pdf.suffix.lower() != ".pdf" or not pdf.is_file():
        raise HoldBatch("Pilih file PDF yang ada.")
    with pymupdf.open(pdf) as document:
        if document.needs_pass:
            raise HoldBatch("PDF terkunci; gunakan salinan resmi yang bisa dibaca.")
        preamble = []
        for index in range(min(len(document), 40)):
            page = document[index]
            header = compact(page.get_text(sort=True, clip=pymupdf.Rect(0, 0, page.rect.width, min(235, page.rect.height))))
            if INTEGRATION.search(header):
                raise HoldBatch("Dokumen hasil integrasi SKD-SKB, bukan Hasil SKD murni.")
            if RECAP not in header:
                preamble.append(compact(page.get_text(sort=True)))
                continue
            years = set(YEAR.findall(header))
            if years != {"2024"}:
                raise HoldBatch(f"Rekap bukan CPNS 2024 (tahun: {', '.join(sorted(years)) or 'tidak terbaca'}).")
            match = CODE.search(header)
            if not match:
                raise HoldBatch("Kode instansi tidak terbaca di rekap PDF.")
            code = match[1]
            if code not in BY_CODE:
                raise HoldBatch(f"Kode instansi {code} tidak ditemukan di katalog SSCASN 2024.")
            if expected_code and code != expected_code:
                raise HoldBatch(f"Kode instansi pada PDF {code}, bukan {expected_code}.")
            announcement_pages, institution = ANNOUNCEMENT_PAGES.get(code, (0, ""))
            allowed = (
                frozenset(range(1, index + 1))
                if index > 0 and index == announcement_pages
                and institution in preamble[0]
                and "PENGUMUMAN" in preamble[0]
                and all(is_announcement_page(text) for text in preamble)
                else frozenset()
            )
            last = len(document)
            legend = (
                frozenset({last})
                if last > index + 1 and is_trailing_legend(compact(document[-1].get_text(sort=True)))
                else frozenset()
            )
            return PdfCheck(code, last, allowed, legend, find_skb_appendix(document, code, index))
    raise HoldBatch("Tidak menemukan rekap SKD 2024 yang terbaca di 40 halaman awal. Cek jenis PDF atau kebutuhan OCR.")


def validate_report(report: dict, check: PdfCheck) -> None:
    if (
        not report["is_full_document"]
        or report["pages_read"] != check.pages
        or report["total_pages"] != check.pages
        or not report["institution_code_matches"]
        or report["observed_institution_codes"] != [check.code]
        or not report["formations_total"]
    ):
        raise HoldBatch("Dokumen tidak terbaca utuh atau identitas batch tidak cocok.")
    excluded = check.ignored_preamble | check.ignored_legend | check.ignored_appendix
    unknown = set(report["unknown_pages"]) - excluded
    if unknown or report["page_parse_errors"]:
        pages = ", ".join(map(str, sorted(unknown)[:12]))
        raise HoldBatch(
            f"Ada {len(unknown)} halaman tak dikenali{f' (hal. {pages})' if pages else ''} "
            f"dan {len(report['page_parse_errors'])} error baca. Lihat laporan parser v2."
        )
    if report["formations_needs_review"] or report["participants_needs_review"] or report["duplicate_participant_numbers"]:
        raise HoldBatch("Ada formasi, peserta, atau nomor duplikat yang harus diperiksa.")
    if report["admin_import_rows"] != report["participants_total"] + report["formations_without_participants"]:
        raise HoldBatch("Jumlah baris calon impor tidak cocok dengan laporan.")


def validate_recap_rows(path: Path, report: dict, check: PdfCheck) -> None:
    with path.open(newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))
    if len(rows) != report["formations_total"]:
        raise HoldBatch("Jumlah baris formasi berbeda dari laporan.")
    participants = 0
    for row in rows:
        count = row["jumlah_peserta"]
        quota = row["jumlah_formasi"]
        if (
            row["kode_instansi"] != check.code or row["validation_status"] != "valid"
            or not count.isdecimal() or count != row["actual_peserta"] or not quota.isdecimal()
        ):
            raise HoldBatch(f"Rekap jumlah peserta atau kuota belum terkonfirmasi di halaman {row['source_page_formasi']}.")
        participants += int(count)
    if participants != report["participants_total"]:
        raise HoldBatch("Total peserta dari rekap tidak cocok dengan laporan.")


def run_script(script: str, *args: str) -> None:
    subprocess.run([sys.executable, "-u", str(TOOLS / script), *args], cwd=ROOT, check=True)


def build_staging(v2: Path, check: PdfCheck, staging: Path) -> Path:
    report = json.loads(Path(f"{v2}-report.json").read_text(encoding="utf-8"))
    validate_report(report, check)
    validate_recap_rows(Path(f"{v2}-formations.csv"), report, check)
    v3 = v2.with_name(f"{BY_CODE[check.code].label.lower()}-2024-v3")
    run_script(
        "build_kemenhub_v3.py", "--input", f"{v2}-admin-import.csv", "--total-pages", str(check.pages),
        "--parser-family", "panselnas_skd_layout", "--output-prefix", str(v3),
    )
    built = json.loads(Path(f"{v3}-report.json").read_text(encoding="utf-8"))
    if built["rows_total"] != report["admin_import_rows"] or built["formations_represented"] != report["formations_total"]:
        raise HoldBatch("Jumlah formasi atau baris staging v3 berbeda dari hasil parser.")
    candidate = Path(f"{v3}-staging.csv")
    staging.mkdir(exist_ok=True)
    target = candidate.replace(staging / candidate.name)
    print(f"\nCSV staging: {target}\nPeserta: {built['participants_total']} | Formasi: {built['formations_represented']}")
    print(f"Issue dari builder: {built['review_rows']}. Tetap cek sampel PDF sebelum impor.")
    return target


def run_intake(pdf: Path, check: PdfCheck, batch_folder: Path | None = None) -> Path:
    profile = BY_CODE[check.code]
    label = profile.code if profile.label == profile.code else f"{profile.code}-{profile.label.lower()}"
    folder = (
        batch_folder / label if batch_folder is not None
        else ROOT / "data/staging/skd-satu-klik" / f"{label}-{datetime.now():%Y%m%d-%H%M%S-%f}"
    )
    inspection = folder / "PEMERIKSAAN"
    inspection.mkdir(parents=True)
    print(f"\n{profile.label}: {check.pages} halaman. PDF asli tidak diubah.\nFolder hasil: {folder}", flush=True)
    if check.ignored_preamble:
        print(f"Halaman 1-{max(check.ignored_preamble)} adalah pengantar, bukan tabel nilai.", flush=True)
    if check.ignored_appendix:
        print(f"Halaman {min(check.ignored_appendix)}-{max(check.ignored_appendix)} adalah materi SKB, bukan tabel nilai.", flush=True)
    v2 = inspection / f"{profile.label.lower()}-2024-v2"
    run_script(
        "parse_skd_panselnas.py", "--pdf", str(pdf), "--institution-code", profile.code,
        "--institution-name", profile.name, "--year", "2024", "--output-prefix", str(v2),
        "--progress-every", "100",
    )
    return build_staging(v2, check, folder if batch_folder is None else batch_folder / "CSV STAGING")


def queue_summary(items: list[QueueItem]) -> str:
    counts = Counter(item.status for item in items)
    lines = [
        "HASIL PEMROSESAN PDF SKD 2024",
        f"Total: {len(items)} | CSV siap dicek: {counts['SIAP']} | Ditahan: {counts['DITAHAN']} | "
        f"Sudah ada CSV: {counts['SUDAH ADA']} | Menunggu: {counts['MENUNGGU']} | "
        f"Lolos cek header saja: {counts['LOLOS HEADER']}",
        "Tidak ada data diimpor. Jangan unggah isi folder PEMERIKSAAN.",
        "",
    ]
    for item in items:
        lines.append(f"[{item.status}] {item.pdf.name}")
        if item.note:
            lines.append(f"  {item.note}")
    return "\n".join(lines) + "\n"


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def find_existing_csv(root: Path, digest: str) -> Path | None:
    try:
        receipt = json.loads((root / ".riwayat" / f"{digest}.json").read_text(encoding="utf-8"))
        csv_path = (root / receipt["csv"]).resolve()
        if (
            csv_path.is_relative_to(root.resolve())
            and csv_path.name.endswith("-v3-staging.csv")
            and sha256(csv_path) == receipt["sha256"]
        ):
            return csv_path
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return None


def record_success(root: Path, digest: str, csv_path: Path) -> None:
    history = root / ".riwayat"
    history.mkdir(exist_ok=True)
    path = history / f"{digest}.json"
    temporary = history / f".{digest}.{os.getpid()}.tmp"
    temporary.write_text(
        json.dumps({"csv": str(csv_path.relative_to(root)), "sha256": sha256(csv_path)}),
        encoding="utf-8",
    )
    temporary.replace(path)


def run_queue(pdfs: list[Path], *, check_only: bool, open_after: bool) -> int:
    items = [QueueItem(pdf) for pdf in dict.fromkeys(path.resolve() for path in pdfs)]
    if not items:
        raise HoldBatch("Tidak ada PDF untuk diproses.")
    root = ROOT / "data/staging/skd-satu-klik"
    print(f"Memeriksa {len(items)} PDF sebelum memulai. File asli tidak diubah.", flush=True)
    for item in items:
        try:
            item.check = inspect_pdf(item.pdf)
            if not check_only:
                item.digest = sha256(item.pdf)
                existing = find_existing_csv(root, item.digest)
                if existing:
                    item.status, item.note = "SUDAH ADA", str(existing)
        except INTAKE_ERRORS as error:
            item.status, item.note = "DITAHAN", str(error)
    counts = Counter(item.check.code for item in items if item.check and item.status == "MENUNGGU")
    for item in items:
        if item.check and item.status == "MENUNGGU" and counts[item.check.code] > 1:
            item.status, item.note = (
                "DITAHAN", f"Lebih dari satu PDF untuk instansi {item.check.code}; pilih satu secara manual."
            )
    if check_only:
        for item in items:
            if item.status == "MENUNGGU" and item.check:
                item.status, item.note = "LOLOS HEADER", f"{BY_CODE[item.check.code].name}, {item.check.pages} halaman."
        print(queue_summary(items))
        return int(any(item.status == "DITAHAN" for item in items))

    folder = root / f"batch-{datetime.now():%Y%m%d-%H%M%S-%f}"
    folder.mkdir(parents=True)
    summary = folder / "RINGKASAN HASIL.txt"
    summary.write_text(queue_summary(items), encoding="utf-8")
    for index, item in enumerate(items, 1):
        print(f"\n[{index}/{len(items)}] {item.pdf.name}", flush=True)
        if item.status == "MENUNGGU" and item.check:
            try:
                csv_path = run_intake(item.pdf, item.check, folder)
                item.status, item.note = "SIAP", str(csv_path.relative_to(folder))
                if item.digest:
                    try:
                        record_success(root, item.digest, csv_path)
                    except OSError:
                        item.note += " (riwayat tidak bisa disimpan; proses berikutnya bisa membaca ulang PDF ini)"
            except INTAKE_ERRORS as error:
                item.status, item.note = "DITAHAN", str(error)
        print(f"{item.status}: {item.note}", flush=True)
        summary.write_text(queue_summary(items), encoding="utf-8")
    print(f"\n{queue_summary(items)}\nRingkasan: {summary}", flush=True)
    if open_after:
        open_folder(folder)
    return int(any(item.status == "DITAHAN" for item in items))


def open_folder(folder: Path) -> None:
    if sys.platform == "win32":
        try:
            os.startfile(folder)
        except OSError:
            print("Folder tidak bisa dibuka otomatis. Gunakan path yang ditampilkan di atas.")


def choose_profile() -> Profile | None:
    print("PARSER HASIL SKD 2024\n")
    for index, profile in enumerate(PROFILES, 1):
        print(f"  {index}. {profile.label} ({profile.code})")
    all_option = str(len(PROFILES) + 1)
    print(f"  {all_option}. Proses semua PDF di folder masuk")
    print("  0. Keluar")
    while True:
        choice = input("\nPilih nomor instansi: ").strip()
        if choice == "0":
            raise SystemExit(0)
        if choice == all_option:
            return None
        if choice in {str(index) for index in range(1, len(PROFILES) + 1)}:
            return PROFILES[int(choice) - 1]
        print("Nomor pilihan tidak tersedia.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Buat CSV staging SKD 2024 tanpa impor database.")
    parser.add_argument("pdfs", nargs="*", type=Path, help="PDF atau satu folder pilihan.")
    parser.add_argument("--kode", metavar="KODE", help="Pilih kode instansi SSCASN 2024 tanpa menu.")
    parser.add_argument("--semua", action="store_true", help="Proses semua PDF di folder masuk.")
    parser.add_argument("--folder", type=Path, help="Proses semua PDF dalam folder pilihan.")
    parser.add_argument("--cek", action="store_true", help="Cek header PDF saja, tanpa membuat CSV.")
    parser.add_argument("--tanpa-buka", action="store_true", help="Jangan buka folder setelah selesai.")
    args = parser.parse_args()
    if args.kode and args.kode not in BY_CODE:
        parser.error(f"Kode {args.kode} tidak ditemukan di katalog SSCASN 2024.")
    if ((args.semua or args.folder) and (args.kode or args.pdfs)) or (args.kode and len(args.pdfs) > 1):
        parser.error("Pilih folder/semua, instansi, atau beberapa file; jangan gabungkan pilihan.")
    try:
        folder = args.folder
        if not args.kode and len(args.pdfs) == 1 and args.pdfs[0].is_dir():
            folder = args.pdfs[0]
        if args.semua or folder:
            return run_queue(inbox_pdfs(folder), check_only=args.cek, open_after=not args.tanpa_buka)
        if len(args.pdfs) > 1:
            return run_queue(args.pdfs, check_only=args.cek, open_after=not args.tanpa_buka)
        profile = BY_CODE[args.kode] if args.kode else (None if args.pdfs else choose_profile())
        if not args.pdfs and profile is None:
            return run_queue(inbox_pdfs(), check_only=args.cek, open_after=not args.tanpa_buka)
        pdf = (args.pdfs[0] if args.pdfs else locate_pdf(profile)).resolve()
        check = inspect_pdf(pdf, profile.code if profile else None)
        if args.cek:
            print(f"Lolos cek header: {BY_CODE[check.code].label}, tahun 2024, {check.pages} halaman.")
            return 0
        csv_path = run_intake(pdf, check)
        if not args.tanpa_buka:
            open_folder(csv_path.parent)
        return 0
    except INTAKE_ERRORS as error:
        print(f"\nDITAHAN: {error}\nJangan unggah file dari folder PEMERIKSAAN. Tidak ada data diimpor.", file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print("\nDibatalkan. Tidak ada data diimpor.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
