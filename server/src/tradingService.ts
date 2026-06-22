import crypto from "node:crypto";
import type { BitgetClient } from "./bitgetClient.js";
import type { ConfigStore } from "./configStore.js";
import type { EventLog } from "./eventLog.js";
import { parseSignal } from "./signalParser.js";
import type {
  BitgetPlaceOrderRequest,
  OrderExecution,
  RuntimeConfig,
  SignalAction,
  SignalContext,
  TradingSignal
} from "./types.js";

export class TradingService {
  private readonly recentSignals = new Map<string, number>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly bitgetClient: BitgetClient,
    private readonly eventLog: EventLog
  ) {}

  async handleSignalText(text: string, context: SignalContext): Promise<OrderExecution | null> {
    const config = this.configStore.get();
    const fingerprint = this.fingerprint(text, context);

    if (this.isDuplicate(fingerprint, config.duplicateWindowSec)) {
      this.eventLog.append("warning", context.source, "重复信号已跳过", {
        chatId: context.chatId,
        messageId: context.messageId
      });
      return null;
    }

    const parsed = parseSignal(text, config);
    if (!parsed.ok || !parsed.signal) {
      this.eventLog.append("warning", context.source, `信号解析失败：${parsed.reason ?? "未知原因"}`, {
        text
      });
      return null;
    }

    this.markSeen(fingerprint);
    const riskFailure = validateRisk(parsed.signal, config);
    if (riskFailure) {
      this.eventLog.append("warning", "risk", riskFailure, parsed.signal);
      return null;
    }

    const request = buildBitgetOrder(parsed.signal, config);
    if (!config.autoTradingEnabled) {
      this.eventLog.append("info", "trading", "自动交易未开启，信号已解析但未下单", {
        signal: parsed.signal,
        request
      });
      return { mode: "dry-run", signal: parsed.signal, request };
    }

    if (config.dryRun) {
      const execution: OrderExecution = { mode: "dry-run", signal: parsed.signal, request };
      this.eventLog.append("success", "dry-run", "Dry run：已生成 Bitget 下单请求", execution);
      return execution;
    }

    const response = await this.bitgetClient.placeOrder(request, config);
    const execution: OrderExecution = {
      mode: "live",
      signal: parsed.signal,
      request,
      response
    };
    this.eventLog.append("success", "bitget", "Bitget 合约下单成功", execution);
    return execution;
  }

  private fingerprint(text: string, context: SignalContext): string {
    if (context.source === "telegram" && context.chatId && context.messageId !== undefined) {
      return `telegram:${context.chatId}:${context.messageId}`;
    }
    return `${context.source}:${crypto.createHash("sha256").update(text.trim()).digest("hex")}`;
  }

  private isDuplicate(fingerprint: string, duplicateWindowSec: number): boolean {
    const now = Date.now();
    for (const [key, timestamp] of this.recentSignals.entries()) {
      if (now - timestamp > duplicateWindowSec * 1000) {
        this.recentSignals.delete(key);
      }
    }
    return this.recentSignals.has(fingerprint);
  }

  private markSeen(fingerprint: string): void {
    this.recentSignals.set(fingerprint, Date.now());
  }
}

function validateRisk(signal: TradingSignal, config: RuntimeConfig): string | null {
  if (config.allowedSymbols.length > 0 && !config.allowedSymbols.includes(signal.symbol)) {
    return `交易对 ${signal.symbol} 不在允许列表`;
  }

  if (config.maxNotionalUsdt && signal.entryPrice) {
    const notional = Number.parseFloat(signal.size) * Number.parseFloat(signal.entryPrice);
    if (Number.isFinite(notional) && notional > config.maxNotionalUsdt) {
      return `信号名义价值 ${notional.toFixed(2)} 超过上限 ${config.maxNotionalUsdt}`;
    }
  }

  if (config.requireStopLoss && !signal.stopLoss && (signal.action === "long" || signal.action === "short")) {
    return "风控要求止损，但信号未包含止损";
  }

  return null;
}

export function buildBitgetOrder(signal: TradingSignal, config: RuntimeConfig): BitgetPlaceOrderRequest {
  const direction = resolveDirection(signal.action, config.positionMode);
  const clientOid = `bsc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const request: BitgetPlaceOrderRequest = {
    symbol: signal.symbol,
    productType: config.productType,
    marginMode: config.marginMode,
    marginCoin: config.marginCoin,
    size: signal.size,
    side: direction.side,
    orderType: signal.orderType,
    clientOid
  };

  if (signal.orderType === "limit" && signal.entryPrice) {
    request.price = signal.entryPrice;
    request.force = config.orderForce;
  }

  if (direction.tradeSide) {
    request.tradeSide = direction.tradeSide;
  }

  if (direction.reduceOnly) {
    request.reduceOnly = direction.reduceOnly;
  }

  if (signal.takeProfits[0] && (signal.action === "long" || signal.action === "short")) {
    request.presetStopSurplusPrice = signal.takeProfits[0];
  }
  if (signal.stopLoss && (signal.action === "long" || signal.action === "short")) {
    request.presetStopLossPrice = signal.stopLoss;
  }

  return request;
}

function resolveDirection(
  action: SignalAction,
  positionMode: RuntimeConfig["positionMode"]
): Pick<BitgetPlaceOrderRequest, "side" | "tradeSide" | "reduceOnly"> {
  if (positionMode === "hedge") {
    if (action === "long") {
      return { side: "buy", tradeSide: "open" };
    }
    if (action === "short") {
      return { side: "sell", tradeSide: "open" };
    }
    if (action === "close_long") {
      return { side: "buy", tradeSide: "close" };
    }
    return { side: "sell", tradeSide: "close" };
  }

  if (action === "long") {
    return { side: "buy" };
  }
  if (action === "short") {
    return { side: "sell" };
  }
  if (action === "close_long") {
    return { side: "sell", reduceOnly: "YES" };
  }
  return { side: "buy", reduceOnly: "YES" };
}
