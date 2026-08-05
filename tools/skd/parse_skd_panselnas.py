from __future__ import annotations

import argparse
import json
from pathlib import Path

from parse_kemenhub_v2 import (
    FORMATION_FIELDS,
    IMPORT_FIELDS,
    build_formation_import_row,
    parse_pdf,
    write_csv,
)


PARSER_NAME = "panselnas_skd_layout_v2"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parse PDF hasil SKD Panselnas dari file lokal tanpa Google Drive."
    )
    parser.add_argument("--pdf", required=True, help="Path PDF lokal.")
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--institution-code", default="")
    parser.add_argument("--institution-name", default="")
    parser.add_argument("--source-sheet-row", default="")
    parser.add_argument("--year", type=int, default=2024)
    parser.add_argument("--max-pages", type=int, default=0, help="0 membaca seluruh PDF.")
    parser.add_argument("--progress-every", type=int, default=100)
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF tidak ditemukan: {pdf_path}")

    catalog = {
        "sheet_row": args.source_sheet_row,
        "tahun": str(args.year),
        "entity_name": args.institution_name,
        "pdf_name": pdf_path.name,
        "drive_url": "",
        "output_path": str(pdf_path),
    }
    clean, review, formations, report = parse_pdf(
        pdf_path,
        catalog,
        max_pages=args.max_pages,
        progress_every=args.progress_every,
    )

    observed_codes = sorted(
        {
            str(row.get("kode_instansi") or "")
            for row in formations
            if row.get("kode_instansi")
        }
    )
    code_matches = not args.institution_code or observed_codes == [args.institution_code]
    if not code_matches:
        report["notes"].append(
            "Kode instansi PDF tidak sama dengan --institution-code; batch wajib diperiksa."
        )

    empty_formations = [
        build_formation_import_row(row, catalog, args.year)
        for row in formations
        if row["validation_status"] == "valid" and row["actual_peserta"] == 0
    ]
    admin_import = [*clean, *empty_formations]
    report.update(
        {
            "parser": PARSER_NAME,
            "source_file_name": pdf_path.name,
            "source_url": "",
            "expected_institution_code": args.institution_code,
            "observed_institution_codes": observed_codes,
            "institution_code_matches": code_matches,
            "admin_import_rows": len(admin_import),
        }
    )

    prefix = Path(args.output_prefix)
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
