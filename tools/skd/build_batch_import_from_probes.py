from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from pathlib import Path
from typing import Any


MONTHS = (
    "Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember"
)
BIRTH_DATE_RE = re.compile(rf"\b\d{{1,2}}\s+(?:{MONTHS})\s*\d{{4}}\b")

GENERIC_EDUCATION_PREFIXES = [
    "PROFESI DOKTER",
    "PROFESI APOTEKER",
    "S-3",
    "S-2",
    "S-1",
    "D-IV",
    "D-III",
    "D-II",
    "D-I",
    "SLTA",
    "SMA",
    "SMK",
]


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(newline="", encoding="utf-8-sig") as file:
        return [{key.strip('\ufeff"'): value for key, value in row.items()} for row in csv.DictReader(file)]


def safe_stem(path: Path) -> str:
    stem = path.stem
    return "".join(ch if ch.isalnum() or ch in "-._" else "-" for ch in stem)[:140]


def normalize_name(value: str) -> str:
    value = value.lower()
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def clean_education(value: str) -> str:
    value = re.sub(r"\s+", " ", value or "").strip()
    value = re.sub(r"\s+\d+$", "", value).strip()
    return value


def education_candidates(formation_education: str) -> list[str]:
    candidates: list[str] = []
    cleaned = clean_education(formation_education)
    if cleaned:
        for part in re.split(r"\s*(?:/|\||;|,)\s*", cleaned):
            part = clean_education(part)
            if part:
                candidates.append(part)

    candidates.extend(GENERIC_EDUCATION_PREFIXES)

    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.upper()
        if key not in seen:
            unique.append(candidate)
            seen.add(key)
    return sorted(unique, key=len, reverse=True)


def split_identity(raw_identity: str, formation_education: str) -> tuple[str, str]:
    base = BIRTH_DATE_RE.split(raw_identity, maxsplit=1)[0].strip()
    base = re.sub(r"\s+", " ", base)
    base_upper = base.upper()

    for education in education_candidates(formation_education):
        edu = education.strip()
        edu_upper = edu.upper()
        if base_upper.startswith(edu_upper):
            name = base[len(edu) :].strip(" -")
            return edu, name

    for prefix in GENERIC_EDUCATION_PREFIXES:
        pattern = rf"^({re.escape(prefix)})\s+(.+)$"
        match = re.match(pattern, base, flags=re.I)
        if match:
            return match.group(1), match.group(2).strip(" -")

    return clean_education(formation_education), base


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "tahun",
        "nama_instansi",
        "kode_instansi",
        "jabatan",
        "kode_jabatan",
        "kode_lokasi",
        "lokasi_formasi",
        "jenis_formasi",
        "pendidikan",
        "jumlah_formasi",
        "no_peserta",
        "nama",
        "nama_normalized",
        "tahun_skd",
        "twk",
        "tiu",
        "tkp",
        "total",
        "keterangan",
        "source_pdf",
        "source_page",
        "source_sheet_row",
    ]
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build one admin import CSV from parsed SKD PDF probes.")
    parser.add_argument("--summary", default="data/staging/batch_probe_full_summary.csv")
    parser.add_argument("--probe-dir", default="data/staging/batch-probes-full")
    parser.add_argument("--catalog", default="data/staging/pdf_sources_catalog.csv")
    parser.add_argument("--csv", default="data/staging/skd-import-parsed-full.csv")
    args = parser.parse_args()

    summary_rows = [row for row in read_csv(Path(args.summary)) if row.get("probe_status") == "parsed_scores"]
    catalog_by_row = {row.get("sheet_row", ""): row for row in read_csv(Path(args.catalog))}
    probe_dir = Path(args.probe_dir)
    imported_rows: list[dict[str, Any]] = []
    skipped_scores = 0

    for source in summary_rows:
        pdf_path = Path(source["output_path"])
        prefix = probe_dir / safe_stem(pdf_path)
        formation_rows = read_csv(Path(f"{prefix}-formation-pages.csv"))
        score_rows = read_csv(Path(f"{prefix}-score-rows-sample.csv"))
        formation_by_page = {
            row["source_page"]: row for row in formation_rows if row.get("source_page") and row.get("kode_jabatan")
        }
        catalog = catalog_by_row.get(source.get("sheet_row", ""), {})
        tahun = catalog.get("tahun") or "2024"

        for score in score_rows:
            formation = formation_by_page.get(score.get("source_page", ""))
            if not formation:
                skipped_scores += 1
                continue

            pendidikan, nama = split_identity(score.get("raw_identity", ""), formation.get("pendidikan", ""))
            if not nama:
                skipped_scores += 1
                continue

            imported_rows.append(
                {
                    "tahun": tahun,
                    "nama_instansi": formation.get("nama_instansi") or source.get("entity_name") or catalog.get("entity_name"),
                    "kode_instansi": formation.get("kode_instansi"),
                    "jabatan": formation.get("jabatan"),
                    "kode_jabatan": formation.get("kode_jabatan"),
                    "kode_lokasi": formation.get("kode_lokasi"),
                    "lokasi_formasi": formation.get("lokasi_formasi"),
                    "jenis_formasi": formation.get("jenis_formasi"),
                    "pendidikan": pendidikan or clean_education(formation.get("pendidikan", "")),
                    "jumlah_formasi": formation.get("jumlah_formasi"),
                    "no_peserta": score.get("no_peserta"),
                    "nama": nama,
                    "nama_normalized": normalize_name(nama),
                    "tahun_skd": tahun,
                    "twk": score.get("twk"),
                    "tiu": score.get("tiu"),
                    "tkp": score.get("tkp"),
                    "total": score.get("total"),
                    "keterangan": score.get("keterangan"),
                    "source_pdf": source.get("pdf_name"),
                    "source_page": score.get("source_page"),
                    "source_sheet_row": source.get("sheet_row"),
                }
            )

    write_csv(Path(args.csv), imported_rows)
    print(f"Built {len(imported_rows)} rows -> {args.csv}")
    print(f"Skipped scores without formation/name: {skipped_scores}")


if __name__ == "__main__":
    main()
