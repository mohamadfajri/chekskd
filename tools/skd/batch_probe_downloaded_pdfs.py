from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path


def read_manifest(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as file:
        rows = []
        for row in csv.DictReader(file):
            rows.append({key.strip('\ufeff"'): value for key, value in row.items()})
        return rows


def safe_stem(path: Path) -> str:
    stem = path.stem
    return "".join(ch if ch.isalnum() or ch in "-._" else "-" for ch in stem)[:140]


def run_probe(pdf_path: Path, output_prefix: Path, max_pages: int) -> tuple[bool, str]:
    command = [
        sys.executable,
        "tools/skd/probe_pdf_text.py",
        "--pdf",
        str(pdf_path),
        "--max-pages",
        str(max_pages),
        "--output-prefix",
        str(output_prefix),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        return False, (result.stderr or result.stdout).strip()
    return True, result.stdout.strip()


def write_summary(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "sheet_row",
        "entity_name",
        "pdf_name",
        "drive_file_id",
        "output_path",
        "status",
        "bytes",
        "probe_status",
        "score_rows",
        "total_pages",
        "error",
    ]
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe downloaded PDFs and summarize extraction readiness.")
    parser.add_argument("--manifest", default="data/staging/downloaded_pdfs.csv")
    parser.add_argument("--out-dir", default="data/staging/batch-probes")
    parser.add_argument("--summary", default="data/staging/batch_probe_summary.csv")
    parser.add_argument("--max-pages", type=int, default=40)
    parser.add_argument("--limit", type=int, default=0, help="0 means all downloaded PDFs in manifest.")
    args = parser.parse_args()

    manifest_rows = [row for row in read_manifest(Path(args.manifest)) if row.get("status") in {"downloaded", "skipped_exists"}]
    if args.limit > 0:
        manifest_rows = manifest_rows[: args.limit]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_rows: list[dict[str, str]] = []

    for index, row in enumerate(manifest_rows, start=1):
        pdf_path = Path(row["output_path"])
        prefix = out_dir / safe_stem(pdf_path)
        print(f"[{index}/{len(manifest_rows)}] {pdf_path}")

        if not pdf_path.exists():
            summary_rows.append({**row, "probe_status": "missing_pdf", "score_rows": "0", "total_pages": "0", "error": "PDF file missing"})
            continue

        ok, output = run_probe(pdf_path, prefix, args.max_pages)
        if not ok:
            print(f"  !! {output[:300]}")
            summary_rows.append({**row, "probe_status": "error", "score_rows": "0", "total_pages": "0", "error": output[:1000]})
            write_summary(Path(args.summary), summary_rows)
            continue

        report_path = Path(f"{prefix}-probe.json")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        score_rows = str(report.get("score_rows_sampled", 0))
        total_pages = str(report.get("total_pages", 0))
        status = "parsed_scores" if int(score_rows) > 0 else "no_scores_found"
        print(f"  -> {status} rows={score_rows} pages={total_pages}")
        summary_rows.append({**row, "probe_status": status, "score_rows": score_rows, "total_pages": total_pages, "error": ""})
        write_summary(Path(args.summary), summary_rows)

    summary_path = Path(args.summary)
    write_summary(summary_path, summary_rows)
    print(f"Summary -> {summary_path}")


if __name__ == "__main__":
    main()
