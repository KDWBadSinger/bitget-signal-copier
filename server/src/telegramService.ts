import type { EventLog } from "./eventLog.js";
import type { TradingService } from "./tradingService.js";

interface TelegramChat {
  id: number | string;
  title?: string;
  username?: string;
  type?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramStatus {
  running: boolean;
  tokenConfigured: boolean;
  allowedChatIds: string[];
  offset: number;
}

export class TelegramService {
  private running = false;
  private offset = 0;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly token: string | undefined,
    private readonly allowedChatIds: string[],
    private readonly tradingService: TradingService,
    private readonly eventLog: EventLog
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    if (!this.token) {
      this.eventLog.append("warning", "telegram", "TELEGRAM_BOT_TOKEN 未配置，监听未启动");
      return;
    }

    this.running = true;
    this.loopPromise = this.pollLoop();
    this.eventLog.append("success", "telegram", "Telegram 长轮询已启动");
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
    this.eventLog.append("info", "telegram", "Telegram 长轮询已停止");
  }

  getStatus(): TelegramStatus {
    return {
      running: this.running,
      tokenConfigured: Boolean(this.token),
      allowedChatIds: this.allowedChatIds,
      offset: this.offset
    };
  }

  async handleWebhookUpdate(update: TelegramUpdate): Promise<void> {
    await this.processUpdate(update);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.call<TelegramUpdate[]>("getUpdates", {
          offset: this.offset || undefined,
          timeout: 30,
          allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"]
        });

        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.processUpdate(update);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.eventLog.append("error", "telegram", `Telegram 监听异常：${message}`);
        await sleep(3000);
      }
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const message =
      update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
    if (!message) {
      return;
    }

    const chatId = String(message.chat.id);
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(chatId)) {
      this.eventLog.append("warning", "telegram", "未授权 chat 的消息已忽略", {
        chatId,
        title: message.chat.title,
        username: message.chat.username
      });
      return;
    }

    const text = message.text ?? message.caption ?? "";
    if (!text.trim()) {
      return;
    }

    this.eventLog.append("info", "telegram", "收到 Telegram 信号", {
      chatId,
      messageId: message.message_id,
      text
    });

    try {
      await this.tradingService.handleSignalText(text, {
        source: "telegram",
        chatId,
        messageId: message.message_id,
        updateId: update.update_id
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.eventLog.append("error", "trading", `处理 Telegram 信号失败：${errorMessage}`, {
        chatId,
        messageId: message.message_id
      });
    }
  }

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.token) {
      throw new Error("Telegram Bot Token 未配置");
    }

    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !data.ok || data.result === undefined) {
      throw new Error(data.description ?? `Telegram HTTP ${response.status}`);
    }
    return data.result;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
