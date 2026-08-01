from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from pypdf import PdfReader


STATUS_RE = re.compile(r"^[A-Z0-9/.-]+$")
PARTICIPANT_RE = re.compile(r"(?<!\d)(?P<row_no>\d{1,3})\s+(?P<no_peserta>24\d{14,18})\s+")
SCORE_TAIL_RE = re.compile(
    r"(?P<ipk>\d(?:\.\d+)?)\s+"
    r"(?P<twk>\d{2,3})\s+"
    r"(?P<tiu>\d{2,3})\s+"
    r"(?P<tkp>\d{2,3})\s+"
    r"(?P<total>\d{3})\s+"
    r"(?P<skor_skd>\d+(?:\.\d+)?)\s+"
    r"(?P<nilai_skb>\d+(?:\.\d+)?)\s+"
    r"(?P<skor_skb>\d+(?:\.\d+)?)\s+"
    r"(?P<nilai_akhir>\d+(?:\.\d+)?)\s+"
    r"(?P<keterangan>[A-Z0-9/.-]+)\s*$"
)


def parse_code_label_count(line: str, prefix: str, code_pattern: str = r"[A-Z0-9]+") -> tuple[str, str, str]:
    value = line.split(prefix, 1)[1].strip()
    value = value.replace(": -", "").replace(":-", "").strip()
    value = value[1:].strip() if value.startswith(":") else value
    value = value.replace(" - ", " ")
    match = re.match(rf"(?P<code>{code_pattern})\s+(?P<label>.*?)(?:\s+(?P<count>\d+))?$", value)
    if not match:
        return "", value, ""
    return match.group("code") or "", match.group("label").strip(), match.group("count") or ""


def parse_location_line(line: str) -> tuple[str, str, str]:
    if line.startswith("Lokasi Formasi"):
        return parse_code_label_count(line, "Lokasi Formasi", r"\d+")

    left = line.split("Lokasi Formasi", 1)[0]
    left = left.replace(": -", "").replace(":-", "").strip()
    match = re.match(r"(?P<count>\d+)(?P<label>.*?)(?P<code>\d{6,})$", left)
    if not match:
        return "", left, ""
    return match.group("code"), match.group("label").strip(), match.group("count")


def page_kind(text: str) -> str:
    if "REKAP HASIL INTEGRASI" in text:
        return "rekap"
    if "HASIL INTEGRASI SKD DAN SKB" in text:
        return "hasil"
    return "unknown"


def parse_formation_page(text: str, page_number: int) -> dict[str, Any]:
    row: dict[str, Any] = {
        "source_page": page_number,
        "page_kind": page_kind(text),
        "kode_jabatan": "",
        "jabatan": "",
        "jumlah_jabatan": "",
        "kode_instansi": "",
        "nama_instansi": "",
        "jumlah_instansi": "",
        "kode_lokasi": "",
        "lokasi_formasi": "",
        "jumlah_lokasi": "",
        "kode_jenis_formasi": "",
        "jenis_formasi": "",
        "jumlah_formasi": "",
        "pendidikan": "",
    }

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if line.startswith("Jabatan Formasi"):
            code, label, count = parse_code_label_count(line, "Jabatan Formasi")
            row.update({"kode_jabatan": code, "jabatan": label, "jumlah_jabatan": count})
        elif line.startswith("Instansi"):
            code, label, count = parse_code_label_count(line, "Instansi", r"\d+")
            row.update({"kode_instansi": code, "nama_instansi": label, "jumlah_instansi": count})
        elif "Lokasi Formasi" in line:
            code, label, count = parse_location_line(line)
            row.update({"kode_lokasi": code, "lokasi_formasi": label, "jumlah_lokasi": count})
        elif line.startswith("Jenis Formasi"):
            code, label, count = parse_code_label_count(line, "Jenis Formasi", r"\d+")
            row.update({"kode_jenis_formasi": code, "jenis_formasi": label, "jumlah_formasi": count})
        elif line.startswith("Pendidikan"):
            parts = [line.replace("Pendidikan", "", 1).strip()]
            cursor = index + 1
            while cursor < len(lines) and not lines[cursor].startswith("REKAP ") and not lines[cursor].startswith("HASIL "):
                parts.append(lines[cursor])
                cursor += 1
            row["pendidikan"] = " ".join(part for part in parts if part).strip()

    return row


