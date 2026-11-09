"""Read-only, evidence-based matching for the Kejaksaan 2024 pilot."""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys

import pymupdf


INSTITUTION = "Kejaksaan Agung"
TITLE = "REKAPITULASI HASIL SELEKSI KOMPETENSI DASAR"


def norm(value):
    return " ".join((value or "").upper().split())


def education_key(value):
    return tuple(sorted({norm(item) for item in value.split("/") if norm(item)}))


def job_label(value):
    # Only the prefix printed separately from the job label in this PDF is ignored.
    return re.sub(r"^[0-9]+ - ", "", norm(value))


def anchor(page, label):
    hits = page.search_for(label)
    if len(hits) != 1:
        raise ValueError(f"PDF page {page.number + 1}: expected one {label!r} anchor")
    return hits[0]


def recap(page, pdf):
    words = page.get_text("words")
    y = anchor(page, "(2-3)").y0
    cols = (49, 88, 127, 165, 203, 241)

    def cells(top, bottom):
        return [
            w for w in sorted(words, key=lambda w: w[0])
            if 33 < w[0] < 258 and top < w[1] - y < bottom
        ]

    labels = cells(12, 22)
    values = cells(36, 53)
    if (
        [w[4] for w in labels] != list("123456")
        or len(values) != len(cols)
        or any(abs((w[0] + w[2]) / 2 - x) > 5 for w, x in zip(values, cols))
        or max(w[1] for w in values) - min(w[1] for w in values) > 2
        or any(not re.fullmatch(r"[0-9]+(?:[.,][0-9]{3})*", w[4]) for w in values)
    ):
        raise ValueError(f"PDF page {page.number + 1}: recap columns not recognized")
    quota, total, present, absent, year_2023, year_2024 = (
        int(re.sub(r"[.,]", "", w[4])) for w in values
    )
    if quota != pdf["jumlah_formasi"] or not total == present + absent == year_2023 + year_2024:
        raise ValueError(f"PDF page {page.number + 1}: recap counts do not reconcile")

    for label, expected in (
        ("Instansi", norm(pdf["nama_instansi"])),
        ("Jabatan Formasi", job_label(pdf["jabatan"])),
        ("Lokasi Formasi", norm(pdf["lokasi_formasi"])),
        ("Jenis Formasi", norm(pdf["jenis_formasi"])),
    ):
        label_y = anchor(page, label).y0
        actual = norm(" ".join(
            w[4] for w in sorted(words, key=lambda w: w[0])
            if 211 <= w[0] < 545 and abs(w[1] - label_y) < 2
        ))
        if not expected or actual != expected:
            raise ValueError(f"PDF page {page.number + 1}: {label} differs from published row")

    category_y = anchor(page, "Jenis Formasi").y0
    education = page.get_text(
        "text", clip=pymupdf.Rect(114, category_y + 12, 546, y - 40), sort=True,
    )
    education = re.sub(r"\b([DS]-)\s*\n\s*(?=[0-9IV])", r"\1", education)
    education = re.sub(r"\([0-9]+\)\s*", "", education)
    if not education_key(education) or education_key(education) != education_key(pdf["pendidikan"]):
        raise ValueError(f"PDF page {page.number + 1}: education differs from published row")
    return {
        "quota": quota, "pdf_participants": total, "pdf_present": present,
        "pdf_absent": absent, "pdf_skd_2023": year_2023, "pdf_skd_2024": year_2024,
    }


def audit(pdf_path, sqlite_path, review):
    with sqlite3.connect(sqlite_path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        source = [dict(row) for row in db.execute(
            "select formasi_id, ins_nm, jabatan_nm, lokasi_nm, pendidikan_nm, "
            "jumlah_formasi, jumlah_ms from formasi where ins_nm=?",
            (INSTITUTION,),
        )]

    candidates = defaultdict(list)
    for row in source:
        key = (
            norm(row["ins_nm"]), norm(row["jabatan_nm"]), norm(row["lokasi_nm"]),
            education_key(row["pendidikan_nm"]), row["jumlah_formasi"], row["jumlah_ms"],
        )
        candidates[key].append(row)

    formations = [row["pdf"] for row in review]
    if not formations or any(f["tahun"] != 2024 or f["nama_instansi"] != INSTITUTION for f in formations):
        raise ValueError("Expected only published 2024 Kejaksaan formations")
    pages = [f["page_number"] for f in formations]
    if any(not isinstance(n, int) or n < 1 for n in pages) or len(set(pages)) != len(pages):
        raise ValueError("PDF page references must be positive and distinct")

    proposals = []
    with pymupdf.open(pdf_path) as document:
        recap_pages = {p.number + 1 for p in document if p.search_for(TITLE)}
        if recap_pages != set(pages):
            raise ValueError("Published rows do not cover exactly the original PDF recap pages")
        for pdf in sorted(formations, key=lambda f: f["page_number"]):
            counts = recap(document[pdf["page_number"] - 1], pdf)
            key = (
                norm(pdf["nama_instansi"]), job_label(pdf["jabatan"]), norm(pdf["lokasi_formasi"]),
                education_key(pdf["pendidikan"]), counts["quota"], counts["pdf_participants"],
            )
            matches = candidates[key]
            proposals.append({
                "formation_id": pdf["id"], "pdf_page": pdf["page_number"],
                "pdf_job": pdf["jabatan"], "pdf_category": pdf["jenis_formasi"],
                "location": pdf["lokasi_formasi"], "education": pdf["pendidikan"],
                **counts,
                "candidates": [
                    {"source_id": row["formasi_id"], "source_job": row["jabatan_nm"],
                     "passed_admin": row["jumlah_ms"]} for row in matches
                ],
            })
    use = Counter(r["candidates"][0]["source_id"] for r in proposals if len(r["candidates"]) == 1)
    for row in proposals:
        matches = row["candidates"]
        if len(matches) != 1 or use[matches[0]["source_id"]] != 1:
            row["audit_status"] = "needs_review"
        else:
            row["audit_status"] = (
                "exact_with_recap" if norm(row["pdf_job"]) == norm(matches[0]["source_job"])
                else "prefix_with_recap"
            )

    with pdf_path.open("rb") as stream:
        pdf_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    return {
        "institution": INSTITUTION, "selection_year": 2024, "mode": "audit_only",
        "pdf_name": pdf_path.name, "pdf_sha256": pdf_sha256, "pdf_formations": len(proposals),
        "source_formations": len(source), "source_quota": sum(r["jumlah_formasi"] for r in source),
        "source_passed_admin": sum(r["jumlah_ms"] for r in source),
        "pdf_totals": {
            field: sum(row[field] for row in proposals)
            for field in ("quota", "pdf_participants", "pdf_present", "pdf_absent", "pdf_skd_2023", "pdf_skd_2024")
        },
        "status_counts": dict(Counter(row["audit_status"] for row in proposals)),
        "unique_proposed_source_ids": sum(count == 1 for count in use.values()),
        "rows": proposals,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--review", default="data/staging/sscasn/preview.json",
                        help="JSON with review rows, or - for authenticated admin JSON on stdin")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = json.load(sys.stdin) if args.review == "-" else json.loads(
        Path(args.review).read_text(encoding="utf-8")
    )
    report = audit(args.pdf, args.sqlite, payload["review"])
    args.output.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
