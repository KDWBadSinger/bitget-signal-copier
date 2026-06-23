from __future__ import annotations

import json
import re
from dataclasses import fields
from pathlib import Path
from typing import Any

from .models import EnvConfig, MarginMode, OrderForce, PositionMode, RuntimeConfig


RUNTIME_DIR = Path(".runtime")
CONFIG_PATH = RUNTIME_DIR / "config.json"


def default_runtime_config(env: EnvConfig) -> RuntimeConfig:
    return RuntimeConfig(
        autoTradingEnabled=env.auto_trading_enabled_default,
        dryRun=env.dry_run_default,
        useDemoTrading=env.use_demo_trading_default,
        defaultOrderSize=env.default_order_size,
        defaultQuote=env.default_quote,
        maxNotionalUsdt=env.max_notional_usdt,
    )


class ConfigStore:
    def __init__(self, env: EnvConfig) -> None:
        self._config = default_runtime_config(env)

    def load(self) -> RuntimeConfig:
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            self._config = normalize_config({**self._config.to_dict(), **data})
        except FileNotFoundError:
            self.save()
        except (json.JSONDecodeError, TypeError, ValueError):
            self.save()
        return self._config

    def get(self) -> RuntimeConfig:
        return self._config

    def update(self, patch: dict[str, Any]) -> RuntimeConfig:
        allowed = {field.name for field in fields(RuntimeConfig)}
        merged = self._config.to_dict()
        for key, value in patch.items():
            if key in allowed:
                merged[key] = value
        self._config = normalize_config(merged)
        self.save()
        return self._config

    def save(self) -> None:
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(
            json.dumps(self._config.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )


def normalize_config(data: dict[str, Any]) -> RuntimeConfig:
    margin_mode: MarginMode = "crossed" if data.get("marginMode") == "crossed" else "isolated"
    position_mode: PositionMode = "hedge" if data.get("positionMode") == "hedge" else "one-way"
    order_force: OrderForce = data.get("orderForce") if data.get("orderForce") in _order_forces() else "gtc"

    return RuntimeConfig(
        autoTradingEnabled=bool(data.get("autoTradingEnabled")),
        dryRun=bool(data.get("dryRun", True)),
        useDemoTrading=bool(data.get("useDemoTrading")),
        productType=str(data.get("productType") or "USDT-FUTURES").upper(),
        marginMode=margin_mode,
        marginCoin=str(data.get("marginCoin") or "USDT").upper(),
        positionMode=position_mode,
        defaultOrderSize=str(data.get("defaultOrderSize") or "").strip(),
        defaultQuote=str(data.get("defaultQuote") or "USDT").upper(),
        allowedSymbols=normalize_symbols(data.get("allowedSymbols")),
        maxNotionalUsdt=nullable_float(data.get("maxNotionalUsdt")),
        requireStopLoss=bool(data.get("requireStopLoss")),
        useSignalEntryAsLimit=bool(data.get("useSignalEntryAsLimit", True)),
        orderForce=order_force,
        duplicateWindowSec=clamp_int(data.get("duplicateWindowSec"), 10, 3600, 120),
    )


def normalize_symbols(value: Any) -> list[str]:
    if isinstance(value, str):
        source = value.split(",")
    elif isinstance(value, list):
        source = value
    else:
        return []

    symbols: list[str] = []
    for item in source:
        symbol = re.sub(r"[^A-Z0-9]", "", str(item).upper())
        if symbol and symbol not in symbols:
            symbols.append(symbol)
    return symbols


def nullable_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
        return parsed if parsed == parsed else None
    except (TypeError, ValueError):
        return None


def clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def _order_forces() -> set[str]:
    return {"gtc", "ioc", "fok", "post_only"}
