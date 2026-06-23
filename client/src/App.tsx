import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Play,
  Radio,
  RefreshCw,
  Save,
  Send,
  Square,
  XCircle
} from "lucide-react";
import React from "react";
import { useEffect, useMemo, useState } from "react";

type LogLevel = "info" | "success" | "warning" | "error";
type PositionMode = "one-way" | "hedge";
type MarginMode = "isolated" | "crossed";
type OrderForce = "gtc" | "ioc" | "fok" | "post_only";

interface AppEvent {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

interface RuntimeConfig {
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

interface EnvStatus {
  telegramTokenConfigured: boolean;
  telegramAllowedChatIds: string[];
  bitgetCredentialsConfigured: boolean;
  bitgetBaseUrl: string;
}

interface TelegramStatus {
  running: boolean;
  tokenConfigured: boolean;
  allowedChatIds: string[];
  offset: number;
}

interface StatusResponse {
  env: EnvStatus;
  config: RuntimeConfig;
  telegram: TelegramStatus;
  events: AppEvent[];
}

const sampleSignal = "BTCUSDT LONG market size=0.001 SL 64000 TP 68000";

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [allowedSymbolsText, setAllowedSymbolsText] = useState("");
  const [testText, setTestText] = useState(sampleSignal);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const events = status?.events ?? [];
  const env = status?.env;
  const telegram = status?.telegram;

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(loadStatus, 3000);
    const eventSource = new EventSource("/api/events/stream");
    eventSource.onmessage = () => void loadStatus();
    eventSource.onerror = () => eventSource.close();
    return () => {
      window.clearInterval(timer);
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (status?.config && !config) {
      setConfig(status.config);
      setAllowedSymbolsText(status.config.allowedSymbols.join(", "));
    }
  }, [config, status]);

  const tradingMode = useMemo(() => {
    if (!config) {
      return "loading";
    }
    if (!config.autoTradingEnabled) {
      return "paused";
    }
    return config.dryRun ? "dry-run" : "live";
  }, [config]);

  async function loadStatus() {
    try {
      const data = await api<StatusResponse>("/api/status");
      setStatus(data);
      setError(null);
    } catch (requestError) {
      setError(readError(requestError));
    }
  }

