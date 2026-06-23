from __future__ import annotations

import queue
import random
import string
import threading
import time
from datetime import datetime, timezone
from typing import Any

from .models import AppEvent, LogLevel


class EventLog:
    def __init__(self, max_events: int = 500) -> None:
        self._max_events = max_events
        self._events: list[AppEvent] = []
        self._subscribers: list[queue.Queue[AppEvent]] = []
        self._lock = threading.RLock()

    def append(self, level: LogLevel, source: str, message: str, data: Any | None = None) -> AppEvent:
        event = AppEvent(
            id=f"{int(time.time() * 1000)}-{_random_id()}",
            time=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            level=level,
            source=source,
            message=message,
            data=data,
        )
        with self._lock:
            self._events = [event, *self._events][: self._max_events]
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            try:
                subscriber.put_nowait(event)
            except queue.Full:
                pass
        return event

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, self._max_events))
        with self._lock:
            return [event.to_dict() for event in self._events[:limit]]

    def subscribe(self) -> queue.Queue[AppEvent]:
        subscriber: queue.Queue[AppEvent] = queue.Queue(maxsize=100)
        with self._lock:
            self._subscribers.append(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: queue.Queue[AppEvent]) -> None:
        with self._lock:
            if subscriber in self._subscribers:
                self._subscribers.remove(subscriber)


def _random_id() -> str:
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
