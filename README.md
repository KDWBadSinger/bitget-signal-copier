# bitget-signal-copier

Telegram 信号监听器 + Bitget 合约自动下单控制台。

## 功能

- Telegram Bot 长轮询监听群组、频道或私聊信号
- 支持 REST webhook 入口：`POST /api/telegram/webhook/:secret`
- 支持文本信号和 JSON 信号解析
- Bitget V2 合约下单：`/api/v2/mix/order/place-order`
- Bitget HMAC-SHA256/Base64 签名认证
- 支持 dry-run、Demo Trading、单向/双向持仓、逐仓/全仓
- 前端控制台：状态、运行配置、手动测试信号、事件日志
- 基础风控：允许交易对、名义价值上限、止损要求、重复信号过滤

## 安装

```bash
pnpm install
```

如果本机没有 Node/npm，可以使用 Codex 桌面内置的 pnpm/Node。普通开发环境直接安装 Node.js 20+ 后执行上面的命令即可。

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

填写 `.env`：

```env
TELEGRAM_BOT_TOKEN=123456:telegram-bot-token
TELEGRAM_ALLOWED_CHAT_IDS=-1001234567890

BITGET_API_KEY=your-key
BITGET_API_SECRET=your-secret
BITGET_API_PASSPHRASE=your-passphrase

BITGET_DRY_RUN=true
AUTO_TRADING_ENABLED=false
```

默认不会真实下单。需要真实下单时，同时满足：

- `.env` 中 Bitget 三件套完整
- 前端保存 `自动交易 = 开`
- 前端保存 `Dry run = 关`
- API Key 已在 Bitget 开启合约交易权限

## 启动

开发模式：

```bash
pnpm dev
```

生产构建和启动：

```bash
pnpm build
pnpm start
```

打开：

```text
http://localhost:3000
```

## Telegram 接入

1. 在 Telegram 找 `@BotFather` 创建 Bot，拿到 Token。
2. 把 Bot 加入你的信号群或频道。
3. 群组需要允许 Bot 读取消息；频道需要把 Bot 设为管理员。
4. 推荐配置 `TELEGRAM_ALLOWED_CHAT_IDS`，只接受指定来源。

长轮询默认开启：`TELEGRAM_POLLING_ENABLED=true`。

如果部署到公网，也可以使用 webhook：

```text
POST https://your-domain/api/telegram/webhook/:TELEGRAM_WEBHOOK_SECRET
```

## 信号格式

文本示例：

```text
BTCUSDT LONG market size=0.001 SL 64000 TP 68000
ETH/USDT SHORT entry 3600 size 0.02 SL 3700 TP 3300
做多 SOLUSDT 数量 1 入场 140 止损 132 止盈 155
CLOSE LONG BTCUSDT size=0.001
```

JSON 示例：

```json
{
  "symbol": "BTCUSDT",
  "side": "long",
  "orderType": "market",
  "size": "0.001",
  "stopLoss": "64000",
  "takeProfit": ["68000"]
}
```

支持关键词：

- 方向：`LONG`、`BUY`、`SHORT`、`SELL`、`做多`、`做空`
- 平仓：`CLOSE LONG`、`CLOSE SHORT`、`平多`、`平空`
- 数量：`size`、`qty`、`amount`、`数量`
- 入场：`entry`、`price`、`@`、`入场`
- 止损：`SL`、`stop loss`、`止损`
- 止盈：`TP`、`take profit`、`止盈`

## 检查

```bash
pnpm check
pnpm build
```

## 注意

自动交易有真实亏损风险。首次接入建议顺序：

1. `AUTO_TRADING_ENABLED=false` 测试解析。
2. `AUTO_TRADING_ENABLED=true` 且 `BITGET_DRY_RUN=true` 验证下单请求。
3. `BITGET_DEMO_TRADING=true` 连接 Bitget Demo Trading。
4. 小仓位关闭 dry-run。
