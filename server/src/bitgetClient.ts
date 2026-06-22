import crypto from "node:crypto";
import { env } from "./env.js";
import type { BitgetApiResponse, BitgetPlaceOrderRequest, RuntimeConfig } from "./types.js";

export class BitgetClient {
  async placeOrder(
    order: BitgetPlaceOrderRequest,
    config: RuntimeConfig
  ): Promise<BitgetApiResponse<unknown>> {
    return this.request("POST", "/api/v2/mix/order/place-order", order, undefined, config);
  }

  private async request<T>(
    method: "GET" | "POST",
    requestPath: string,
    body: unknown,
    query: URLSearchParams | undefined,
    config: RuntimeConfig
  ): Promise<BitgetApiResponse<T>> {
    if (!env.bitgetApiKey || !env.bitgetApiSecret || !env.bitgetApiPassphrase) {
      throw new Error("Bitget API Key/Secret/Passphrase 未完整配置");
    }

    const queryString = query?.toString() ?? "";
    const bodyText = body ? JSON.stringify(body) : "";
    const timestamp = Date.now().toString();
    const signPayload = `${timestamp}${method}${requestPath}${queryString ? `?${queryString}` : ""}${bodyText}`;
    const signature = crypto
      .createHmac("sha256", env.bitgetApiSecret)
      .update(signPayload)
      .digest("base64");

    const response = await fetch(
      `${env.bitgetBaseUrl}${requestPath}${queryString ? `?${queryString}` : ""}`,
      {
        method,
        headers: {
          "ACCESS-KEY": env.bitgetApiKey,
          "ACCESS-SIGN": signature,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": env.bitgetApiPassphrase,
          "Content-Type": "application/json",
          locale: "en-US",
          ...(config.useDemoTrading ? { paptrading: "1" } : {})
        },
        body: bodyText || undefined
      }
    );

    const text = await response.text();
    let parsed: BitgetApiResponse<T>;
    try {
      parsed = JSON.parse(text) as BitgetApiResponse<T>;
    } catch {
      throw new Error(`Bitget 返回非 JSON 响应：HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    if (!response.ok || parsed.code !== "00000") {
      throw new Error(`Bitget 下单失败：HTTP ${response.status} code=${parsed.code} msg=${parsed.msg}`);
    }
    return parsed;
  }
}
