import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { BitgetClient } from "./bitgetClient.js";
import { ConfigStore } from "./configStore.js";
import { env, getEnvStatus } from "./env.js";
import { EventLog } from "./eventLog.js";
import { TelegramService } from "./telegramService.js";
import { TradingService } from "./tradingService.js";
import type { RuntimeConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const eventLog = new EventLog();
const configStore = new ConfigStore(env);
await configStore.load();
const bitgetClient = new BitgetClient();
const tradingService = new TradingService(configStore, bitgetClient, eventLog);
const telegramService = new TelegramService(
  env.telegramBotToken,
  env.telegramAllowedChatIds,
  tradingService,
  eventLog
);

if (env.telegramPollingEnabled) {
  telegramService.start();
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/status", (_request, response) => {
  response.json({
    env: getEnvStatus(),
    config: configStore.get(),
    telegram: telegramService.getStatus(),
    events: eventLog.list(20)
  });
});

app.get("/api/events", (request, response) => {
  const limit = Number.parseInt(String(request.query.limit ?? "100"), 10);
  response.json({ events: eventLog.list(Number.isFinite(limit) ? limit : 100) });
});

app.get("/api/events/stream", (request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  eventLog.list(20).reverse().forEach(send);
  const unsubscribe = eventLog.onEvent(send);
  request.on("close", unsubscribe);
});

app.get("/api/config", (_request, response) => {
  response.json({ config: configStore.get(), env: getEnvStatus() });
});

app.put("/api/config", async (request, response, next) => {
  try {
    const patch = sanitizeConfigPatch(request.body);
    const config = await configStore.update(patch);
    eventLog.append("success", "config", "运行配置已保存");
    response.json({ config });
  } catch (error) {
    next(error);
  }
});

app.post("/api/test-signal", async (request, response, next) => {
  try {
    const text = typeof request.body?.text === "string" ? request.body.text : "";
    const execution = await tradingService.handleSignalText(text, { source: "manual" });
    response.json({ execution, events: eventLog.list(10) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/telegram/start", (_request, response) => {
  telegramService.start();
  response.json({ telegram: telegramService.getStatus() });
});

app.post("/api/telegram/stop", async (_request, response, next) => {
  try {
    await telegramService.stop();
    response.json({ telegram: telegramService.getStatus() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/telegram/webhook/:secret", async (request, response, next) => {
  try {
    const headerSecret = request.get("X-Telegram-Bot-Api-Secret-Token");
    if (
      !env.telegramWebhookSecret ||
      (request.params.secret !== env.telegramWebhookSecret && headerSecret !== env.telegramWebhookSecret)
    ) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    await telegramService.handleWebhookUpdate(request.body);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const clientDist = path.resolve(__dirname, "../client");
app.use(express.static(clientDist));
app.get("*", (_request, response) => {
  response.sendFile(path.join(clientDist, "index.html"));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  eventLog.append("error", "server", message);
  response.status(500).json({ error: message });
});

app.listen(env.port, () => {
  eventLog.append("success", "server", `服务已启动：http://localhost:${env.port}`);
});

function sanitizeConfigPatch(body: unknown): Partial<RuntimeConfig> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    autoTradingEnabled: Boolean(input.autoTradingEnabled),
    dryRun: Boolean(input.dryRun),
    useDemoTrading: Boolean(input.useDemoTrading),
    productType: String(input.productType ?? "USDT-FUTURES"),
    marginMode: input.marginMode === "crossed" ? "crossed" : "isolated",
    marginCoin: String(input.marginCoin ?? "USDT"),
    positionMode: input.positionMode === "hedge" ? "hedge" : "one-way",
    defaultOrderSize: String(input.defaultOrderSize ?? ""),
    defaultQuote: String(input.defaultQuote ?? "USDT"),
    allowedSymbols: normalizeAllowedSymbols(input.allowedSymbols),
    maxNotionalUsdt: normalizeNullableNumber(input.maxNotionalUsdt),
    requireStopLoss: Boolean(input.requireStopLoss),
    useSignalEntryAsLimit: Boolean(input.useSignalEntryAsLimit),
    orderForce:
      input.orderForce === "ioc" || input.orderForce === "fok" || input.orderForce === "post_only"
        ? input.orderForce
        : "gtc",
    duplicateWindowSec: normalizeInteger(input.duplicateWindowSec, 120)
  };
}

function normalizeAllowedSymbols(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number.parseFloat(String(value));
  return Number.isFinite(number) ? number : null;
}

function normalizeInteger(value: unknown, fallback: number): number {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : fallback;
}
