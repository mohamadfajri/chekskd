from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import fitz
from pypdf import PdfReader


PARTICIPANT_RE = re.compile(r"(?<!\d)24\d{15,18}(?!\d)")
STATUS_RE = re.compile(r"^(?:P/L(?:-[A-Z0-9]+)?|P|TL|TH|TMS|DIS)$")
EDUCATION_NAME_PREFIX_RE = re.compile(
    r"^(?:PENDIDIKAN|PROFESI|S-[123]|D-(?:I|II|III|IV)|SMA|SMK|SLTA)\s+",
    re.I,
)
KNOWN_FIELDS = ("Instansi", "Jabatan Formasi", "Lokasi Formasi", "Jenis Formasi")
SCORE_COLUMNS = ("twk", "tiu", "tkp", "total")


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFD", value.lower())
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = re.sub(r"[^a-z0-9\s]", " ", value)
    return compact(value)


def optional_int(value: str) -> int | None:
    value = compact(value)
    if not value or value.lower() == "null":
        return None
    return int(value) if re.fullmatch(r"-?\d+", value) else None


def clean_education(value: str) -> str:
    value = re.sub(r"\(\d+\)\s*", "", value)
    value = re.sub(r"\b([DS])-+\s*(III|II|IV|I|[123])\b", r"\1-\2", value, flags=re.I)
    value = re.sub(r"\s*/\s*", " / ", value)
    return compact(value)


def read_catalog_row(path: Path, sheet_row: str) -> dict[str, str]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8-sig") as file:
        for row in csv.DictReader(file):
            if row.get("sheet_row") == sheet_row:
                return {key: value or "" for key, value in row.items()}
    return {}


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def page_kind(text: str) -> str:
    upper = text.upper()
    if "REKAPITULASI HASIL SELEKSI KOMPETENSI DASAR" in upper:
        return "rekap"
    if "NO PESERTA" in upper and "TAHUN SKD" in upper:
        return (
            "hasil"
            if "HASIL SELEKSI KOMPETENSI DASAR" in upper
            else "hasil_continuation"
        )
    if "LAPORAN DIGENERATE" in upper and len(compact(text)) < 300:
        return "blank_generated"
    return "unknown"


def find_line(lines: list[str], value: str, start: int = 0) -> int | None:
    for index in range(start, len(lines)):
        if value in lines[index]:
            return index
    return None


def parse_code_label_count(
    lines: list[str],
    label: str,
    next_labels: Iterable[str],
    code_pattern: str,
) -> tuple[str, str, int | None]:
    start = find_line(lines, label)
    if start is None:
        return "", "", None

    end = len(lines)
    for next_label in next_labels:
        found = find_line(lines, next_label, start + 1)
        if found is not None:
            end = min(end, found)

    value = compact(" ".join(line.strip() for line in lines[start:end] if line.strip()))
    value = re.sub(rf"^.*?{re.escape(label)}\s*:\s*", "", value, count=1)
    match = re.match(
        rf"(?P<code>{code_pattern})\s*(?:-\s*)?(?P<label>.*?)(?:\s+(?P<count>\d+))?$",
        value,
    )
    if not match:
        return "", value, None
    count = optional_int(match.group("count") or "")
    return match.group("code"), compact(match.group("label")), count


def parse_single_line_code_label_count(
    lines: list[str],
    label: str,
    code_pattern: str,
) -> tuple[str, str, int | None]:
    start = find_line(lines, label)
    if start is None:
        return "", "", None
    value = compact(lines[start].strip())
    value = re.sub(rf"^.*?{re.escape(label)}\s*:\s*", "", value, count=1)
    match = re.match(
        rf"(?P<code>{code_pattern})\s*(?:-\s*)?(?P<label>.*?)(?:\s+(?P<count>\d+))?$",
        value,
    )
    if not match:
        return "", value, None
    return (
        match.group("code"),
        compact(match.group("label")),
        optional_int(match.group("count") or ""),
    )


def parse_education_block(lines: list[str]) -> tuple[str, int | None]:
    jenis_index = find_line(lines, "Jenis Formasi")
    if jenis_index is None:
        return "", None

    stop = len(lines)
    for marker in ("Halaman", "Kehadiran", "No Peserta", "Laporan digenerate"):
        found = find_line(lines, marker, jenis_index + 1)
        if found is not None:
            stop = min(stop, found)

    jumlah_column = next(
        (
            line.find("Jumlah")
            for line in lines
            if "Kode" in line and "Jumlah" in line and line.find("Jumlah") >= 0
        ),
        None,
    )
    content_lines: list[str] = []
    count: int | None = None
    for line in lines[jenis_index + 1 : stop]:
        if not line.strip():
            continue
        if jumlah_column is not None:
            count_segment = compact(line[jumlah_column:])
            if re.fullmatch(r"\d+", count_segment):
                count = optional_int(count_segment)
                line = line[:jumlah_column]
        if line.strip():
            content_lines.append(line.strip())

    raw = compact(" ".join(content_lines))
    raw = re.sub(r"\bPendidikan\b\s*:?", "", raw, count=1, flags=re.I)
    raw = re.sub(r"\bPendidikan\b\s*:?", "", raw)
    if count is None:
        count_match = re.search(r"\s+(\d+)\s*$", raw)
        count = optional_int(count_match.group(1)) if count_match else None
        if count_match:
            raw = raw[: count_match.start()]
    return clean_education(raw), count


