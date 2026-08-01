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

EDUCATION_PREFIXES = [
    "S-1 HUKUM TATANEGARA (SIYASAH SYAR’",
    "S-1 HUKUM EKONOMI SYARIAH",
    "S-1 HUKUM KELUARGA ISLAM",
    "S-1 HUKUM PIDANA ISLAM",
    "S-1 ILMU HUKUM",
    "S-1 HUKUM",
]


def normalize_name(value: str) -> str:
    value = value.lower()
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def sql_string(value: Any) -> str:
    if value is None or value == "":
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def sql_int(value: Any) -> str:
    if value is None or value == "":
        return "null"
    digits = re.sub(r"[^0-9-]", "", str(value))
    return digits if digits else "null"


def split_identity(raw_identity: str) -> tuple[str, str]:
    base = BIRTH_DATE_RE.split(raw_identity, maxsplit=1)[0].strip()
    base = re.sub(r"\s+", " ", base)

    # Some PDFs join the last education word and the participant name.
    for suffix in ("HUKUM", "ISLAM"):
        base = re.sub(rf"({suffix})([A-Z][A-Z'.-]+)", rf"\1 \2", base)

    for education in EDUCATION_PREFIXES:
        if base.startswith(education):
            name = base[len(education) :].strip(" -")
            return education, name

    return "", base


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as file:
        return list(csv.DictReader(file))


def formation_key(row: dict[str, str]) -> tuple[str, str, str, str, str]:
    return (
        row["tahun"],
        row["kode_instansi"],
        row["kode_jabatan"],
        row["kode_lokasi"],
        row["jenis_formasi"],
    )


