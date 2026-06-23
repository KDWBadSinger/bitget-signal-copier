from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


LogLevel = Literal["info", "success", "warning", "error"]
PositionMode = Literal["one-way", "hedge"]
MarginMode = Literal["isolated", "crossed"]
OrderForce = Literal["gtc", "ioc", "fok", "post_only"]
SignalAction = Literal["long", "short", "close_long", "close_short"]
ParsedOrderType = Literal["market", "limit"]


@dataclass
class AppEvent:
    id: str
    time: str
    level: LogLevel
    source: str
    message: str
    data: Any | None = None

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        if self.data is None:
            result.pop("data", None)
        return result


@dataclass
class EnvConfig:
    port: int = 3000
    telegram_bot_token: str | None = None
    telegram_allowed_chat_ids: list[str] = field(default_factory=list)
    telegram_polling_enabled: bool = True
    telegram_webhook_secret: str | None = None
    bitget_api_key: str | None = None
    bitget_api_secret: str | None = None
    bitget_api_passphrase: str | None = None
    bitget_base_url: str = "https://api.bitget.com"
    dry_run_default: bool = True
    use_demo_trading_default: bool = False
    auto_trading_enabled_default: bool = False
    default_order_size: str = ""
    default_quote: str = "USDT"
    max_notional_usdt: float | None = None


@dataclass
class RuntimeConfig:
    autoTradingEnabled: bool = False
    dryRun: bool = True
    useDemoTrading: bool = False
    productType: str = "USDT-FUTURES"
    marginMode: MarginMode = "isolated"
    marginCoin: str = "USDT"
    positionMode: PositionMode = "one-way"
    defaultOrderSize: str = ""
    defaultQuote: str = "USDT"
    allowedSymbols: list[str] = field(default_factory=list)
    maxNotionalUsdt: float | None = None
    requireStopLoss: bool = False
    useSignalEntryAsLimit: bool = True
    orderForce: OrderForce = "gtc"
    duplicateWindowSec: int = 120

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TradingSignal:
    rawText: str
    symbol: str
    action: SignalAction
    orderType: ParsedOrderType
    size: str
    entryPrice: str | None = None
    stopLoss: str | None = None
    takeProfits: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        return {key: value for key, value in result.items() if value not in (None, [])}


@dataclass
class ParseResult:
    ok: bool
    signal: TradingSignal | None = None
    reason: str | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class SignalContext:
    source: Literal["telegram", "manual", "webhook"]
    chat_id: str | None = None
    message_id: int | None = None
    update_id: int | None = None


BitgetPlaceOrderRequest = dict[str, Any]
OrderExecution = dict[str, Any]
