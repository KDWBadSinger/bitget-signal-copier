import type { ParseResult, RuntimeConfig, SignalAction, TradingSignal } from "./types.js";

interface JsonSignalCandidate {
  symbol?: unknown;
  side?: unknown;
  action?: unknown;
  size?: unknown;
  qty?: unknown;
  amount?: unknown;
  orderType?: unknown;
  entry?: unknown;
  price?: unknown;
  stopLoss?: unknown;
  sl?: unknown;
  takeProfit?: unknown;
  tp?: unknown;
}

export function parseSignal(text: string, config: RuntimeConfig): ParseResult {
  const rawText = text.trim();
  if (!rawText) {
    return { ok: false, reason: "消息为空" };
  }

  const jsonResult = parseJsonSignal(rawText, config);
  if (jsonResult.ok || jsonResult.reason !== "not-json") {
    return jsonResult;
  }

  const upper = rawText.toUpperCase();
  const symbol = detectSymbol(upper, config.defaultQuote);
  if (!symbol) {
    return { ok: false, reason: "未识别交易对" };
  }

  const action = detectAction(upper);
  if (!action) {
    return { ok: false, reason: "未识别方向，需要 LONG/SHORT/BUY/SELL/CLOSE 等关键词" };
  }

  const entryPrice = detectNumberAfter(
    rawText,
    /(ENTRY|ENTRIES|ENTER|PRICE|入场|进场|开仓|挂单|@\s*)\s*[:：=#-]?\s*/gi
  );
  const stopLoss = detectNumberAfter(rawText, /(SL|STOP\s*LOSS|STOPLOSS|止损)\s*[:：=#-]?\s*/gi);
  const takeProfits = detectAllNumbersAfter(
    rawText,
    /(TP\d*|TAKE\s*PROFIT|TAKEPROFIT|止盈)\s*[:：=#-]?\s*/gi
  );
  const explicitMarket = /\b(MARKET|MKT)\b|市价/i.test(rawText);
  const explicitLimit = /\bLIMIT\b|限价|挂单/i.test(rawText);
  const orderType =
    explicitMarket || (!explicitLimit && (!entryPrice || !config.useSignalEntryAsLimit))
      ? "market"
      : "limit";
  const size = detectSize(rawText) || config.defaultOrderSize;
  const warnings: string[] = [];

  if (!size) {
    return { ok: false, reason: "未识别数量，且未配置默认下单数量" };
  }
  if (!isPositiveNumber(size)) {
    return { ok: false, reason: "下单数量不是有效正数" };
  }
  if (orderType === "limit" && !entryPrice) {
    return { ok: false, reason: "限价单缺少入场价" };
  }
  if (config.requireStopLoss && !stopLoss && (action === "long" || action === "short")) {
    return { ok: false, reason: "当前配置要求信号必须包含止损" };
  }
  if (!stopLoss && (action === "long" || action === "short")) {
    warnings.push("信号未包含止损");
  }

  const signal: TradingSignal = {
    rawText,
    symbol,
    action,
    orderType,
    size,
    entryPrice,
    stopLoss,
    takeProfits,
    warnings
  };

  return { ok: true, signal, warnings };
}

function parseJsonSignal(rawText: string, config: RuntimeConfig): ParseResult {
  let parsed: JsonSignalCandidate;
  try {
    parsed = JSON.parse(rawText) as JsonSignalCandidate;
  } catch {
    return { ok: false, reason: "not-json" };
  }

  const symbol = typeof parsed.symbol === "string" ? normalizeSymbol(parsed.symbol, config.defaultQuote) : "";
  if (!symbol) {
    return { ok: false, reason: "JSON 信号缺少 symbol" };
  }

  const actionText = String(parsed.action ?? parsed.side ?? "").toUpperCase();
  const action = detectAction(actionText);
  if (!action) {
    return { ok: false, reason: "JSON 信号缺少有效方向" };
  }

  const size = String(parsed.size ?? parsed.qty ?? parsed.amount ?? config.defaultOrderSize ?? "").trim();
  if (!size || !isPositiveNumber(size)) {
    return { ok: false, reason: "JSON 信号缺少有效数量" };
  }

  const entryPrice = valueToPositiveString(parsed.entry ?? parsed.price);
  const stopLoss = valueToPositiveString(parsed.stopLoss ?? parsed.sl);
  const takeProfits = normalizeTakeProfits(parsed.takeProfit ?? parsed.tp);
  const requestedOrderType = String(parsed.orderType ?? "").toLowerCase();
  const orderType =
    requestedOrderType === "market" || (!entryPrice && requestedOrderType !== "limit") ? "market" : "limit";

  if (orderType === "limit" && !entryPrice) {
    return { ok: false, reason: "JSON 限价信号缺少 entry/price" };
  }

  const warnings = !stopLoss && (action === "long" || action === "short") ? ["信号未包含止损"] : [];
  return {
    ok: true,
    signal: {
      rawText,
      symbol,
      action,
      orderType,
      size,
      entryPrice,
      stopLoss,
      takeProfits,
      warnings
    },
    warnings
  };
}

function detectSymbol(upperText: string, defaultQuote: string): string {
  const normalized = upperText.replace(/[\u200B-\u200D\uFEFF]/g, "");
  const symbolMatch = normalized.match(/\b([A-Z]{2,15})\s*[\/_-]?\s*(USDT|USDC|USD)\b/);
  if (symbolMatch) {
    return `${symbolMatch[1]}${symbolMatch[2]}`;
  }

  const taggedMatch = normalized.match(/#([A-Z]{2,15})\b/);
  if (taggedMatch) {
    return `${taggedMatch[1]}${defaultQuote}`;
  }

  return "";
}

function normalizeSymbol(value: string, defaultQuote: string): string {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) {
    return "";
  }
  if (/(USDT|USDC|USD)$/.test(clean)) {
    return clean;
  }
  return `${clean}${defaultQuote}`;
}

function detectAction(upperText: string): SignalAction | null {
  const closeLong = /(CLOSE|平仓|平多|止盈|退出).*(LONG|BUY|多)|((LONG|BUY|多).*(CLOSE|平仓|退出))/i;
  const closeShort = /(CLOSE|平仓|平空|止盈|退出).*(SHORT|SELL|空)|((SHORT|SELL|空).*(CLOSE|平仓|退出))/i;
  if (closeLong.test(upperText)) {
    return "close_long";
  }
  if (closeShort.test(upperText)) {
    return "close_short";
  }
  if (/\b(LONG|BUY)\b|做多|看多|开多|多单/i.test(upperText)) {
    return "long";
  }
  if (/\b(SHORT|SELL)\b|做空|看空|开空|空单/i.test(upperText)) {
    return "short";
  }
  return null;
}

function detectSize(text: string): string | undefined {
  return detectNumberAfter(
    text,
    /(SIZE|QTY|QUANTITY|AMOUNT|VOL|VOLUME|数量|张数|仓位|下单)\s*[:：=#-]?\s*/gi
  );
}

function detectNumberAfter(text: string, marker: RegExp): string | undefined {
  marker.lastIndex = 0;
  const match = marker.exec(text);
  if (!match) {
    return undefined;
  }
  const tail = text.slice(marker.lastIndex);
  const numberMatch = tail.match(/([0-9]+(?:\.[0-9]+)?)/);
  return numberMatch?.[1];
}

function detectAllNumbersAfter(text: string, marker: RegExp): string[] {
  const results: string[] = [];
  marker.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text)) !== null) {
    const tail = text.slice(marker.lastIndex);
    const numberMatch = tail.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (numberMatch?.[1]) {
      results.push(numberMatch[1]);
    }
    marker.lastIndex = match.index + match[0].length + Math.max(numberMatch?.index ?? 0, 0) + 1;
  }
  return Array.from(new Set(results));
}

function valueToPositiveString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const text = String(value).trim();
  return isPositiveNumber(text) ? text : undefined;
}

function normalizeTakeProfits(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(valueToPositiveString).filter((item): item is string => Boolean(item));
  }
  const single = valueToPositiveString(value);
  return single ? [single] : [];
}

function isPositiveNumber(value: string): boolean {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0;
}
