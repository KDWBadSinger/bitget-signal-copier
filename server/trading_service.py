from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any

from .bitget_client import BitgetClient
from .config_store import ConfigStore
from .event_log import EventLog
from .models import BitgetPlaceOrderRequest, RuntimeConfig, SignalAction, SignalContext, TradingSignal
from .signal_parser import parse_signal


class TradingService:
    def __init__(self, config_store: ConfigStore, bitget_client: BitgetClient, event_log: EventLog) -> None:
        self._config_store = config_store
        self._bitget_client = bitget_client
        self._event_log = event_log
        self._recent_signals: dict[str, float] = {}

    def handle_signal_text(self, text: str, context: SignalContext) -> dict[str, Any] | None:
        config = self._config_store.get()
        fingerprint = self._fingerprint(text, context)

        if self._is_duplicate(fingerprint, config.duplicateWindowSec):
            self._event_log.append(
                "warning",
                context.source,
                "重复信号已跳过",
                {"chatId": context.chat_id, "messageId": context.message_id},
            )
            return None

        parsed = parse_signal(text, config)
        if not parsed.ok or not parsed.signal:
            self._event_log.append(
                "warning",
                context.source,
                f"信号解析失败：{parsed.reason or '未知原因'}",
                {"text": text},
            )
            return None

        self._mark_seen(fingerprint)
        risk_failure = validate_risk(parsed.signal, config)
        if risk_failure:
            self._event_log.append("warning", "risk", risk_failure, parsed.signal.to_dict())
            return None

        request = build_bitget_order(parsed.signal, config)
        if not config.autoTradingEnabled:
            self._event_log.append(
                "info",
                "trading",
                "自动交易未开启，信号已解析但未下单",
                {"signal": parsed.signal.to_dict(), "request": request},
            )
            return {"mode": "dry-run", "signal": parsed.signal.to_dict(), "request": request}

        if config.dryRun:
            execution = {"mode": "dry-run", "signal": parsed.signal.to_dict(), "request": request}
            self._event_log.append("success", "dry-run", "Dry run：已生成 Bitget 下单请求", execution)
            return execution

        response = self._bitget_client.place_order(request, config)
        execution = {
            "mode": "live",
            "signal": parsed.signal.to_dict(),
            "request": request,
            "response": response,
        }
        self._event_log.append("success", "bitget", "Bitget 合约下单成功", execution)
        return execution

    def _fingerprint(self, text: str, context: SignalContext) -> str:
        if context.source == "telegram" and context.chat_id and context.message_id is not None:
            return f"telegram:{context.chat_id}:{context.message_id}"
        digest = hashlib.sha256(text.strip().encode("utf-8")).hexdigest()
        return f"{context.source}:{digest}"

    def _is_duplicate(self, fingerprint: str, duplicate_window_sec: int) -> bool:
        now = time.time()
        expired = [key for key, timestamp in self._recent_signals.items() if now - timestamp > duplicate_window_sec]
        for key in expired:
            self._recent_signals.pop(key, None)
        return fingerprint in self._recent_signals

    def _mark_seen(self, fingerprint: str) -> None:
        self._recent_signals[fingerprint] = time.time()


def validate_risk(signal: TradingSignal, config: RuntimeConfig) -> str | None:
    if config.allowedSymbols and signal.symbol not in config.allowedSymbols:
        return f"交易对 {signal.symbol} 不在允许列表"

    if config.maxNotionalUsdt and signal.entryPrice:
        notional = _to_float(signal.size) * _to_float(signal.entryPrice)
        if notional > config.maxNotionalUsdt:
            return f"信号名义价值 {notional:.2f} 超过上限 {config.maxNotionalUsdt}"

    if config.requireStopLoss and not signal.stopLoss and signal.action in {"long", "short"}:
        return "风控要求止损，但信号未包含止损"

    return None


def build_bitget_order(signal: TradingSignal, config: RuntimeConfig) -> BitgetPlaceOrderRequest:
    direction = resolve_direction(signal.action, config.positionMode)
    request: BitgetPlaceOrderRequest = {
        "symbol": signal.symbol,
        "productType": config.productType,
        "marginMode": config.marginMode,
        "marginCoin": config.marginCoin,
        "size": signal.size,
        "side": direction["side"],
        "orderType": signal.orderType,
        "clientOid": f"bsc_{int(time.time() * 1000)}_{secrets.token_hex(4)}",
    }

    if signal.orderType == "limit" and signal.entryPrice:
        request["price"] = signal.entryPrice
        request["force"] = config.orderForce
    if direction.get("tradeSide"):
        request["tradeSide"] = direction["tradeSide"]
    if direction.get("reduceOnly"):
        request["reduceOnly"] = direction["reduceOnly"]
    if signal.takeProfits and signal.action in {"long", "short"}:
        request["presetStopSurplusPrice"] = signal.takeProfits[0]
    if signal.stopLoss and signal.action in {"long", "short"}:
        request["presetStopLossPrice"] = signal.stopLoss

    return request


def resolve_direction(action: SignalAction, position_mode: str) -> dict[str, str]:
    if position_mode == "hedge":
        if action == "long":
            return {"side": "buy", "tradeSide": "open"}
        if action == "short":
            return {"side": "sell", "tradeSide": "open"}
        if action == "close_long":
            return {"side": "buy", "tradeSide": "close"}
        return {"side": "sell", "tradeSide": "close"}

    if action == "long":
        return {"side": "buy"}
    if action == "short":
        return {"side": "sell"}
    if action == "close_long":
        return {"side": "sell", "reduceOnly": "YES"}
    return {"side": "buy", "reduceOnly": "YES"}


def _to_float(value: str) -> float:
    try:
        return float(value)
    except ValueError:
        return 0.0