def parse_education_continuation(text: str) -> str:
    content_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("PANITIA SELEKSI NASIONAL"):
            continue
        if any(marker in stripped for marker in ("Kehadiran", "Jumlah Peserta SKD")):
            break
        if stripped.startswith("Laporan digenerate"):
            break

        # Multi-page education blocks repeat the left-side label and count.
        stripped = re.sub(r"^Pendidikan\s{2,}", "", stripped)
        stripped = re.sub(r"\s{2,}\d+\s*$", "", stripped)
        if stripped:
            content_lines.append(stripped)

    return clean_education(" ".join(content_lines))


def append_education(base: str, continuation: str) -> str:
    return clean_education(compact(f"{base} {continuation}"))


def parse_location_block(lines: list[str]) -> tuple[str, str, int | None]:
    jabatan_index = find_line(lines, "Jabatan Formasi")
    location_index = find_line(lines, "Lokasi Formasi")
    jenis_index = find_line(lines, "Jenis Formasi")
    if jabatan_index is None or location_index is None or jenis_index is None:
        return "", "", None

    inline = compact(lines[location_index].strip())
    inline = re.sub(r"^.*?Lokasi Formasi\s*:\s*", "", inline, count=1)
    match = re.match(
        r"(?P<code>\d+)\s*(?:-\s*)?(?P<label>.*?)(?:\s+(?P<count>\d+))?$",
        inline,
    )
    if not match:
        return "", inline, None

    prefix = [line.strip() for line in lines[jabatan_index + 1 : location_index] if line.strip()]
    suffix = [line.strip() for line in lines[location_index + 1 : jenis_index] if line.strip()]
    label = compact(" ".join([*prefix, match.group("label"), *suffix]))
    return match.group("code"), label, optional_int(match.group("count") or "")


def parse_formation(text: str, source_page: int) -> dict[str, Any]:
    lines = text.splitlines()
    kode_instansi, nama_instansi, jumlah_instansi = parse_single_line_code_label_count(
        lines,
        "Instansi",
        r"\d+",
    )
    kode_jabatan, jabatan, jumlah_jabatan = parse_single_line_code_label_count(
        lines,
        "Jabatan Formasi",
        r"[A-Z0-9]+",
    )
    kode_lokasi, lokasi_formasi, jumlah_lokasi = parse_location_block(lines)
    kode_jenis_formasi, jenis_formasi, jumlah_jenis = parse_single_line_code_label_count(
        lines,
        "Jenis Formasi",
        r"\d+",
    )
    pendidikan_formasi, jumlah_pendidikan = parse_education_block(lines)

    return {
        "kode_instansi": kode_instansi,
        "nama_instansi": nama_instansi,
        "jumlah_instansi": jumlah_instansi,
        "kode_jabatan": kode_jabatan,
        "jabatan": jabatan,
        "jumlah_jabatan": jumlah_jabatan,
        "kode_lokasi": kode_lokasi,
        "lokasi_formasi": lokasi_formasi,
        "jumlah_lokasi": jumlah_lokasi,
        "kode_jenis_formasi": kode_jenis_formasi,
        "jenis_formasi": jenis_formasi,
        "jumlah_jenis_formasi": jumlah_jenis,
        "pendidikan_formasi": pendidikan_formasi,
        "jumlah_pendidikan": jumlah_pendidikan,
        "source_page_formasi": source_page,
    }


def formation_key(formation: dict[str, Any]) -> str:
    return "|".join(
        str(formation.get(key) or "")
        for key in (
            "kode_instansi",
            "kode_jabatan",
            "kode_lokasi",
            "kode_jenis_formasi",
            "pendidikan_formasi",
        )
    )


def formation_identity_key(formation: dict[str, Any]) -> str:
    return "|".join(
        str(formation.get(key) or "")
        for key in (
            "kode_instansi",
            "kode_jabatan",
            "kode_lokasi",
            "kode_jenis_formasi",
        )
    )


