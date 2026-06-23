from __future__ import annotations

import base64
import hashlib
import hmac
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .models import BitgetPlaceOrderRequest, EnvConfig, RuntimeConfig


class BitgetClient:
    def __init__(self, env: EnvConfig) -> None:
        self._env = env

    def place_order(self, order: BitgetPlaceOrderRequest, config: RuntimeConfig) -> dict[str, Any]:
        return self._request("POST", "/api/v2/mix/order/place-order", order, None, config)

    def _request(
        self,
        method: str,
        request_path: str,
        body: dict[str, Any] | None,
        query: dict[str, str] | None,
        config: RuntimeConfig,
    ) -> dict[str, Any]:
        if not (self._env.bitget_api_key and self._env.bitget_api_secret and self._env.bitget_api_passphrase):
            raise RuntimeError("Bitget API Key/Secret/Passphrase 未完整配置")

        query_string = urllib.parse.urlencode(query or {})
        body_text = json.dumps(body or {}, separators=(",", ":"), ensure_ascii=False) if body else ""
        timestamp = str(int(__import__("time").time() * 1000))
        sign_payload = f"{timestamp}{method}{request_path}{'?' + query_string if query_string else ''}{body_text}"
        signature = base64.b64encode(
            hmac.new(
                self._env.bitget_api_secret.encode("utf-8"),
                sign_payload.encode("utf-8"),
                hashlib.sha256,
            ).digest()
        ).decode("utf-8")

        url = f"{self._env.bitget_base_url}{request_path}{'?' + query_string if query_string else ''}"
        headers = {
            "ACCESS-KEY": self._env.bitget_api_key,
            "ACCESS-SIGN": signature,
            "ACCESS-TIMESTAMP": timestamp,
            "ACCESS-PASSPHRASE": self._env.bitget_api_passphrase,
            "Content-Type": "application/json",
            "locale": "en-US",
        }
        if config.useDemoTrading:
            headers["paptrading"] = "1"

        request = urllib.request.Request(
            url,
            data=body_text.encode("utf-8") if body_text else None,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                status = response.status
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            status = error.code
            text = error.read().decode("utf-8", errors="replace")
        except urllib.error.URLError as error:
            raise RuntimeError(f"Bitget 网络请求失败：{error.reason}") from error

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"Bitget 返回非 JSON 响应：HTTP {status} {text[:300]}") from error

        if status < 200 or status >= 300 or parsed.get("code") != "00000":
            raise RuntimeError(f"Bitget 下单失败：HTTP {status} code={parsed.get('code')} msg={parsed.get('msg')}")
        return parsed
