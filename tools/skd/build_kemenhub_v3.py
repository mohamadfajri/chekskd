from __future__ import annotations

import argparse
import csv
import json
import re
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


PARSER_FAMILY = "kemenhub_layout"
PARSER_VERSION = "3.0.0"
SUSPICIOUS_NAME_RE = re.compile(r"\d|^(?:PENDIDIKAN|PROFESI|S-[123]|D-(?:I|II|III|IV))\b", re.I)


def compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalized(value: str | None) -> str:
    text = unicodedata.normalize("NFD", compact(value).upper())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"\b(?:PROGRAM STUDI|PRODI|JURUSAN)\b", " ", text)
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return compact(text)


def split_education_options(value: str | None) -> list[str]:
    options = [compact(item) for item in re.split(r"\s+/\s+", compact(value))]
    return [item for item in options if item]


def similarity(left: str, right: str) -> float:
    left_normalized = normalized(left)
    right_normalized = normalized(right)
    if not left_normalized or not right_normalized:
        return 0.0
    sequence = SequenceMatcher(None, left_normalized, right_normalized).ratio()
    left_tokens = set(left_normalized.split())
    right_tokens = set(right_normalized.split())
    token_score = len(left_tokens & right_tokens) / len(left_tokens | right_tokens)
    return max(sequence, token_score)


def match_education(raw_value: str, formation_value: str) -> tuple[str, str, float, str]:
    options = split_education_options(formation_value)
    if not raw_value or not options:
        return raw_value, "needs_review", 0.0, "pendidikan kosong atau opsi formasi tidak terbaca"

    raw_normalized = normalized(raw_value)
    exact = next((option for option in options if normalized(option) == raw_normalized), None)
    if exact:
        return exact, "parsed", 0.99, ""

    ranked = sorted(
        ((similarity(raw_value, option), option) for option in options),
        reverse=True,
    )
    best_score, best_option = ranked[0]
    second_score = ranked[1][0] if len(ranked) > 1 else 0.0
    unique_enough = len(ranked) == 1 or best_score - second_score >= 0.08
    if unique_enough and best_score >= 0.88:
        return (
            best_option,
            "auto_corrected",
            round(best_score, 4),
            f"pendidikan dinormalisasi dari: {raw_value}",
        )
    return (
        raw_value,
        "needs_review",
        round(best_score, 4),
        f"pendidikan tidak cocok pasti; kandidat terdekat: {best_option}",
    )


def drive_file_id(source_url: str | None) -> str:
    path = urlparse(source_url or "").path
    match = re.search(r"/d/([^/]+)", path)
    return match.group(1) if match else ""


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as file:
        return [{key: value or "" for key, value in row.items()} for row in csv.DictReader(file)]


def write_rows(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def upgrade_row(row: dict[str, str], total_pages: int) -> dict[str, Any]:
    upgraded: dict[str, Any] = dict(row)
    record_type = compact(row.get("record_type")) or "participant"
    source_url = compact(row.get("source_url"))
    upgraded.update(
        {
            "parser_family": PARSER_FAMILY,
            "parser_version": PARSER_VERSION,
            "source_drive_file_id": drive_file_id(source_url),
            "source_total_pages": total_pages,
            "formation_quality_status": "parsed",
            "quality_status": "parsed",
            "parser_confidence": 0.99,
        }
    )

    if record_type == "formation":
        upgraded["formation_quality_status"] = upgraded["quality_status"] = (
            "needs_review" if compact(row.get("validation_errors")) else "parsed"
        )
        return upgraded

    raw_name = compact(row.get("nama"))
    raw_education = compact(row.get("pendidikan"))
    education, status, confidence, issue = match_education(
        raw_education,
        compact(row.get("pendidikan_formasi")),
    )
    issues = [compact(row.get("validation_errors")), issue]
    if not raw_name or len(raw_name) < 3 or SUSPICIOUS_NAME_RE.search(raw_name):
        status = "needs_review"
        confidence = min(confidence, 0.5)
        issues.append("nama peserta mengandung pola mencurigakan")

    upgraded.update(
        {
            "nama_raw": raw_name,
            "pendidikan_raw": raw_education,
            "pendidikan": education,
            "quality_status": status,
            "parser_confidence": confidence,
            "validation_status": "valid" if status != "needs_review" else "needs_review",
            "validation_errors": " | ".join(item for item in issues if item),
        }
    )
    return upgraded


def build_v3(input_path: Path, total_pages: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows = [upgrade_row(row, total_pages) for row in read_rows(input_path)]
    participant_rows = [row for row in rows if row.get("record_type") != "formation"]
    quality_counts = Counter(str(row["quality_status"]) for row in participant_rows)
    report = {
        "parser_family": PARSER_FAMILY,
        "parser_version": PARSER_VERSION,
        "input": str(input_path),
        "total_pages": total_pages,
        "rows_total": len(rows),
        "participants_total": len(participant_rows),
        "formations_represented": len(
            {row.get("formation_instance_id") for row in rows if row.get("formation_instance_id")}
        ),
        "quality_counts": dict(quality_counts),
        "review_rows": quality_counts.get("needs_review", 0),
        "ready_for_publish": False,
        "notes": [
            "Output ini hanya untuk staging dan review admin.",
            "Baris needs_review harus dibandingkan dengan source_page pada PDF asli.",
            "Batch baru boleh dipublikasikan setelah seluruh baris berstatus verified.",
        ],
    }
    return rows, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Upgrade hasil parser Kemenhub v2 menjadi staging v3.")
    parser.add_argument(
        "--input",
        default="data/staging/kemenhub-2024-v2-admin-import.csv",
    )
    parser.add_argument("--output-prefix", default="data/staging/kemenhub-2024-v3")
    parser.add_argument("--total-pages", type=int, default=2612)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"CSV parser v2 tidak ditemukan: {input_path}")

    rows, report = build_v3(input_path, args.total_pages)
    prefix = Path(args.output_prefix)
    fields = list(rows[0].keys()) if rows else []
    write_rows(Path(f"{prefix}-staging.csv"), rows, fields)
    write_rows(
        Path(f"{prefix}-review.csv"),
        [row for row in rows if row.get("quality_status") == "needs_review"],
        fields,
    )
    Path(f"{prefix}-report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