def formation_identity_complete(formation: dict[str, Any]) -> bool:
    return all(formation.get(key) for key in (
        "kode_instansi",
        "kode_jabatan",
        "kode_lokasi",
        "kode_jenis_formasi",
    ))


RECAP_FIELDS = (
    "jumlah_formasi",
    "jumlah_peserta",
    "hadir",
    "tidak_hadir",
    "peserta_skd_2023",
    "peserta_skd_2024",
    "lolos_pg",
    "persen_lolos_pg",
    "peserta_skb",
    "persen_peserta_skb",
    "nilai_tertinggi",
    "nilai_terendah",
    "nilai_lolos_pg_tertinggi",
    "nilai_lolos_pg_terendah",
)


def parse_recap_stats(text: str) -> dict[str, int | None]:
    lines = text.splitlines()
    for line in lines:
        stripped = line.strip()
        if not stripped or re.search(r"[A-Za-z]", re.sub(r"\bnull\b", "", stripped, flags=re.I)):
            continue
        tokens = re.findall(r"(?:null|\d+%)|\d+", stripped, flags=re.I)
        if len(tokens) != len(RECAP_FIELDS):
            continue
        values = [optional_int(token.rstrip("%")) for token in tokens]
        if values[0] is None or values[1] is None:
            continue
        if values == list(range(1, len(RECAP_FIELDS) + 1)):
            continue
        return dict(zip(RECAP_FIELDS, values, strict=True))
    return {field: None for field in RECAP_FIELDS}


def merge_recap_stats(
    current: dict[str, int | None],
    continuation: dict[str, int | None],
) -> dict[str, int | None]:
    return {
        field: current.get(field) if current.get(field) is not None else continuation.get(field)
        for field in RECAP_FIELDS
    }


def parse_table_rows(text: str, source_page: int) -> list[dict[str, Any]]:
    lines = text.splitlines()
    header_index = next(
        (
            index
            for index, line in enumerate(lines)
            if all(label in line for label in ("No Peserta", "Nama", "Pendidikan", "Tahun SKD"))
        ),
        None,
    )
    if header_index is None:
        return []

    header = lines[header_index]
    score_index = next(
        (
            index
            for index in range(header_index + 1, min(header_index + 5, len(lines)))
            if all(label in lines[index] for label in ("TWK", "TIU", "TKP", "Total"))
        ),
        None,
    )
    if score_index is None:
        return []

    score_header = lines[score_index]
    labels = {
        "row_no": (header, "No", header.find("No")),
        "no_peserta": (header, "No Peserta", header.find("No Peserta")),
        "nama": (
            header,
            "Nama",
            header.find("Nama", header.find("No Peserta") + len("No Peserta")),
        ),
        "pendidikan": (header, "Pendidikan", header.find("Pendidikan")),
        "tahun_nilai_skd": (header, "Tahun SKD", header.find("Tahun SKD")),
        "twk": (score_header, "TWK", score_header.find("TWK")),
        "tiu": (score_header, "TIU", score_header.find("TIU")),
        "tkp": (score_header, "TKP", score_header.find("TKP")),
        "total": (score_header, "Total", score_header.find("Total")),
        "keterangan": (header, "Keterangan", header.find("Keterangan")),
    }
    if any(position < 0 for _, _, position in labels.values()):
        return []

    body_end_candidates = [
        found
        for marker in ("Keterangan:", "Catatan:", "Laporan digenerate")
        if (found := find_line(lines, marker, score_index + 1)) is not None
    ]
    body_end = min(body_end_candidates) if body_end_candidates else len(lines)
    body_start = score_index + 1
    participant_line_indexes = [
        index
        for index in range(body_start, body_end)
        if PARTICIPANT_RE.search(lines[index])
    ]
    blocks: list[list[str]] = []
    for index, participant_line in enumerate(participant_line_indexes):
        if index == 0:
            block_start = body_start
        else:
            previous_line = participant_line_indexes[index - 1]
            block_start = (previous_line + participant_line) // 2 + 1
        if index == len(participant_line_indexes) - 1:
            block_end = body_end
        else:
            next_line = participant_line_indexes[index + 1]
            block_end = (participant_line + next_line) // 2 + 1
        blocks.append(lines[block_start:block_end])
    parsed: list[dict[str, Any]] = []

    ordered_columns = list(labels)
    centers = {
        key: position + len(label) / 2 for key, (_, label, position) in labels.items()
    }
    boundaries = [
        round((centers[left] + centers[right]) / 2)
        for left, right in zip(ordered_columns, ordered_columns[1:])
    ]
    # "Nama" is centered with a short label, so the visual column begins slightly
    # left of the mathematical midpoint between "No Peserta" and "Nama".
    boundaries[1] -= 6
    spans: dict[str, tuple[int, int | None]] = {}
    for index, key in enumerate(ordered_columns):
        start = 0 if index == 0 else boundaries[index - 1]
        end = boundaries[index] if index < len(boundaries) else None
        spans[key] = (start, end)

    for block in blocks:
        joined = " ".join(block)
        participant_matches = PARTICIPANT_RE.findall(joined)
        if len(participant_matches) != 1:
            continue

        baseline = next(line for line in block if PARTICIPANT_RE.search(line))
        row: dict[str, Any] = {"source_page": source_page, "raw_text": compact(joined)}
        for key, (start, end) in spans.items():
            source_lines = block if key in {"nama", "pendidikan"} else [baseline]
            values = [
                line[start:end].strip()
                for line in source_lines
                if line[start:end].strip()
            ]
            row[key] = compact(" ".join(values))

        row["no_peserta"] = participant_matches[0]
        row["row_no"] = optional_int(row["row_no"])
        row["nama"] = compact(row["nama"])
        row["pendidikan"] = clean_education(row["pendidikan"])
        year_match = re.search(r"\b(2023|2024)\b", row["tahun_nilai_skd"])
        row["tahun_nilai_skd"] = optional_int(year_match.group(1) if year_match else "")
        for column in SCORE_COLUMNS:
            row[column] = optional_int(row[column])
        row["keterangan"] = compact(row["keterangan"]).upper()
        parsed.append(row)

    return parsed


