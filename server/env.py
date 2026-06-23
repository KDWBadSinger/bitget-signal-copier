from __future__ import annotations

import os
from pathlib import Path

from .models import EnvConfig


def load_dotenv(path: Path = Path(".env")) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def bool_from_env(name: str, fallback: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return fallback
    return value.lower() in {"1", "true", "yes", "on"}


def int_from_env(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, ""))
    except ValueError:
        return fallback


def number_or_none(name: str) -> float | None:
    raw = os.environ.get(name)
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def load_env() -> EnvConfig:
    load_dotenv()
    return EnvConfig(
        port=int_from_env("PORT", 3000),
        telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN") or None,
        telegram_allowed_chat_ids=csv(os.environ.get("TELEGRAM_ALLOWED_CHAT_IDS")),
        telegram_polling_enabled=bool_from_env("TELEGRAM_POLLING_ENABLED", True),
        telegram_webhook_secret=os.environ.get("TELEGRAM_WEBHOOK_SECRET") or None,
        bitget_api_key=os.environ.get("BITGET_API_KEY") or None,
        bitget_api_secret=os.environ.get("BITGET_API_SECRET") or None,
        bitget_api_passphrase=os.environ.get("BITGET_API_PASSPHRASE") or None,
        bitget_base_url=os.environ.get("BITGET_BASE_URL") or "https://api.bitget.com",
        dry_run_default=bool_from_env("BITGET_DRY_RUN", True),
        use_demo_trading_default=bool_from_env("BITGET_DEMO_TRADING", False),
        auto_trading_enabled_default=bool_from_env("AUTO_TRADING_ENABLED", False),
        default_order_size=os.environ.get("DEFAULT_ORDER_SIZE") or "",
        default_quote=(os.environ.get("DEFAULT_QUOTE") or "USDT").upper(),
        max_notional_usdt=number_or_none("MAX_NOTIONAL_USDT"),
    )


def env_status(env: EnvConfig) -> dict[str, object]:
    return {
        "telegramTokenConfigured": bool(env.telegram_bot_token),
        "telegramAllowedChatIds": env.telegram_allowed_chat_ids,
        "bitgetCredentialsConfigured": bool(
            env.bitget_api_key and env.bitget_api_secret and env.bitget_api_passphrase
        ),
        "bitgetBaseUrl": env.bitget_base_url,
    }
