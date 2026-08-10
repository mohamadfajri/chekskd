"""Hermes plugin for fetching one SKD result card by short-lived token."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

TOKEN_RE = re.compile(r"^RSKD-[A-HJ-NP-Z2-9]{5,8}$")
MESSAGE_RE = re.compile(r"^\s*CEK\s+(RSKD-[A-HJ-NP-Z2-9]{5,8})\s*$", re.IGNORECASE)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
WORKER_ID = "hermes-cpnsguru-v1"
logger = logging.getLogger(__name__)
_worker_task: asyncio.Task | None = None


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


def _api_request(path: str, payload: dict) -> dict:
    app_url = os.environ.get("SKD_APP_URL", "").strip().rstrip("/")
    secret = os.environ.get("HERMES_API_SECRET", "").strip()
    parsed_app = urlparse(app_url)
    if parsed_app.scheme != "https" or not parsed_app.netloc or not secret:
        return {"success": False, "message": "Integrasi hasil SKD belum dikonfigurasi."}

    request = Request(
        f"{app_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "User-Agent": "cpnsguru-hermes/2.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read(256 * 1024).decode("utf-8"))
    except HTTPError as exc:
        try:
            return json.loads(exc.read(32 * 1024).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {"success": False, "message": "Layanan hasil SKD belum dapat memproses kode."}
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
        return {"success": False, "message": "Layanan hasil SKD sedang tidak dapat dihubungi."}


def _sender_number(event) -> str:
    source = getattr(event, "source", None)
    raw_ids = [
        getattr(event, "user_id", None),
        getattr(source, "user_id", None),
        getattr(source, "chat_id", None),
    ]
    try:
        from gateway.whatsapp_identity import (
            expand_whatsapp_aliases,
            normalize_whatsapp_identifier,
        )

        aliases = set()
        explicit_phone_ids = []
        for raw_id in raw_ids:
            value = str(raw_id or "")
            normalized = normalize_whatsapp_identifier(value)
            if value.endswith("@s.whatsapp.net") and normalized.isdigit():
                explicit_phone_ids.append(normalized)
            aliases.update(expand_whatsapp_aliases(value))

        candidates = explicit_phone_ids + sorted(
            (alias for alias in aliases if alias.isdigit()),
            key=lambda alias: (not alias.startswith("62"), len(alias), alias),
        )
        return next((value for value in candidates if 8 <= len(value) <= 20), "")
    except Exception:
        for raw_id in raw_ids:
            digits = re.sub(r"\D", "", str(raw_id or "").split("@", 1)[0])
            if 8 <= len(digits) <= 20:
                return digits
    return ""


async def _mark_delivered(session_id: str) -> None:
    await asyncio.to_thread(
        _api_request,
        "/api/wa-jobs",
        {"action": "mark_delivered", "session_id": session_id},
    )


async def _send_job(adapter, job: dict) -> None:
    result = await adapter.send_image(
        chat_id=str(job.get("sender") or ""),
        image_url=str(job.get("image_url") or ""),
        caption=str(job.get("caption") or "Hasil rasionalisasi SKD sudah siap."),
    )
    if result.success and job.get("session_id"):
        await _mark_delivered(str(job["session_id"]))
    elif not result.success:
        logger.error("SKD result delivery failed: %s", result.error)


async def _worker_loop(adapter) -> None:
    empty_rounds = 0
    failures = 0
    while empty_rounds < 3 and failures < 5:
        payload = await asyncio.to_thread(
            _api_request,
            "/api/wa-jobs",
            {"action": "process_next", "worker_id": WORKER_ID},
        )
        if payload.get("success") is not True:
            failures += 1
            await asyncio.sleep(min(failures * 2, 10))
            continue

        failures = 0
        job = payload.get("job")
        if not isinstance(job, dict):
            empty_rounds += 1
            await asyncio.sleep(2)
            continue

        empty_rounds = 0
        await _send_job(adapter, job)


def _ensure_worker(adapter) -> None:
    global _worker_task
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(_worker_loop(adapter))


async def _handle_code(event, gateway, token: str) -> None:
    source = getattr(event, "source", None)
    adapter = gateway.adapters.get(getattr(source, "platform", None))
    chat_id = str(getattr(source, "chat_id", "") or "")
    sender = _sender_number(event)
    message_id = str(getattr(event, "message_id", "") or "")
    if not adapter or not chat_id:
        return
    if not sender or not message_id:
        await adapter.send(
            chat_id,
            "Identitas pesan WhatsApp belum dapat dibaca. Silakan kirim ulang kode beberapa saat lagi.",
        )
        return

    payload = await asyncio.to_thread(
        _api_request,
        "/api/wa-result",
        {"token": token, "sender": sender, "message_id": message_id},
    )
    if payload.get("success") is not True:
        await adapter.send(
            chat_id,
            str(payload.get("message") or "Kode hasil belum dapat diproses."),
            reply_to=message_id,
        )
        return

    if payload.get("reply_type") == "image":
        result = await adapter.send_image(
            chat_id=chat_id,
            image_url=str(payload.get("image_url") or ""),
            caption=str(payload.get("caption") or "Hasil rasionalisasi SKD sudah siap."),
            reply_to=message_id,
        )
        if result.success and payload.get("session_id"):
            await _mark_delivered(str(payload["session_id"]))
        return

    if payload.get("is_new_message") is not False:
        await adapter.send(
            chat_id,
            str(
                payload.get("message")
                or "Data kamu sudah diterima. Hasil akan dikirim maksimal 10 menit."
            ),
            reply_to=message_id,
        )
    _ensure_worker(adapter)


def _pre_gateway_dispatch(*, event, gateway, **kwargs):
    del kwargs
    source = getattr(event, "source", None)
    platform = getattr(getattr(source, "platform", None), "value", "")
    if platform != "whatsapp":
        return None

    match = MESSAGE_RE.fullmatch(str(getattr(event, "text", "") or ""))
    if not match:
        return None

    task = asyncio.create_task(_handle_code(event, gateway, match.group(1).upper()))
    task.add_done_callback(
        lambda finished: logger.error(
            "SKD direct handler failed", exc_info=finished.exception()
        )
        if not finished.cancelled() and finished.exception()
        else None
    )
    return {"action": "skip", "reason": "skd_result_direct_handler"}


def register(ctx):
    ctx.register_hook("pre_gateway_dispatch", _pre_gateway_dispatch)

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