def parse_table_rows_with_fallback(
    primary_text: str,
    fallback_words: list[tuple[Any, ...]],
    source_page: int,
) -> list[dict[str, Any]]:
    primary_rows = parse_table_rows(primary_text, source_page)
    if primary_rows:
        return primary_rows

    words = [
        (float(x0), float(y0), str(text))
        for x0, y0, _x1, _y1, text, *_rest in fallback_words
    ]
    anchors = sorted(
        ((y0, text) for x0, y0, text in words if 45 <= x0 < 115 and PARTICIPANT_RE.fullmatch(text)),
        key=lambda item: item[0],
    )
    if not anchors:
        return []

    columns = {
        "row_no": (0, 45),
        "no_peserta": (45, 115),
        "nama": (115, 240),
        "pendidikan": (240, 325),
        "tahun_nilai_skd": (325, 360),
        "twk": (360, 400),
        "tiu": (400, 440),
        "tkp": (440, 480),
        "total": (480, 520),
        "keterangan": (520, 590),
    }
    parsed: list[dict[str, Any]] = []
    for index, (anchor_y, participant_number) in enumerate(anchors):
        previous_y = anchors[index - 1][0] if index else anchor_y - 25
        next_y = anchors[index + 1][0] if index + 1 < len(anchors) else anchor_y + 25
        top = (previous_y + anchor_y) / 2
        bottom = (anchor_y + next_y) / 2
        row_words = [word for word in words if top <= word[1] < bottom]

        row: dict[str, Any] = {"source_page": source_page, "raw_text": ""}
        raw_parts: list[str] = []
        for key, (left, right) in columns.items():
            values = [
                (y0, x0, text)
                for x0, y0, text in row_words
                if left <= x0 < right
            ]
            value = compact(" ".join(text for _y0, _x0, text in sorted(values)))
            row[key] = value
            if value:
                raw_parts.append(value)

        row["no_peserta"] = participant_number
        row["row_no"] = optional_int(str(row["row_no"]))
        row["nama"] = compact(str(row["nama"]))
        row["pendidikan"] = clean_education(str(row["pendidikan"]))
        year_match = re.search(r"\b(2023|2024)\b", str(row["tahun_nilai_skd"]))
        row["tahun_nilai_skd"] = optional_int(year_match.group(1) if year_match else "")
        for column in SCORE_COLUMNS:
            row[column] = optional_int(str(row[column]))
        row["keterangan"] = compact(str(row["keterangan"])).upper()
        row["raw_text"] = compact(" ".join(raw_parts))
        parsed.append(row)
    return parsed