def build_rows(
    formations_path: Path,
    scores_path: Path,
    output_csv: Path,
    output_sql: Path,
    source_url: str,
    source_file_name: str,
) -> tuple[int, int]:
    formation_pages = read_csv(formations_path)
    score_rows = read_csv(scores_path)

    formation_by_page = {row["source_page"]: row for row in formation_pages if row.get("kode_jabatan")}
    imported_rows: list[dict[str, str]] = []

    for score in score_rows:
        formation = formation_by_page.get(score["source_page"])
        if not formation:
            continue

        pendidikan, nama = split_identity(score["raw_identity"])
        if not nama:
            continue

        imported_rows.append(
            {
                "tahun": "2024",
                "kode_instansi": formation["kode_instansi"],
                "nama_instansi": formation["nama_instansi"],
                "kode_jabatan": formation["kode_jabatan"],
                "jabatan": formation["jabatan"],
                "kode_lokasi": formation["kode_lokasi"],
                "lokasi_formasi": formation["lokasi_formasi"],
                "jenis_formasi": formation["jenis_formasi"],
                "pendidikan": pendidikan or formation["pendidikan"],
                "jumlah_formasi": formation["jumlah_formasi"],
                "no_peserta": score["no_peserta"],
                "nama": nama,
                "nama_normalized": normalize_name(nama),
                "tahun_skd": "2024",
                "twk": score["twk"],
                "tiu": score["tiu"],
                "tkp": score["tkp"],
                "total": score["total"],
                "keterangan": score["keterangan"],
                "source_page": score["source_page"],
            }
        )

    output_csv.parent.mkdir(parents=True, exist_ok=True)
    output_sql.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = list(imported_rows[0].keys()) if imported_rows else []
    with output_csv.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(imported_rows)

    formations: dict[tuple[str, str, str, str, str], dict[str, str]] = {}
    for row in imported_rows:
        formations.setdefault(formation_key(row), row)

    formation_values = []
    for row in formations.values():
        formation_values.append(
            "("
            + ",".join(
                [
                    sql_int(row["tahun"]),
                    sql_string(row["kode_instansi"]),
                    sql_string(row["nama_instansi"]),
                    sql_string(row["kode_jabatan"]),
                    sql_string(row["jabatan"]),
                    sql_string(row["kode_lokasi"]),
                    sql_string(row["lokasi_formasi"]),
                    sql_string(row["jenis_formasi"]),
                    sql_string(row["pendidikan"]),
                    sql_int(row["jumlah_formasi"]),
                    sql_int(row["source_page"]),
                ]
            )
            + ")"
        )

    score_values = []
    for row in imported_rows:
        score_values.append(
            "("
            + ",".join(
                [
                    sql_int(row["tahun"]),
                    sql_string(row["kode_instansi"]),
                    sql_string(row["kode_jabatan"]),
                    sql_string(row["kode_lokasi"]),
                    sql_string(row["jenis_formasi"]),
                    sql_string(row["no_peserta"]),
                    sql_string(row["nama"]),
                    sql_string(row["pendidikan"]),
                    sql_int(row["tahun_skd"]),
                    sql_int(row["twk"]),
                    sql_int(row["tiu"]),
                    sql_int(row["tkp"]),
                    sql_int(row["total"]),
                    sql_string(row["keterangan"]),
                    sql_string(row["nama_normalized"]),
                    sql_int(row["source_page"]),
                ]
            )
            + ")"
        )

    sql = f"""begin;

delete from public.skd_scores s
using public.skd_formations f, public.pdf_sources p
where s.formation_id = f.id
  and f.source_id = p.id
  and p.source_url = {sql_string(source_url)};

delete from public.skd_formations f
using public.pdf_sources p
where f.source_id = p.id
  and p.source_url = {sql_string(source_url)};

delete from public.pdf_sources
where source_url = {sql_string(source_url)};

with source_row as (
  insert into public.pdf_sources (tahun, instansi, file_name, source_url, total_pages)
  values (2024, 'Kementerian Agama', {sql_string(source_file_name)}, {sql_string(source_url)}, 9652)
  returning id
),
formation_rows (
  tahun, kode_instansi, nama_instansi, kode_jabatan, jabatan, kode_lokasi,
  lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi, page_number
) as (
  values
  {",\n  ".join(formation_values)}
),
inserted_formations as (
  insert into public.skd_formations (
    source_id, tahun, kode_instansi, nama_instansi, kode_jabatan, jabatan,
    kode_lokasi, lokasi_formasi, jenis_formasi, pendidikan, jumlah_formasi, page_number
  )
  select source_row.id, fr.*
  from formation_rows fr
  cross join source_row
  returning id, tahun, kode_instansi, kode_jabatan, kode_lokasi, jenis_formasi
),
score_rows (
  tahun, kode_instansi, kode_jabatan, kode_lokasi, jenis_formasi, no_peserta,
  nama, pendidikan, tahun_skd, twk, tiu, tkp, total, keterangan, nama_normalized, source_page
) as (
  values
  {",\n  ".join(score_values)}
)
insert into public.skd_scores (
  formation_id, no_peserta, nama, pendidikan, tahun_skd,
  twk, tiu, tkp, total, keterangan, nama_normalized, source_page
)
select f.id, sr.no_peserta, sr.nama, sr.pendidikan, sr.tahun_skd,
       sr.twk, sr.tiu, sr.tkp, sr.total, sr.keterangan, sr.nama_normalized, sr.source_page
from score_rows sr
join inserted_formations f
  on f.tahun = sr.tahun
 and f.kode_instansi = sr.kode_instansi
 and f.kode_jabatan = sr.kode_jabatan
 and f.kode_lokasi = sr.kode_lokasi
 and f.jenis_formasi = sr.jenis_formasi;

commit;
"""
    output_sql.write_text(sql, encoding="utf-8")
    return len(formations), len(imported_rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a small Kemenag import sample for Supabase/webapp testing.")
    parser.add_argument("--formations", default="data/staging/kemenag-2024-formation-pages.csv")
    parser.add_argument("--scores", default="data/staging/kemenag-2024-score-rows-sample.csv")
    parser.add_argument("--csv", default="data/staging/kemenag-2024-import-sample.csv")
    parser.add_argument("--sql", default="data/staging/kemenag-2024-import-sample.sql")
    parser.add_argument(
        "--source-url",
        default="https://drive.google.com/file/d/1kSs34knEFZoCVws0gfct-r1kLFOBOx6d/view?usp=drive_link",
    )
    parser.add_argument("--source-file-name", default="Rekap-Hasil-Integrasi-SKD-dan-SKB-CPNS-Kemenag-2024.pdf")
    args = parser.parse_args()

    formation_count, score_count = build_rows(
        Path(args.formations),
        Path(args.scores),
        Path(args.csv),
        Path(args.sql),
        args.source_url,
        args.source_file_name,
    )
    print(f"Built {formation_count} formations and {score_count} scores")


if __name__ == "__main__":
    main()
