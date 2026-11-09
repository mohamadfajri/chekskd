"""Read SKD recap pages with a recognized layout. Output only formation-level evidence."""

import hashlib
import json
from pathlib import Path
import re
import sys

import pymupdf


def norm(value):
    return " ".join((value or "").upper().split())


def education_key(value):
    return sorted({norm(part) for part in (value or "").split("/") if norm(part)})


# These are historical labels on the same institution's published SKD PDF.
PDF_INSTITUTION_NAMES = {
    "KEMENTERIAN KEPENDUDUKAN DAN PEMBANGUNAN KELUARGA/BKKBN":
        "BADAN KEPENDUDUKAN DAN KELUARGA BERENCANA NASIONAL",
    "KEMENTERIAN PERENCANAAN PEMBANGUNAN NASIONAL/BADAN PERENCANAAN PEMBANGUNAN NASIONAL":
        "KEMENTERIAN PERENCANAAN PEMBANGUNAN NASIONAL/BAPPENAS",
}


def anchor(page, label, left=None):
    hits = [hit for hit in page.search_for(label) if left is None or hit.x0 < left]
    if len(hits) != 1:
        raise ValueError(f"anchor {label!r} tidak unik")
    return hits[0].y0


def verify(page, row):
    if not page.search_for("REKAPITULASI HASIL SELEKSI KOMPETENSI DASAR"):
        raise ValueError("bukan halaman rekap SKD")
    y = anchor(page, "(2-3)")
    words = page.get_text("words")

    def cells(top, bottom):
        return [w for w in sorted(words, key=lambda w: w[0])
                if 33 < w[0] < 257 and top < w[1] - y < bottom]

    labels, values = cells(12, 22), cells(36, 53)
    centers = (49, 88, 126, 164, 202, 240)
    if ([w[4] for w in labels] != list("123456") or len(values) != 6
            or any(abs((w[0] + w[2]) / 2 - x) > 5 for w, x in zip(values, centers))
            or max(w[1] for w in values) - min(w[1] for w in values) > 2
            or any(not re.fullmatch(r"[0-9]+(?:[.,][0-9]{3})*", w[4]) for w in values)):
        raise ValueError("posisi kolom rekap tidak dikenali")
    quota, total, present, absent, older, current = (
        int(re.sub(r"[.,]", "", w[4])) for w in values
    )
    if quota != row["quota"] or any((total, present, absent, older, current)):
        raise ValueError("kuota atau angka nol berbeda dari rekap")

    def metadata(top, bottom):
        # Labels, codes and totals lie outside the text-value column.
        selected = sorted((w for w in words if 211 <= w[0] < 548 and top < w[1] < bottom),
                          key=lambda w: (round(w[1], 1), w[0]))
        return norm(" ".join(w[4] for w in selected))

    inst_y = anchor(page, "Instansi", 100)
    job_y = anchor(page, "Jabatan Formasi", 100)
    loc_y = anchor(page, "Lokasi Formasi", 100)
    category_y = anchor(page, "Jenis Formasi", 100)
    if not inst_y < job_y < loc_y < category_y:
        raise ValueError("urutan metadata rekap tidak dikenali")
    inst_end = (inst_y + job_y) / 2
    job_end = (job_y + loc_y) / 2
    loc_end = (loc_y + category_y) / 2
    inst = norm(row["institution"])
    expected = (
        {inst, PDF_INSTITUTION_NAMES.get(inst, inst)},
        {norm(row["job"])},
        {norm(row["location"])},
        {norm(row["category"])},
    )
    # The job row may wrap; accept only a complete match in a recognized layout.
    category = metadata(category_y - 2, category_y + 2)
    layouts = (
        (metadata(inst_y - 8, inst_end), metadata(job_y - 2, job_y + 2),
         metadata(job_y + 3, category_y - 3), category),
        (metadata(inst_y - 8, inst_end), metadata(inst_end, job_end),
         metadata(job_end, loc_end), category),
    )
    differences = [
        [label for label, actual, allowed in zip(("instansi", "jabatan", "lokasi", "kategori"), layout, expected)
         if not actual or actual not in allowed]
        for layout in layouts
    ]
    best = min(differences, key=len)
    if best:
        raise ValueError(f"{', '.join(best)} berbeda dari formasi terbit")

    education = page.get_text("text", clip=pymupdf.Rect(113, category_y + 12, 548, y - 39), sort=True)
    education = re.sub(r"\b([DS]-)\s*\n\s*(?=[0-9IV])", r"\1", education)
    education = re.sub(r"\([0-9]+\)\s*", "", education)
    if not education_key(education) or education_key(education) != education_key(row["education"]):
        raise ValueError("pendidikan berbeda dari formasi terbit")


def verify_document(source, rows):
    source = Path(source)
    with source.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    verified, unresolved = [], []
    with pymupdf.open(source) as document:
        for row in rows:
            try:
                if not 1 <= (row["page"] or 0) <= len(document):
                    raise ValueError("halaman di luar PDF sumber")
                verify(document[row["page"] - 1], row)
                verified.append(row["id"])
            except ValueError as error:
                unresolved.append({"id": row["id"], "page": row["page"], "reason": str(error)})
        return {"pdfSha256": checksum, "pages": len(document), "verified": verified,
                "unresolved": unresolved}


def main():
    payload = json.load(sys.stdin)
    if len(sys.argv) > 1:
        result = verify_document(sys.argv[1], payload)
    else:
        result = []
        for job in payload:
            try:
                proof = verify_document(job["pdf"], job["rows"])
                result.append({"sourceId": job["sourceId"], **proof})
            except (OSError, ValueError, RuntimeError) as error:
                result.append({"sourceId": job["sourceId"], "error": str(error)})
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