def validate_score_row(row: dict[str, Any], formation: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    no_peserta = str(row.get("no_peserta") or "")
    nama = compact(str(row.get("nama") or ""))
    pendidikan = compact(str(row.get("pendidikan") or ""))
    status = compact(str(row.get("keterangan") or "")).upper()
    year = row.get("tahun_nilai_skd")
    scores = [row.get(column) for column in SCORE_COLUMNS]

    if not PARTICIPANT_RE.fullmatch(no_peserta):
        errors.append("nomor peserta tidak valid")
    if not nama:
        errors.append("nama kosong")
    elif EDUCATION_NAME_PREFIX_RE.match(nama):
        errors.append("nama masih tercampur pendidikan")
    if not pendidikan:
        errors.append("pendidikan peserta kosong")
    if year not in {2023, 2024}:
        errors.append("tahun nilai SKD bukan 2023/2024")
    if not STATUS_RE.fullmatch(status):
        errors.append("status tidak dikenal")

    if all(value is None for value in scores):
        if status not in {"TH", "TMS", "DIS"}:
            errors.append("nilai kosong untuk peserta yang hadir")
    elif any(value is None for value in scores):
        errors.append("nilai TWK/TIU/TKP/total tidak lengkap")
    else:
        twk, tiu, tkp, total = (int(value) for value in scores)
        if not (0 <= twk <= 150 and 0 <= tiu <= 175 and 0 <= tkp <= 225):
            errors.append("nilai subtes di luar rentang")
        if twk + tiu + tkp != total:
            errors.append("total tidak sama dengan TWK+TIU+TKP")

    for field_name in ("kode_instansi", "kode_jabatan", "kode_lokasi", "jenis_formasi"):
        if not compact(str(formation.get(field_name) or "")):
            errors.append(f"formasi kehilangan {field_name}")
    return errors


@dataclass
class FormationResult:
    instance_id: str
    formation: dict[str, Any]
    recap: dict[str, int | None]
    rows: list[dict[str, Any]] = field(default_factory=list)
    result_pages: set[int] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)


def actual_formation_stats(rows: list[dict[str, Any]]) -> dict[str, int | None]:
    scored = [row for row in rows if row.get("total") is not None]
    passing = [row for row in scored if str(row.get("keterangan") or "").startswith("P")]
    skb = [row for row in scored if str(row.get("keterangan") or "").startswith("P/L")]
    totals = [int(row["total"]) for row in scored]
    skb_totals = [int(row["total"]) for row in skb]
    return {
        "actual_peserta": len(rows),
        "actual_hadir": len(scored),
        "actual_tidak_hadir": len(rows) - len(scored),
        "actual_skd_2023": sum(row.get("tahun_nilai_skd") == 2023 for row in rows),
        "actual_skd_2024": sum(row.get("tahun_nilai_skd") == 2024 for row in rows),
        "actual_lolos_pg": len(passing),
        "actual_peserta_skb": len(skb),
        "actual_nilai_tertinggi": max(totals) if totals else None,
        "actual_nilai_terendah": min(totals) if totals else None,
        "actual_lolos_pg_tertinggi": max(skb_totals) if skb_totals else None,
        "actual_lolos_pg_terendah": min(skb_totals) if skb_totals else None,
    }


def validate_formation(result: FormationResult) -> list[str]:
    errors = list(result.errors)
    actual = actual_formation_stats(result.rows)
    comparisons = (
        ("jumlah_peserta", "actual_peserta"),
        ("hadir", "actual_hadir"),
        ("tidak_hadir", "actual_tidak_hadir"),
        ("peserta_skd_2023", "actual_skd_2023"),
        ("peserta_skd_2024", "actual_skd_2024"),
        ("lolos_pg", "actual_lolos_pg"),
        ("peserta_skb", "actual_peserta_skb"),
        ("nilai_tertinggi", "actual_nilai_tertinggi"),
        ("nilai_terendah", "actual_nilai_terendah"),
        ("nilai_lolos_pg_tertinggi", "actual_lolos_pg_tertinggi"),
        ("nilai_lolos_pg_terendah", "actual_lolos_pg_terendah"),
    )
    for expected_key, actual_key in comparisons:
        expected = result.recap.get(expected_key)
        observed = actual.get(actual_key)
        if expected is not None and expected != observed:
            errors.append(f"{expected_key}: rekap={expected}, hasil={observed}")
    return errors


IMPORT_FIELDS = [
    "record_type",
    "tahun",
    "nama_instansi",
    "kode_instansi",
    "jabatan",
    "kode_jabatan",
    "kode_lokasi",
    "lokasi_formasi",
    "kode_jenis_formasi",
    "jenis_formasi",
    "pendidikan_formasi",
    "pendidikan",
    "jumlah_formasi",
    "no_peserta",
    "nama",
    "nama_normalized",
    "tahun_nilai_skd",
    "twk",
    "tiu",
    "tkp",
    "total",
    "keterangan",
    "source_pdf",
    "source_url",
    "source_page",
    "source_page_formasi",
    "source_sheet_row",
    "formation_instance_id",
    "validation_status",
    "validation_errors",
]

