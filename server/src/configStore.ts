import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EnvConfig, MarginMode, OrderForce, PositionMode, RuntimeConfig } from "./types.js";

const runtimeDir = path.resolve(process.cwd(), ".runtime");
const configPath = path.join(runtimeDir, "config.json");

export function defaultRuntimeConfig(env: EnvConfig): RuntimeConfig {
  return {
    autoTradingEnabled: env.autoTradingEnabledDefault,
    dryRun: env.dryRunDefault,
    useDemoTrading: env.useDemoTradingDefault,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    positionMode: "one-way",
    defaultOrderSize: env.defaultOrderSize,
    defaultQuote: env.defaultQuote,
    allowedSymbols: [],
    maxNotionalUsdt: env.maxNotionalUsdt,
    requireStopLoss: false,
    useSignalEntryAsLimit: true,
    orderForce: "gtc",
    duplicateWindowSec: 120
  };
}

export class ConfigStore {
  private config: RuntimeConfig;

  constructor(private readonly envConfig: EnvConfig) {
    this.config = defaultRuntimeConfig(envConfig);
  }

  async load(): Promise<RuntimeConfig> {
    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
      this.config = normalizeConfig({ ...this.config, ...parsed });
    } catch (error) {
      await this.save(this.config);
    }
    return this.config;
  }

  get(): RuntimeConfig {
    return this.config;
  }

  async update(patch: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
    this.config = normalizeConfig({ ...this.config, ...patch });
    await this.save(this.config);
    return this.config;
  }

  private async save(config: RuntimeConfig): Promise<void> {
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

export function normalizeConfig(input: RuntimeConfig): RuntimeConfig {
  const marginMode: MarginMode = input.marginMode === "crossed" ? "crossed" : "isolated";
  const positionMode: PositionMode = input.positionMode === "hedge" ? "hedge" : "one-way";
  const allowedOrderForces: OrderForce[] = ["gtc", "ioc", "fok", "post_only"];
  const orderForce = allowedOrderForces.includes(input.orderForce) ? input.orderForce : "gtc";

  return {
    autoTradingEnabled: Boolean(input.autoTradingEnabled),
    dryRun: Boolean(input.dryRun),
    useDemoTrading: Boolean(input.useDemoTrading),
    productType: String(input.productType || "USDT-FUTURES").toUpperCase(),
    marginMode,
    marginCoin: String(input.marginCoin || "USDT").toUpperCase(),
    positionMode,
    defaultOrderSize: String(input.defaultOrderSize || "").trim(),
    defaultQuote: String(input.defaultQuote || "USDT").toUpperCase(),
    allowedSymbols: normalizeSymbols(input.allowedSymbols),
    maxNotionalUsdt:
      typeof input.maxNotionalUsdt === "number" && Number.isFinite(input.maxNotionalUsdt)
        ? input.maxNotionalUsdt
        : null,
    requireStopLoss: Boolean(input.requireStopLoss),
    useSignalEntryAsLimit: Boolean(input.useSignalEntryAsLimit),
    orderForce,
    duplicateWindowSec: clampInteger(input.duplicateWindowSec, 10, 3600, 120)
  };
}

function normalizeSymbols(symbols: string[]): string[] {
  if (!Array.isArray(symbols)) {
    return [];
  }
  return Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean)
    )
  );
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