def parse_score_rows(text: str, page_number: int) -> list[dict[str, Any]]:
    compact = re.sub(r"\s+", " ", text).strip()
    matches = list(PARTICIPANT_RE.finditer(compact))
    rows: list[dict[str, Any]] = []

    for index, match in enumerate(matches):
        block_start = match.end()
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(compact)
        block = compact[block_start:block_end]
        block = block.split("Laporan digenerate", 1)[0].strip()
        tail = SCORE_TAIL_RE.search(block)
        if not tail:
            continue

        identity = block[: tail.start()].strip(" -")
        status = tail.group("keterangan")
        if not STATUS_RE.match(status):
            continue

        rows.append(
            {
                "source_page": page_number,
                "row_no": match.group("row_no"),
                "no_peserta": match.group("no_peserta"),
                "raw_identity": identity,
                "ipk": tail.group("ipk"),
                "twk": tail.group("twk"),
                "tiu": tail.group("tiu"),
                "tkp": tail.group("tkp"),
                "total": tail.group("total"),
                "skor_skd": tail.group("skor_skd"),
                "nilai_skb": tail.group("nilai_skb"),
                "skor_skb": tail.group("skor_skb"),
                "nilai_akhir": tail.group("nilai_akhir"),
                "keterangan": status,
            }
        )

    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe a SKD/SKB PDF text layer and emit local staging samples.")
    parser.add_argument("--pdf", default="data/raw/kemenag-2024.pdf", help="Path to PDF file.")
    parser.add_argument("--max-pages", type=int, default=40, help="Pages to sample from the beginning of the PDF.")
    parser.add_argument("--output-prefix", default="data/staging/kemenag-2024", help="Output path prefix.")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    output_prefix = Path(args.output_prefix)
    reader = PdfReader(str(pdf_path))
    total_pages = len(reader.pages)
    sample_pages = min(args.max_pages, total_pages)

    formation_pages: list[dict[str, Any]] = []
    score_rows: list[dict[str, Any]] = []
    text_lengths: list[int] = []
    kinds: Counter[str] = Counter()
    last_formation_context: dict[str, Any] = {}

    for page_index in range(sample_pages):
        text = reader.pages[page_index].extract_text() or ""
        text_lengths.append(len(text))
        formation = parse_formation_page(text, page_index + 1)
        page_score_rows = parse_score_rows(text, page_index + 1)

        has_formation_header = bool(formation["kode_jabatan"] and formation["kode_lokasi"])
        if has_formation_header:
            last_formation_context = {
                key: value
                for key, value in formation.items()
                if key not in {"source_page", "page_kind"} and value
            }
        elif last_formation_context and page_score_rows:
            for key, value in last_formation_context.items():
                formation[key] = formation.get(key) or value
            if formation["page_kind"] == "unknown":
                formation["page_kind"] = "hasil_continuation"

        formation_pages.append(formation)
        kinds[formation["page_kind"]] += 1
        score_rows.extend(page_score_rows)

    report = {
        "pdf": str(pdf_path),
        "total_pages": total_pages,
        "sample_pages": sample_pages,
        "text_pages_in_sample": sum(1 for length in text_lengths if length > 50),
        "empty_or_low_text_pages_in_sample": sum(1 for length in text_lengths if length <= 50),
        "page_kinds": dict(kinds),
        "formation_pages_sampled": len(formation_pages),
        "score_rows_sampled": len(score_rows),
        "notes": [
            "Probe ini belum final importer.",
            "raw_identity sengaja disimpan apa adanya karena posisi nama/pendidikan pada PDF bisa berpindah antar baris.",
            "Gunakan hasil ini untuk validasi pola sebelum import Supabase.",
        ],
    }

    write_csv(Path(f"{output_prefix}-formation-pages.csv"), formation_pages)
    write_csv(Path(f"{output_prefix}-score-rows-sample.csv"), score_rows)
    Path(f"{output_prefix}-probe.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