FORMATION_FIELDS = [
    "formation_instance_id",
    "validation_status",
    "validation_errors",
    "source_page_formasi",
    "result_pages",
    "kode_instansi",
    "nama_instansi",
    "jumlah_instansi",
    "kode_jabatan",
    "jabatan",
    "jumlah_jabatan",
    "kode_lokasi",
    "lokasi_formasi",
    "jumlah_lokasi",
    "kode_jenis_formasi",
    "jenis_formasi",
    "jumlah_jenis_formasi",
    "pendidikan_formasi",
    "jumlah_pendidikan",
    *RECAP_FIELDS,
    "actual_peserta",
    "actual_hadir",
    "actual_tidak_hadir",
    "actual_skd_2023",
    "actual_skd_2024",
    "actual_lolos_pg",
    "actual_peserta_skb",
    "actual_nilai_tertinggi",
    "actual_nilai_terendah",
    "actual_lolos_pg_tertinggi",
    "actual_lolos_pg_terendah",
]


def build_import_row(
    score: dict[str, Any],
    result: FormationResult,
    catalog: dict[str, str],
    year: int,
    row_errors: list[str],
    formation_errors: list[str],
) -> dict[str, Any]:
    formation = result.formation
    errors = [*row_errors, *formation_errors]
    return {
        "record_type": "participant",
        "tahun": year,
        "nama_instansi": formation.get("nama_instansi") or catalog.get("entity_name"),
        "kode_instansi": formation.get("kode_instansi"),
        "jabatan": formation.get("jabatan"),
        "kode_jabatan": formation.get("kode_jabatan"),
        "kode_lokasi": formation.get("kode_lokasi"),
        "lokasi_formasi": formation.get("lokasi_formasi"),
        "kode_jenis_formasi": formation.get("kode_jenis_formasi"),
        "jenis_formasi": formation.get("jenis_formasi"),
        "pendidikan_formasi": formation.get("pendidikan_formasi"),
        "pendidikan": score.get("pendidikan"),
        "jumlah_formasi": result.recap.get("jumlah_formasi")
        or formation.get("jumlah_pendidikan"),
        "no_peserta": score.get("no_peserta"),
        "nama": score.get("nama"),
        "nama_normalized": normalize_name(str(score.get("nama") or "")),
        "tahun_nilai_skd": score.get("tahun_nilai_skd"),
        "twk": score.get("twk"),
        "tiu": score.get("tiu"),
        "tkp": score.get("tkp"),
        "total": score.get("total"),
        "keterangan": score.get("keterangan"),
        "source_pdf": catalog.get("pdf_name") or Path(catalog.get("output_path", "")).name,
        "source_url": catalog.get("drive_url"),
        "source_page": score.get("source_page"),
        "source_page_formasi": formation.get("source_page_formasi"),
        "source_sheet_row": catalog.get("sheet_row"),
        "formation_instance_id": result.instance_id,
        "validation_status": "valid" if not errors else "needs_review",
        "validation_errors": " | ".join(errors),
    }


def build_formation_import_row(
    formation: dict[str, Any],
    catalog: dict[str, str],
    year: int,
) -> dict[str, Any]:
    return {
        "record_type": "formation",
        "tahun": year,
        "nama_instansi": formation.get("nama_instansi") or catalog.get("entity_name"),
        "kode_instansi": formation.get("kode_instansi"),
        "jabatan": formation.get("jabatan"),
        "kode_jabatan": formation.get("kode_jabatan"),
        "kode_lokasi": formation.get("kode_lokasi"),
        "lokasi_formasi": formation.get("lokasi_formasi"),
        "kode_jenis_formasi": formation.get("kode_jenis_formasi"),
        "jenis_formasi": formation.get("jenis_formasi"),
        "pendidikan_formasi": formation.get("pendidikan_formasi"),
        "jumlah_formasi": formation.get("jumlah_formasi")
        or formation.get("jumlah_pendidikan"),
        "source_pdf": catalog.get("pdf_name") or Path(catalog.get("output_path", "")).name,
        "source_url": catalog.get("drive_url"),
        "source_page_formasi": formation.get("source_page_formasi"),
        "source_sheet_row": catalog.get("sheet_row"),
        "formation_instance_id": formation.get("formation_instance_id"),
        "validation_status": formation.get("validation_status"),
        "validation_errors": formation.get("validation_errors"),
    }


