from __future__ import annotations

import json
import re
from typing import Any

from .models import ParseResult, RuntimeConfig, SignalAction, TradingSignal


def parse_signal(text: str, config: RuntimeConfig) -> ParseResult:
    raw_text = text.strip()
    if not raw_text:
        return ParseResult(ok=False, reason="消息为空")

    json_result = _parse_json_signal(raw_text, config)
    if json_result.ok or json_result.reason != "not-json":
        return json_result

    upper = raw_text.upper()
    symbol = _detect_symbol(upper, config.defaultQuote)
    if not symbol:
        return ParseResult(ok=False, reason="未识别交易对")

    action = _detect_action(upper)
    if not action:
        return ParseResult(ok=False, reason="未识别方向，需要 LONG/SHORT/BUY/SELL/CLOSE 等关键词")

    entry_price = _detect_number_after(raw_text, r"(ENTRY|ENTRIES|ENTER|PRICE|入场|进场|开仓|挂单|@\s*)\s*[:：=#-]?\s*")
    stop_loss = _detect_number_after(raw_text, r"(SL|STOP\s*LOSS|STOPLOSS|止损)\s*[:：=#-]?\s*")
    take_profits = _detect_all_numbers_after(raw_text, r"(TP\d*|TAKE\s*PROFIT|TAKEPROFIT|止盈)\s*[:：=#-]?\s*")
    explicit_market = bool(re.search(r"\b(MARKET|MKT)\b|市价", raw_text, re.I))
    explicit_limit = bool(re.search(r"\bLIMIT\b|限价|挂单", raw_text, re.I))
    order_type = "market" if explicit_market or (not explicit_limit and (not entry_price or not config.useSignalEntryAsLimit)) else "limit"
    size = _detect_size(raw_text) or config.defaultOrderSize
    warnings: list[str] = []

    if not size:
        return ParseResult(ok=False, reason="未识别数量，且未配置默认下单数量")
    if not _is_positive_number(size):
        return ParseResult(ok=False, reason="下单数量不是有效正数")
    if order_type == "limit" and not entry_price:
        return ParseResult(ok=False, reason="限价单缺少入场价")
    if config.requireStopLoss and not stop_loss and action in {"long", "short"}:
        return ParseResult(ok=False, reason="当前配置要求信号必须包含止损")
    if not stop_loss and action in {"long", "short"}:
        warnings.append("信号未包含止损")

    signal = TradingSignal(
        rawText=raw_text,
        symbol=symbol,
        action=action,
        orderType=order_type,  # type: ignore[arg-type]
        size=size,
        entryPrice=entry_price,
        stopLoss=stop_loss,
        takeProfits=take_profits,
        warnings=warnings,
    )
    return ParseResult(ok=True, signal=signal, warnings=warnings)


def _parse_json_signal(raw_text: str, config: RuntimeConfig) -> ParseResult:
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError:
        return ParseResult(ok=False, reason="not-json")

    if not isinstance(data, dict):
        return ParseResult(ok=False, reason="JSON 信号必须是对象")

    symbol = _normalize_symbol(str(data.get("symbol") or ""), config.defaultQuote)
    if not symbol:
        return ParseResult(ok=False, reason="JSON 信号缺少 symbol")

    action = _detect_action(str(data.get("action") or data.get("side") or "").upper())
    if not action:
        return ParseResult(ok=False, reason="JSON 信号缺少有效方向")

    size = str(data.get("size") or data.get("qty") or data.get("amount") or config.defaultOrderSize or "").strip()
    if not size or not _is_positive_number(size):
        return ParseResult(ok=False, reason="JSON 信号缺少有效数量")

    entry_price = _positive_string(data.get("entry") or data.get("price"))
    stop_loss = _positive_string(data.get("stopLoss") or data.get("sl"))
    take_profits = _normalize_take_profits(data.get("takeProfit") or data.get("tp"))
    requested_type = str(data.get("orderType") or "").lower()
    order_type = "market" if requested_type == "market" or (not entry_price and requested_type != "limit") else "limit"

    if order_type == "limit" and not entry_price:
        return ParseResult(ok=False, reason="JSON 限价信号缺少 entry/price")
    if config.requireStopLoss and not stop_loss and action in {"long", "short"}:
        return ParseResult(ok=False, reason="当前配置要求信号必须包含止损")

    warnings = ["信号未包含止损"] if not stop_loss and action in {"long", "short"} else []
    return ParseResult(
        ok=True,
        signal=TradingSignal(
            rawText=raw_text,
            symbol=symbol,
            action=action,
            orderType=order_type,  # type: ignore[arg-type]
            size=size,
            entryPrice=entry_price,
            stopLoss=stop_loss,
            takeProfits=take_profits,
            warnings=warnings,
        ),
        warnings=warnings,
    )


def _detect_symbol(upper_text: str, default_quote: str) -> str:
    normalized = re.sub(r"[\u200B-\u200D\uFEFF]", "", upper_text)
    match = re.search(r"\b([A-Z]{2,15})\s*[\/_-]?\s*(USDT|USDC|USD)\b", normalized)
    if match:
        return f"{match.group(1)}{match.group(2)}"

    tagged = re.search(r"#([A-Z]{2,15})\b", normalized)
    if tagged:
        return f"{tagged.group(1)}{default_quote}"
    return ""


def _normalize_symbol(value: str, default_quote: str) -> str:
    clean = re.sub(r"[^A-Z0-9]", "", value.upper())
    if not clean:
        return ""
    return clean if re.search(r"(USDT|USDC|USD)$", clean) else f"{clean}{default_quote}"


def _detect_action(upper_text: str) -> SignalAction | None:
    close_long = r"(CLOSE|平仓|平多|止盈|退出).*(LONG|BUY|多)|((LONG|BUY|多).*(CLOSE|平仓|退出))"
    close_short = r"(CLOSE|平仓|平空|止盈|退出).*(SHORT|SELL|空)|((SHORT|SELL|空).*(CLOSE|平仓|退出))"
    if re.search(close_long, upper_text, re.I):
        return "close_long"
    if re.search(close_short, upper_text, re.I):
        return "close_short"
    if re.search(r"\b(LONG|BUY)\b|做多|看多|开多|多单", upper_text, re.I):
        return "long"
    if re.search(r"\b(SHORT|SELL)\b|做空|看空|开空|空单", upper_text, re.I):
        return "short"
    return None


def _detect_size(text: str) -> str | None:
    return _detect_number_after(text, r"(SIZE|QTY|QUANTITY|AMOUNT|VOL|VOLUME|数量|张数|仓位|下单)\s*[:：=#-]?\s*")


def _detect_number_after(text: str, marker: str) -> str | None:
    match = re.search(marker + r"([0-9]+(?:\.[0-9]+)?)", text, re.I)
    return match.group(match.lastindex or 1) if match else None


def _detect_all_numbers_after(text: str, marker: str) -> list[str]:
    values: list[str] = []
    for match in re.finditer(marker + r"([0-9]+(?:\.[0-9]+)?)", text, re.I):
        value = match.group(match.lastindex or 1)
        if value not in values:
            values.append(value)
    return values


def _positive_string(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text if _is_positive_number(text) else None


def _normalize_take_profits(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item for item in (_positive_string(item) for item in value) if item]
    single = _positive_string(value)
    return [single] if single else []


def _is_positive_number(value: str) -> bool:
    try:
        return float(value) > 0
    except ValueError:
        return False
