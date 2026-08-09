"""Hermes plugin for fetching one SKD result card by short-lived token."""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

TOKEN_RE = re.compile(r"^RSKD-[A-HJ-NP-Z2-9]{5,8}$")
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _json_error(message: str) -> str:
    return json.dumps({"success": False, "error": message}, ensure_ascii=True)


def _cleanup_old_cards(directory: Path) -> None:
    cutoff = time.time() - 2 * 60 * 60
    for candidate in directory.glob("skd-result-*.png"):
        try:
            if candidate.stat().st_mtime < cutoff:
                candidate.unlink()
        except OSError:
            continue


def _fetch_result(token_value: str) -> str:
    token = token_value.strip().upper()
    if not TOKEN_RE.fullmatch(token):
        return _json_error("Format kode hasil tidak valid.")

    app_url = os.environ.get("SKD_APP_URL", "").strip().rstrip("/")
    parsed_app = urlparse(app_url)
    if parsed_app.scheme != "https" or not parsed_app.netloc:
        return _json_error("SKD_APP_URL belum dikonfigurasi dengan HTTPS yang valid.")

    result_url = f"{app_url}/api/wa-result?token={quote(token)}"
    try:
        request = Request(result_url, headers={"User-Agent": "cpnsguru-hermes/1.0"})
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read(MAX_IMAGE_BYTES).decode("utf-8"))
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read(8192).decode("utf-8"))
            message = payload.get("message") or payload.get("error")
        except (json.JSONDecodeError, UnicodeDecodeError):
            message = None
        return _json_error(message or "Hasil SKD belum dapat diambil.")
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
        return _json_error("Layanan hasil SKD sedang tidak dapat dihubungi.")

    if payload.get("success") is not True:
        return _json_error(payload.get("message") or "Kode hasil tidak ditemukan.")

    image_url = str(payload.get("image_url") or "")
    parsed_image = urlparse(image_url)
    if (
        parsed_image.scheme != "https"
        or parsed_image.netloc != parsed_app.netloc
        or parsed_image.path != "/api/result-card"
    ):
        return _json_error("URL kartu hasil ditolak karena tidak sesuai origin aplikasi.")

    output_dir = Path(os.environ.get("HERMES_HOME", "/opt/data")) / "generated"
    output_dir.mkdir(parents=True, exist_ok=True)
    _cleanup_old_cards(output_dir)
    output_path = output_dir / f"skd-result-{token}.png"

    try:
        image_request = Request(image_url, headers={"User-Agent": "cpnsguru-hermes/1.0"})
        with urlopen(image_request, timeout=20) as response:
            if response.headers.get_content_type() != "image/png":
                return _json_error("Kartu hasil tidak dikembalikan sebagai PNG.")
            content_length = response.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_IMAGE_BYTES:
                return _json_error("Ukuran kartu hasil melebihi batas.")
            image = response.read(MAX_IMAGE_BYTES + 1)
        if len(image) > MAX_IMAGE_BYTES or not image.startswith(b"\x89PNG\r\n\x1a\n"):
            return _json_error("Berkas kartu hasil tidak valid.")
        output_path.write_bytes(image)
        output_path.chmod(0o600)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return _json_error("Kartu hasil belum dapat diunduh.")

    return json.dumps(
        {
            "success": True,
            "caption": str(payload.get("caption") or "Kartu analisis SKD sudah siap."),
            "media_path": str(output_path),
            "expires_at": payload.get("expires_at"),
        },
        ensure_ascii=True,
    )


def register(ctx):
    schema = {
        "name": "get_skd_result_card",
        "description": "Fetch the official PNG result card for an RSKD token.",
        "parameters": {
            "type": "object",
            "properties": {
                "token": {
                    "type": "string",
                    "description": "Result token such as RSKD-ABCD2345.",
                }
            },
            "required": ["token"],
            "additionalProperties": False,
        },
    }

    def handle(params, **kwargs):
        del kwargs
        return _fetch_result(str(params.get("token", "")))

    ctx.register_tool(
        name="get_skd_result_card",
        toolset="skd_result",
        schema=schema,
        handler=handle,
        description="Fetch a short-lived SKD result card without exposing database credentials.",
    )