def parse_pdf(
    pdf_path: Path,
    catalog: dict[str, str],
    max_pages: int = 0,
    progress_every: int = 100,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    reader = PdfReader(str(pdf_path), strict=False)
    fallback_reader = fitz.open(str(pdf_path))
    total_pages = len(reader.pages)
    pages_to_read = total_pages if max_pages <= 0 else min(max_pages, total_pages)
    year = optional_int(catalog.get("tahun", "")) or 2024
    results: list[FormationResult] = []
    current: FormationResult | None = None
    page_kinds: Counter[str] = Counter()
    unknown_pages: list[int] = []
    page_parse_errors: list[str] = []
    collecting_recap_education = False
    reading_result_preamble = False

    for page_index in range(pages_to_read):
        page_number = page_index + 1
        if progress_every and (page_number == 1 or page_number % progress_every == 0):
            print(f"[{page_number}/{pages_to_read}] membaca {pdf_path.name}")
        try:
            text = reader.pages[page_index].extract_text(extraction_mode="layout") or ""
        except Exception as exc:
            page_parse_errors.append(f"halaman {page_number}: {type(exc).__name__}: {exc}")
            continue

        kind = page_kind(text)
        page_kinds[kind] += 1
        if kind in {"unknown", "blank_generated"}:
            upper = text.upper()
            if "HASIL SELEKSI KOMPETENSI DASAR" in upper:
                collecting_recap_education = False
                reading_result_preamble = True

            continuation_education = ""
            if kind == "unknown" and current is not None and collecting_recap_education:
                continuation_education = parse_education_continuation(text)
                if continuation_education:
                    current.formation["pendidikan_formasi"] = append_education(
                        str(current.formation.get("pendidikan_formasi") or ""),
                        continuation_education,
                    )

            continuation_stats = parse_recap_stats(text)
            if (
                kind == "unknown"
                and current is not None
                and continuation_stats.get("jumlah_peserta") is not None
            ):
                current.recap = merge_recap_stats(current.recap, continuation_stats)
                page_kinds[kind] -= 1
                page_kinds["rekap_continuation"] += 1
                continue
            if continuation_education:
                page_kinds[kind] -= 1
                page_kinds["education_continuation"] += 1
                continue
            if kind == "unknown" and reading_result_preamble:
                page_kinds[kind] -= 1
                page_kinds["result_preamble"] += 1
                continue
            if kind == "unknown":
                unknown_pages.append(page_number)
            continue

        if kind == "rekap":
            formation = parse_formation(text, page_number)
            recap = parse_recap_stats(text)
            if not formation_identity_complete(formation) or recap.get("jumlah_peserta") is None:
                fallback_text = fallback_reader[page_index].get_text("text", sort=True)
                fallback_formation = parse_formation(fallback_text, page_number)
                fallback_recap = parse_recap_stats(fallback_text)
                if formation_identity_complete(fallback_formation):
                    formation = fallback_formation
                if fallback_recap.get("jumlah_peserta") is not None:
                    recap = fallback_recap
            current = FormationResult(
                instance_id=f"{catalog.get('sheet_row') or 'source'}-{page_number}",
                formation=formation,
                recap=recap,
            )
            collecting_recap_education = True
            reading_result_preamble = False
            if not formation_key(formation).strip("|"):
                current.errors.append("header formasi rekap tidak terbaca")
            results.append(current)
            continue

        collecting_recap_education = False
        reading_result_preamble = False

        parsed_formation = parse_formation(text, page_number)
        parsed_key = formation_key(parsed_formation).strip("|")
        if current is None:
            current = FormationResult(
                instance_id=f"{catalog.get('sheet_row') or 'source'}-{page_number}-orphan",
                formation=parsed_formation,
                recap={field: None for field in RECAP_FIELDS},
                errors=["halaman hasil tidak memiliki rekap sebelumnya"],
            )
            results.append(current)
        elif (
            formation_identity_complete(parsed_formation)
            and formation_identity_key(current.formation)
            != formation_identity_key(parsed_formation)
        ):
            current = FormationResult(
                instance_id=f"{catalog.get('sheet_row') or 'source'}-{page_number}-orphan",
                formation=parsed_formation,
                recap={field: None for field in RECAP_FIELDS},
                errors=["header hasil tidak cocok dengan rekap sebelumnya"],
            )
            results.append(current)
        elif parsed_key:
            for key, value in parsed_formation.items():
                if not current.formation.get(key) and value:
                    current.formation[key] = value

        rows = parse_table_rows(text, page_number)
        if not rows:
            rows = parse_table_rows_with_fallback(
                text,
                fallback_reader[page_index].get_text("words", sort=True),
                page_number,
            )
        current.rows.extend(rows)
        current.result_pages.add(page_number)

    clean_rows: list[dict[str, Any]] = []
    review_rows: list[dict[str, Any]] = []
    formation_rows: list[dict[str, Any]] = []
    duplicate_numbers: Counter[str] = Counter()

    for result in results:
        formation_errors = validate_formation(result)
        actual = actual_formation_stats(result.rows)
        formation_status = "valid" if not formation_errors else "needs_review"
        formation_rows.append(
            {
                **result.formation,
                **result.recap,
                **actual,
                "formation_instance_id": result.instance_id,
                "validation_status": formation_status,
                "validation_errors": " | ".join(formation_errors),
                "result_pages": ",".join(str(page) for page in sorted(result.result_pages)),
            }
        )
        for score in result.rows:
            duplicate_numbers[str(score.get("no_peserta") or "")] += 1
            row_errors = validate_score_row(score, result.formation)
            import_row = build_import_row(
                score,
                result,
                catalog,
                year,
                row_errors,
                formation_errors,
            )
            if import_row["validation_status"] == "valid":
                clean_rows.append(import_row)
            else:
                review_rows.append(import_row)

    duplicate_values = {value for value, count in duplicate_numbers.items() if value and count > 1}
    if duplicate_values:
        retained: list[dict[str, Any]] = []
        for row in clean_rows:
            if row["no_peserta"] in duplicate_values:
                row["validation_status"] = "needs_review"
                row["validation_errors"] = "nomor peserta duplikat dalam PDF"
                review_rows.append(row)
            else:
                retained.append(row)
        clean_rows = retained

    report = {
        "parser": "kemenhub_layout_v2",
        "parser_version": 2,
        "pdf": str(pdf_path),
        "source_sheet_row": catalog.get("sheet_row"),
        "source_url": catalog.get("drive_url"),
        "total_pages": total_pages,
        "pages_read": pages_to_read,
        "is_full_document": pages_to_read == total_pages,
        "page_kinds": dict(page_kinds),
        "unknown_pages": unknown_pages,
        "page_parse_errors": page_parse_errors,
        "formations_total": len(formation_rows),
        "formations_valid": sum(row["validation_status"] == "valid" for row in formation_rows),
        "formations_needs_review": sum(
            row["validation_status"] == "needs_review" for row in formation_rows
        ),
        "formations_without_participants": sum(
            row["actual_peserta"] == 0 for row in formation_rows
        ),
        "participants_total": len(clean_rows) + len(review_rows),
        "participants_clean": len(clean_rows),
        "participants_needs_review": len(review_rows),
        "duplicate_participant_numbers": len(duplicate_values),
        "participants_skd_2023": sum(row.get("tahun_nilai_skd") == 2023 for row in clean_rows),
        "participants_skd_2024": sum(row.get("tahun_nilai_skd") == 2024 for row in clean_rows),
        "status_counts_clean": dict(Counter(str(row.get("keterangan")) for row in clean_rows)),
        "ready_for_admin_review": pages_to_read == total_pages
        and not review_rows
        and not page_parse_errors,
        "ready_for_import": False,
        "notes": [
            "CSV clean masih wajib diperiksa sampelnya di admin terhadap PDF asli.",
            "ready_for_import sengaja false sampai pemeriksaan manual selesai.",
        ],
    }
    fallback_reader.close()
    return clean_rows, review_rows, formation_rows, report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse Kemenhub SKD-only PDF with layout-aware column extraction."
    )
    parser.add_argument("--pdf", default="data/raw/pdfs/30-KEMENHUB.pdf")
    parser.add_argument("--catalog", default="data/staging/pdf_sources_catalog.csv")
    parser.add_argument("--sheet-row", default="30")
    parser.add_argument("--output-prefix", default="data/staging/kemenhub-2024-v2")
    parser.add_argument("--max-pages", type=int, default=0, help="0 membaca seluruh PDF.")
    parser.add_argument("--progress-every", type=int, default=100)
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF tidak ditemukan: {pdf_path}")

    catalog = read_catalog_row(Path(args.catalog), args.sheet_row)
    if not catalog:
        raise ValueError(f"Sheet row {args.sheet_row} tidak ditemukan di {args.catalog}")
    catalog["output_path"] = str(pdf_path)

    clean, review, formations, report = parse_pdf(
        pdf_path,
        catalog,
        max_pages=args.max_pages,
        progress_every=args.progress_every,
    )
    prefix = Path(args.output_prefix)
    year = optional_int(catalog.get("tahun", "")) or 2024
    empty_formations = [
        build_formation_import_row(row, catalog, year)
        for row in formations
        if row["validation_status"] == "valid" and row["actual_peserta"] == 0
    ]
    admin_import = [*clean, *empty_formations]
    report["admin_import_rows"] = len(admin_import)
    write_csv(Path(f"{prefix}-clean.csv"), clean, IMPORT_FIELDS)
    write_csv(Path(f"{prefix}-admin-import.csv"), admin_import, IMPORT_FIELDS)
    write_csv(Path(f"{prefix}-review.csv"), review, IMPORT_FIELDS)
    write_csv(Path(f"{prefix}-formations.csv"), formations, FORMATION_FIELDS)
    Path(f"{prefix}-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
