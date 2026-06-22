import dotenv from "dotenv";
import type { EnvConfig, EnvStatus } from "./types.js";

dotenv.config();

function boolFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function intFromEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function numberOrNull(name: string): number | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function csv(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const env: EnvConfig = {
  port: intFromEnv("PORT", 3000),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
  telegramAllowedChatIds: csv(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
  telegramPollingEnabled: boolFromEnv("TELEGRAM_POLLING_ENABLED", true),
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
  bitgetApiKey: process.env.BITGET_API_KEY || undefined,
  bitgetApiSecret: process.env.BITGET_API_SECRET || undefined,
  bitgetApiPassphrase: process.env.BITGET_API_PASSPHRASE || undefined,
  bitgetBaseUrl: process.env.BITGET_BASE_URL || "https://api.bitget.com",
  dryRunDefault: boolFromEnv("BITGET_DRY_RUN", true),
  useDemoTradingDefault: boolFromEnv("BITGET_DEMO_TRADING", false),
  autoTradingEnabledDefault: boolFromEnv("AUTO_TRADING_ENABLED", false),
  defaultOrderSize: process.env.DEFAULT_ORDER_SIZE || "",
  defaultQuote: (process.env.DEFAULT_QUOTE || "USDT").toUpperCase(),
  maxNotionalUsdt: numberOrNull("MAX_NOTIONAL_USDT")
};

export function getEnvStatus(): EnvStatus {
  return {
    telegramTokenConfigured: Boolean(env.telegramBotToken),
    telegramAllowedChatIds: env.telegramAllowedChatIds,
    bitgetCredentialsConfigured: Boolean(
      env.bitgetApiKey && env.bitgetApiSecret && env.bitgetApiPassphrase
    ),
    bitgetBaseUrl: env.bitgetBaseUrl
  };
}
