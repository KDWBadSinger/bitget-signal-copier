from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from .event_log import EventLog
from .models import SignalContext
from .trading_service import TradingService


class TelegramService:
    def __init__(
        self,
        token: str | None,
        allowed_chat_ids: list[str],
        trading_service: TradingService,
        event_log: EventLog,
    ) -> None:
        self._token = token
        self._allowed_chat_ids = allowed_chat_ids
        self._trading_service = trading_service
        self._event_log = event_log
        self._running = False
        self._offset = 0
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._running:
            return
        if not self._token:
            self._event_log.append("warning", "telegram", "TELEGRAM_BOT_TOKEN 未配置，监听未启动")
            return

        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._poll_loop, name="telegram-poller", daemon=True)
        self._thread.start()
        self._event_log.append("success", "telegram", "Telegram 长轮询已启动")

    def stop(self) -> None:
        self._running = False
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        self._thread = None
        self._event_log.append("info", "telegram", "Telegram 长轮询已停止")

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "tokenConfigured": bool(self._token),
            "allowedChatIds": self._allowed_chat_ids,
            "offset": self._offset,
        }

    def handle_webhook_update(self, update: dict[str, Any]) -> None:
        self._process_update(update)

    def _poll_loop(self) -> None:
        while self._running and not self._stop_event.is_set():
            try:
                updates = self._call(
                    "getUpdates",
                    {
                        "offset": self._offset or None,
                        "timeout": 30,
                        "allowed_updates": ["message", "edited_message", "channel_post", "edited_channel_post"],
                    },
                    timeout=40,
                )
                for update in updates:
                    self._offset = int(update.get("update_id", self._offset)) + 1
                    self._process_update(update)
            except Exception as error:  # noqa: BLE001 - service loop must keep running
                self._event_log.append("error", "telegram", f"Telegram 监听异常：{error}")
                time.sleep(3)

    def _process_update(self, update: dict[str, Any]) -> None:
        message = (
            update.get("message")
            or update.get("edited_message")
            or update.get("channel_post")
            or update.get("edited_channel_post")
        )
        if not isinstance(message, dict):
            return

        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        chat_id = str(chat.get("id", ""))
        if self._allowed_chat_ids and chat_id not in self._allowed_chat_ids:
            self._event_log.append(
                "warning",
                "telegram",
                "未授权 chat 的消息已忽略",
                {"chatId": chat_id, "title": chat.get("title"), "username": chat.get("username")},
            )
            return

        text = str(message.get("text") or message.get("caption") or "").strip()
        if not text:
            return

        message_id = int(message.get("message_id", 0))
        self._event_log.append(
            "info",
            "telegram",
            "收到 Telegram 信号",
            {"chatId": chat_id, "messageId": message_id, "text": text},
        )

        try:
            self._trading_service.handle_signal_text(
                text,
                SignalContext(
                    source="telegram",
                    chat_id=chat_id,
                    message_id=message_id,
                    update_id=int(update.get("update_id", 0)),
                ),
            )
        except Exception as error:  # noqa: BLE001
            self._event_log.append(
                "error",
                "trading",
                f"处理 Telegram 信号失败：{error}",
                {"chatId": chat_id, "messageId": message_id},
            )

    def _call(self, method: str, payload: dict[str, Any], timeout: int = 20) -> Any:
        if not self._token:
            raise RuntimeError("Telegram Bot Token 未配置")

        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{self._token}/{method}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                parsed = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Telegram HTTP {error.code}: {body}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Telegram 网络请求失败：{error.reason}") from error

        if not parsed.get("ok"):
            raise RuntimeError(parsed.get("description") or "Telegram API 返回失败")
        return parsed.get("result")