  async function saveConfig() {
    if (!config) {
      return;
    }
    await runAction("save", async () => {
      const payload: RuntimeConfig = {
        ...config,
        allowedSymbols: splitSymbols(allowedSymbolsText)
      };
      const response = await api<{ config: RuntimeConfig }>("/api/config", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      setConfig(response.config);
      setAllowedSymbolsText(response.config.allowedSymbols.join(", "));
      await loadStatus();
    });
  }

  async function sendTestSignal() {
    await runAction("test", async () => {
      await api("/api/test-signal", {
        method: "POST",
        body: JSON.stringify({ text: testText })
      });
      await loadStatus();
    });
  }

  async function toggleTelegram(shouldRun: boolean) {
    await runAction(shouldRun ? "telegram-start" : "telegram-stop", async () => {
      await api(`/api/telegram/${shouldRun ? "start" : "stop"}`, { method: "POST" });
      await loadStatus();
    });
  }

  async function runAction(name: string, action: () => Promise<void>) {
    setBusyAction(name);
    setError(null);
    try {
      await action();
    } catch (requestError) {
      setError(readError(requestError));
    } finally {
      setBusyAction(null);
    }
  }

  function patchConfig(patch: Partial<RuntimeConfig>) {
    setConfig((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Bitget Signal Copier</h1>
          <div className="subtitle">Telegram to Bitget Futures</div>
        </div>
        <button className="iconButton" onClick={() => void loadStatus()} title="刷新状态">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && (
        <div className="banner errorBanner">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      <section className="statusGrid">
        <StatusTile
          icon={<Radio size={20} />}
          label="Telegram"
          value={telegram?.running ? "Listening" : "Stopped"}
          tone={telegram?.running ? "good" : "muted"}
          meta={env?.telegramTokenConfigured ? "Token ready" : "Token missing"}
        />
        <StatusTile
          icon={<KeyRound size={20} />}
          label="Bitget"
          value={env?.bitgetCredentialsConfigured ? "Configured" : "Missing keys"}
          tone={env?.bitgetCredentialsConfigured ? "good" : "warn"}
          meta={env?.bitgetBaseUrl ?? "https://api.bitget.com"}
        />
        <StatusTile
          icon={<FlaskConical size={20} />}
          label="Trading"
          value={modeLabel(tradingMode)}
          tone={tradingMode === "live" ? "danger" : tradingMode === "dry-run" ? "warn" : "muted"}
          meta={config?.useDemoTrading ? "Demo header on" : "Production endpoint"}
        />
        <StatusTile
          icon={<Activity size={20} />}
          label="Events"
          value={String(events.length)}
          tone="neutral"
          meta="latest logs"
        />
      </section>

      <section className="workspace">
        <div className="panel settingsPanel">
          <div className="panelHeader">
            <h2>运行配置</h2>
            <button className="primaryButton" onClick={() => void saveConfig()} disabled={!config || busyAction === "save"}>
              <Save size={16} />
              保存
            </button>
          </div>

          {config && (
            <div className="formGrid">
              <ToggleField
                label="自动交易"
                checked={config.autoTradingEnabled}
                onChange={(autoTradingEnabled) => patchConfig({ autoTradingEnabled })}
              />
              <ToggleField
                label="Dry run"
                checked={config.dryRun}
                onChange={(dryRun) => patchConfig({ dryRun })}
              />
              <ToggleField
                label="Demo 盘"
                checked={config.useDemoTrading}
                onChange={(useDemoTrading) => patchConfig({ useDemoTrading })}
              />
              <ToggleField
                label="要求止损"
                checked={config.requireStopLoss}
                onChange={(requireStopLoss) => patchConfig({ requireStopLoss })}
              />

              <SegmentedField
                label="持仓模式"
                value={config.positionMode}
                options={[
                  ["one-way", "单向"],
                  ["hedge", "双向"]
                ]}
                onChange={(positionMode) => patchConfig({ positionMode: positionMode as PositionMode })}
              />
              <SegmentedField
                label="保证金"
                value={config.marginMode}
                options={[
                  ["isolated", "逐仓"],
                  ["crossed", "全仓"]
                ]}
                onChange={(marginMode) => patchConfig({ marginMode: marginMode as MarginMode })}
              />

              <TextField
                label="Product Type"
                value={config.productType}
                onChange={(productType) => patchConfig({ productType })}
              />
              <TextField
                label="保证金币种"
                value={config.marginCoin}
                onChange={(marginCoin) => patchConfig({ marginCoin })}
              />
              <TextField
                label="默认数量"
                value={config.defaultOrderSize}
                onChange={(defaultOrderSize) => patchConfig({ defaultOrderSize })}
              />
              <TextField
                label="默认报价"
                value={config.defaultQuote}
                onChange={(defaultQuote) => patchConfig({ defaultQuote })}
              />
              <TextField
                label="允许交易对"
                value={allowedSymbolsText}
                onChange={setAllowedSymbolsText}
              />
              <NumberField
                label="名义价值上限"
                value={config.maxNotionalUsdt}
                onChange={(maxNotionalUsdt) => patchConfig({ maxNotionalUsdt })}
              />
              <SegmentedField
                label="限价策略"
                value={config.orderForce}
                options={[
                  ["gtc", "GTC"],
                  ["ioc", "IOC"],
                  ["fok", "FOK"],
                  ["post_only", "Post"]
                ]}
                onChange={(orderForce) => patchConfig({ orderForce: orderForce as OrderForce })}
              />
              <NumberField
                label="去重秒数"
                value={config.duplicateWindowSec}
                onChange={(duplicateWindowSec) => patchConfig({ duplicateWindowSec: duplicateWindowSec ?? 120 })}
              />
              <ToggleField
                label="入场价转限价"
                checked={config.useSignalEntryAsLimit}
                onChange={(useSignalEntryAsLimit) => patchConfig({ useSignalEntryAsLimit })}
              />
            </div>
          )}
        </div>

        <div className="sideColumn">
          <div className="panel">
            <div className="panelHeader">
              <h2>Telegram</h2>
              <div className="buttonRow">
                <button
                  className="secondaryButton"
                  onClick={() => void toggleTelegram(true)}
                  disabled={telegram?.running || busyAction === "telegram-start"}
                  title="启动监听"
                >
                  <Play size={15} />
                  启动
                </button>
                <button
                  className="secondaryButton"
                  onClick={() => void toggleTelegram(false)}
                  disabled={!telegram?.running || busyAction === "telegram-stop"}
                  title="停止监听"
                >
                  <Square size={15} />
                  停止
                </button>
              </div>
            </div>
            <dl className="keyValues">
              <div>
                <dt>Token</dt>
                <dd>{telegram?.tokenConfigured ? "已配置" : "未配置"}</dd>
              </div>
              <div>
                <dt>Offset</dt>
                <dd>{telegram?.offset ?? 0}</dd>
              </div>
              <div>
                <dt>Chat IDs</dt>
                <dd>{telegram?.allowedChatIds.length ? telegram.allowedChatIds.join(", ") : "全部"}</dd>
              </div>
            </dl>
          </div>

          <div className="panel">
            <div className="panelHeader">
              <h2>测试信号</h2>
              <button className="primaryButton" onClick={() => void sendTestSignal()} disabled={busyAction === "test"}>
                <Send size={16} />
                发送
              </button>
            </div>
            <textarea
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      </section>

      <section className="panel logsPanel">
        <div className="panelHeader">
          <h2>事件日志</h2>
          <span className="mutedText">{new Date().toLocaleString()}</span>
        </div>
        <div className="logs">
          {events.length === 0 ? (
            <div className="emptyState">暂无事件</div>
          ) : (
            events.map((event) => <LogRow key={event.id} event={event} />)
          )}
        </div>
      </section>
    </main>
  );
}

function StatusTile({
  icon,
  label,
  value,
  meta,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta: string;
  tone: "good" | "warn" | "danger" | "muted" | "neutral";
}) {
  return (
    <div className={`statusTile ${tone}`}>
      <div className="statusIcon">{icon}</div>
      <div>
        <div className="tileLabel">{label}</div>
        <div className="tileValue">{value}</div>
        <div className="tileMeta">{meta}</div>
      </div>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggleField">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggleTrack" />
    </label>
  );
}

function SegmentedField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field spanTwo">
      <span>{label}</span>
      <div className="segmented">
        {options.map(([optionValue, text]) => (
          <button
            type="button"
            key={optionValue}
            className={value === optionValue ? "active" : ""}
            onClick={() => onChange(optionValue)}
          >
            {text}
          </button>
        ))}
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number.parseFloat(event.target.value) : null)}
      />
    </label>
  );
}

function LogRow({ event }: { event: AppEvent }) {
  const Icon = event.level === "success" ? CheckCircle2 : event.level === "error" ? XCircle : AlertTriangle;
  return (
    <article className={`logRow ${event.level}`}>
      <div className="logIcon">
        <Icon size={16} />
      </div>
      <div className="logContent">
        <div className="logHeader">
          <span>{event.source}</span>
          <time>{new Date(event.time).toLocaleTimeString()}</time>
        </div>
        <p>{event.message}</p>
        {event.data ? <pre>{JSON.stringify(event.data, null, 2)}</pre> : null}
      </div>
    </article>
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data as T;
}

function splitSymbols(value: string): string[] {
  return value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function modeLabel(mode: string): string {
  if (mode === "live") {
    return "Live";
  }
  if (mode === "dry-run") {
    return "Dry run";
  }
  if (mode === "paused") {
    return "Paused";
  }
  return "Loading";
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
