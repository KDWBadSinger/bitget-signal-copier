export type LogLevel = "info" | "success" | "warning" | "error";

export interface AppEvent {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

export type PositionMode = "one-way" | "hedge";
export type MarginMode = "isolated" | "crossed";
export type OrderForce = "gtc" | "ioc" | "fok" | "post_only";

export interface RuntimeConfig {
  autoTradingEnabled: boolean;
  dryRun: boolean;
  useDemoTrading: boolean;
  productType: string;
  marginMode: MarginMode;
  marginCoin: string;
  positionMode: PositionMode;
  defaultOrderSize: string;
  defaultQuote: string;
  allowedSymbols: string[];
  maxNotionalUsdt: number | null;
  requireStopLoss: boolean;
  useSignalEntryAsLimit: boolean;
  orderForce: OrderForce;
  duplicateWindowSec: number;
}

export interface EnvConfig {
  port: number;
  telegramBotToken?: string;
  telegramAllowedChatIds: string[];
  telegramPollingEnabled: boolean;
  telegramWebhookSecret?: string;
  bitgetApiKey?: string;
  bitgetApiSecret?: string;
  bitgetApiPassphrase?: string;
  bitgetBaseUrl: string;
  dryRunDefault: boolean;
  useDemoTradingDefault: boolean;
  autoTradingEnabledDefault: boolean;
  defaultOrderSize: string;
  defaultQuote: string;
  maxNotionalUsdt: number | null;
}

export interface EnvStatus {
  telegramTokenConfigured: boolean;
  telegramAllowedChatIds: string[];
  bitgetCredentialsConfigured: boolean;
  bitgetBaseUrl: string;
}

export type SignalAction = "long" | "short" | "close_long" | "close_short";
export type ParsedOrderType = "market" | "limit";

export interface TradingSignal {
  rawText: string;
  symbol: string;
  action: SignalAction;
  orderType: ParsedOrderType;
  size: string;
  entryPrice?: string;
  stopLoss?: string;
  takeProfits: string[];
  warnings: string[];
}

export interface SignalContext {
  source: "telegram" | "manual" | "webhook";
  chatId?: string;
  messageId?: number;
  updateId?: number;
}

export interface ParseResult {
  ok: boolean;
  signal?: TradingSignal;
  reason?: string;
  warnings?: string[];
}

export interface BitgetPlaceOrderRequest {
  symbol: string;
  productType: string;
  marginMode: string;
  marginCoin: string;
  size: string;
  side: "buy" | "sell";
  orderType: "market" | "limit";
  force?: OrderForce;
  price?: string;
  clientOid?: string;
  tradeSide?: "open" | "close";
  reduceOnly?: "YES" | "NO";
  presetStopSurplusPrice?: string;
  presetStopLossPrice?: string;
}

export interface BitgetApiResponse<T> {
  code: string;
  msg: string;
  requestTime?: number;
  data: T;
}

export interface OrderExecution {
  mode: "dry-run" | "live";
  signal: TradingSignal;
  request: BitgetPlaceOrderRequest;
  response?: unknown;
}
