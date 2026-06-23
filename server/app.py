from __future__ import annotations

import json
import mimetypes
import signal
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .bitget_client import BitgetClient
from .config_store import ConfigStore
from .env import env_status, load_env
from .event_log import EventLog
from .models import SignalContext
from .telegram_service import TelegramService
from .trading_service import TradingService


ROOT_DIR = Path(__file__).resolve().parents[1]
CLIENT_DIST = ROOT_DIR / "dist" / "client"


class AppContext:
    def __init__(self) -> None:
        self.env = load_env()
        self.event_log = EventLog()
        self.config_store = ConfigStore(self.env)
        self.config_store.load()
        self.bitget_client = BitgetClient(self.env)
        self.trading_service = TradingService(self.config_store, self.bitget_client, self.event_log)
        self.telegram_service = TelegramService(
            self.env.telegram_bot_token,
            self.env.telegram_allowed_chat_ids,
            self.trading_service,
            self.event_log,
        )


context = AppContext()


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "BitgetSignalCopier/0.1"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            query = urllib.parse.parse_qs(parsed.query)

            if path == "/api/health":
                self._json({"ok": True, "time": _now_ms()})
            elif path == "/api/status":
                self._json(
                    {
                        "env": env_status(context.env),
                        "config": context.config_store.get().to_dict(),
                        "telegram": context.telegram_service.status(),
                        "events": context.event_log.list(20),
                    }
                )
            elif path == "/api/events":
                limit = _safe_int((query.get("limit") or ["100"])[0], 100)
                self._json({"events": context.event_log.list(limit)})
            elif path == "/api/events/stream":
                self._event_stream()
            elif path == "/api/config":
                self._json({"config": context.config_store.get().to_dict(), "env": env_status(context.env)})
            else:
                self._static(path)
        except Exception as error:  # noqa: BLE001
            self._error(error)

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urllib.parse.urlparse(self.path).path
            payload = self._read_json()

            if path == "/api/test-signal":
                text = payload.get("text") if isinstance(payload.get("text"), str) else ""
                execution = context.trading_service.handle_signal_text(text, SignalContext(source="manual"))
                self._json({"execution": execution, "events": context.event_log.list(10)})
            elif path == "/api/telegram/start":
                context.telegram_service.start()
                self._json({"telegram": context.telegram_service.status()})
            elif path == "/api/telegram/stop":
                context.telegram_service.stop()
                self._json({"telegram": context.telegram_service.status()})
            elif path.startswith("/api/telegram/webhook/"):
                self._telegram_webhook(path, payload)
            else:
                self._json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
        except Exception as error:  # noqa: BLE001
            self._error(error)

    def do_PUT(self) -> None:  # noqa: N802
        try:
            path = urllib.parse.urlparse(self.path).path
            payload = self._read_json()
            if path != "/api/config":
                self._json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
                return

            config = context.config_store.update(payload)
            context.event_log.append("success", "config", "运行配置已保存")
            self._json({"config": config.to_dict()})
        except Exception as error:  # noqa: BLE001
            self._error(error)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _telegram_webhook(self, path: str, payload: dict[str, Any]) -> None:
        path_secret = path.removeprefix("/api/telegram/webhook/")
        header_secret = self.headers.get("X-Telegram-Bot-Api-Secret-Token")
        expected = context.env.telegram_webhook_secret
        if not expected or (path_secret != expected and header_secret != expected):
            self._json({"error": "Forbidden"}, status=HTTPStatus.FORBIDDEN)
            return
        context.telegram_service.handle_webhook_update(payload)
        self._json({"ok": True})

    def _event_stream(self) -> None:
        self.send_response(HTTPStatus.OK)
        self._send_common_headers(content_type="text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        subscriber = context.event_log.subscribe()
        try:
            for event in reversed(context.event_log.list(20)):
                self._write_sse(event)
            while True:
                try:
                    event = subscriber.get(timeout=20)
                    self._write_sse(event.to_dict())
                except Exception:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        finally:
            context.event_log.unsubscribe(subscriber)

    def _static(self, path: str) -> None:
        if not CLIENT_DIST.exists():
            self._json({"error": "Client build not found. Run pnpm build first."}, status=HTTPStatus.NOT_FOUND)
            return

        clean_path = urllib.parse.unquote(path.lstrip("/"))
        requested = (CLIENT_DIST / clean_path).resolve()
        if not str(requested).startswith(str(CLIENT_DIST.resolve())):
            self._json({"error": "Forbidden"}, status=HTTPStatus.FORBIDDEN)
            return
        if requested.is_dir() or not requested.exists():
            requested = CLIENT_DIST / "index.html"

        content_type = mimetypes.guess_type(str(requested))[0] or "application/octet-stream"
        data = requested.read_bytes()
        self.send_response(HTTPStatus.OK)
        self._send_common_headers(content_type=content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self._send_common_headers()
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, error: Exception) -> None:
        message = str(error)
        context.event_log.append("error", "server", message)
        self._json({"error": message}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def _read_json(self) -> dict[str, Any]:
        length = _safe_int(self.headers.get("Content-Length"), 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw:
            return {}
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}

    def _send_common_headers(self, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Telegram-Bot-Api-Secret-Token")

    def _write_sse(self, event: dict[str, Any]) -> None:
        data = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.wfile.write(b"data: " + data + b"\n\n")
        self.wfile.flush()


def main() -> None:
    if context.env.telegram_polling_enabled:
        context.telegram_service.start()

    httpd = ThreadingHTTPServer(("0.0.0.0", context.env.port), RequestHandler)
    shutdown = threading.Event()

    def stop(_signum: int, _frame: Any) -> None:
        shutdown.set()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    context.event_log.append("success", "server", f"服务已启动：http://localhost:{context.env.port}")
    try:
        httpd.serve_forever()
    finally:
        context.telegram_service.stop()
        httpd.server_close()
        if not shutdown.is_set():
            time.sleep(0.1)


def _safe_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _now_ms() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    main()
