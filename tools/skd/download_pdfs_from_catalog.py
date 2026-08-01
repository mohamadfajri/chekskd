from __future__ import annotations

import argparse
import csv
import html
import re
import time
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener


DRIVE_ID_RE = re.compile(r"(?:/file/d/|[?&]id=)([A-Za-z0-9_-]+)")
CONFIRM_HREF_RE = re.compile(r'href="([^"]*(?:confirm=|download_warning)[^"]*)"', re.I)
FORM_ACTION_RE = re.compile(r'<form[^>]+action="([^"]+)"', re.I)
INPUT_RE = re.compile(r"<input[^>]+>", re.I)
ATTR_RE = re.compile(r'([a-zA-Z_-]+)="([^"]*)"')


def slugify(value: str, fallback: str = "source") -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip()).strip("-._")
    return slug[:120] or fallback


def extract_drive_file_id(row: dict[str, str]) -> str:
    if row.get("drive_file_id"):
        return row["drive_file_id"].strip()
    match = DRIVE_ID_RE.search(row.get("drive_url", ""))
    return match.group(1) if match else ""


def output_path_for(row: dict[str, str], out_dir: Path) -> Path:
    sheet_row = slugify(row.get("sheet_row", ""), "row")
    pdf_name = row.get("pdf_name", "").strip() or row.get("entity_name", "").strip()
    name = slugify(pdf_name, "source.pdf")
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return out_dir / f"{sheet_row}-{name}"


def request_bytes(opener, url: str, timeout: int) -> tuple[bytes, str]:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; chekskd-data-import/1.0)",
        },
    )
    with opener.open(request, timeout=timeout) as response:
        return response.read(), response.geturl()


def confirm_url_from_cookies(cookie_jar: CookieJar, file_id: str) -> str | None:
    for cookie in cookie_jar:
        if cookie.name.startswith("download_warning"):
            return (
                "https://drive.google.com/uc?"
                f"export=download&confirm={quote(cookie.value)}&id={quote(file_id)}"
            )
    return None


def confirm_url_from_html(data: bytes) -> str | None:
    text = data.decode("utf-8", errors="ignore")
    form_match = FORM_ACTION_RE.search(text)
    if form_match:
        params: dict[str, str] = {}
        for input_match in INPUT_RE.finditer(text):
            attrs = {
                key.lower(): html.unescape(value)
                for key, value in ATTR_RE.findall(input_match.group(0))
            }
            name = attrs.get("name")
            if name:
                params[name] = attrs.get("value", "")
        if {"id", "export", "confirm"}.issubset(params):
            action = html.unescape(form_match.group(1))
            return f"{action}?{urlencode(params)}"

    match = CONFIRM_HREF_RE.search(text)
    if not match:
        return None
    href = html.unescape(match.group(1)).replace("&amp;", "&")
    return urljoin("https://drive.google.com", href)


def download_drive_pdf(file_id: str, timeout: int) -> bytes:
    cookie_jar = CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookie_jar))
    url = f"https://drive.google.com/uc?export=download&id={quote(file_id)}"

    data, _ = request_bytes(opener, url, timeout)
    if data.startswith(b"%PDF-"):
        return data

    confirm_url = confirm_url_from_cookies(cookie_jar, file_id) or confirm_url_from_html(data)
    if confirm_url:
        data, _ = request_bytes(opener, confirm_url, timeout)
        if data.startswith(b"%PDF-"):
            return data

    sample = data[:120].decode("utf-8", errors="ignore").replace("\n", " ").strip()
    raise RuntimeError(f"Google Drive tidak mengembalikan PDF. Awal respons: {sample}")


def read_catalog(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as file:
        return list(csv.DictReader(file))


def write_manifest(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "sheet_row",
        "entity_name",
        "pdf_name",
        "drive_file_id",
        "output_path",
        "status",
        "bytes",
        "error",
    ]
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download SKD PDFs listed in pdf_sources_catalog.csv.")
    parser.add_argument("--catalog", default="data/staging/pdf_sources_catalog.csv")
    parser.add_argument("--out-dir", default="data/raw/pdfs")
    parser.add_argument("--manifest", default="data/staging/downloaded_pdfs.csv")
    parser.add_argument("--limit", type=int, default=1, help="Jumlah PDF yang didownload. Pakai 0 untuk semua.")
    parser.add_argument("--offset", type=int, default=0, help="Lewati N baris awal katalog.")
    parser.add_argument("--row", help="Download hanya sheet_row tertentu, contoh: 11.")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--sleep", type=float, default=0.5)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    out_dir = Path(args.out_dir)
    manifest_path = Path(args.manifest)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = read_catalog(catalog_path)
    if args.row:
        rows = [row for row in rows if row.get("sheet_row") == args.row]
    else:
        rows = rows[args.offset :]
        if args.limit > 0:
            rows = rows[: args.limit]

    manifest: list[dict[str, str]] = []
    for index, row in enumerate(rows, start=1):
        file_id = extract_drive_file_id(row)
        output_path = output_path_for(row, out_dir)
        record = {
            "sheet_row": row.get("sheet_row", ""),
            "entity_name": row.get("entity_name", ""),
            "pdf_name": row.get("pdf_name", ""),
            "drive_file_id": file_id,
            "output_path": str(output_path),
            "status": "",
            "bytes": "0",
            "error": "",
        }

        print(f"[{index}/{len(rows)}] {record['sheet_row']} {record['pdf_name']}")
        try:
            if not file_id:
                raise RuntimeError("drive_file_id kosong")
            if output_path.exists() and not args.overwrite:
                record["status"] = "skipped_exists"
                record["bytes"] = str(output_path.stat().st_size)
            else:
                data = download_drive_pdf(file_id, args.timeout)
                output_path.write_bytes(data)
                record["status"] = "downloaded"
                record["bytes"] = str(len(data))
            print(f"  -> {record['status']} {record['output_path']}")
        except (HTTPError, URLError, TimeoutError, RuntimeError) as exc:
            record["status"] = "error"
            record["error"] = str(exc)
            print(f"  !! {record['error']}")

        manifest.append(record)
        write_manifest(manifest_path, manifest)
        if args.sleep > 0 and index < len(rows):
            time.sleep(args.sleep)

    print(f"Manifest -> {manifest_path}")


if __name__ == "__main__":
    main()
