"""Split an oversized source PDF into page-range parts for private Storage."""

from __future__ import annotations

import argparse
from pathlib import Path

import fitz


def split_pdf(source_path: Path, output_dir: Path, pages_per_part: int) -> list[Path]:
    if pages_per_part < 1:
        raise ValueError("pages_per_part harus lebih dari nol")

    output_dir.mkdir(parents=True, exist_ok=True)
    source = fitz.open(source_path)
    page_count = source.page_count
    source.close()
    outputs: list[Path] = []

    for first_page in range(0, page_count, pages_per_part):
        last_page = min(first_page + pages_per_part, page_count) - 1
        source = fitz.open(source_path)
        try:
            target = output_dir / (
                f"{source_path.stem}__part-{first_page + 1:05d}-{last_page + 1:05d}.pdf"
            )
            target.unlink(missing_ok=True)
            part = fitz.open()
            part.insert_pdf(source, from_page=first_page, to_page=last_page)
            part.save(target, garbage=4, deflate=True, deflate_fonts=True, use_objstms=1)
            part.close()
            outputs.append(target)
            print(
                f"{target.name}: {last_page - first_page + 1} halaman, "
                f"{target.stat().st_size / 1024 / 1024:.1f} MiB"
            )
        finally:
            source.close()

    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("tmp/storage-pdfs"))
    parser.add_argument("--pages-per-part", type=int, default=9000)
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise FileNotFoundError(f"PDF tidak ditemukan: {args.pdf}")

    split_pdf(args.pdf, args.output_dir, args.pages_per_part)


if __name__ == "__main__":
    main()
