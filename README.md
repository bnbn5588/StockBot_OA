# StockBot_OA — LINE Official Account webhook

A Firebase Cloud Function that lets users of a LINE Official Account request an
on-demand technical analysis for any stock ticker. A user sends a ticker as a chat
message; the function calls the stock analysis API and replies with the result in
the same chat.

```
LINE user ──message──▶ LINE Platform ──webhook POST──▶ Cloud Function `LineBot`
                                                         │
                                                         ├─▶ POST {API_URL}/stock_analysis
                                                         │     (x-api-key: API_KEY)
                                                         ◀─┘   JSON analysis
LINE user ◀──reply──── LINE Platform ◀──Reply API─────────┘
                                         (Bearer LB_KEY)
```

## Usage (what users type in LINE)

| Message | Result |
|---|---|
| `AAPL` | Analysis with the default engine |
| `PTT.BK` | Any Yahoo Finance symbol works, including non-US suffixes (`.BK`, `.T`, …) |
| `AAPL v1` | Analysis with the legacy engine |
| `AAPL v1 30d` | Legacy engine with an explicit data window (`30d`, `60d`, `90d`, `6mo`, `1y`) |
| `help` or `/help` | Usage text |

Tickers are case-insensitive. A period given without `v1` (e.g. `AAPL 30d`) is
accepted but has no effect — the default engine always uses its own history window.

### Default engine reply

```
📊 NVDA — Stock Analysis

🔴 SELL · 1/5 trend reads up
📡 Trend: Moderate (ADX: 28.9)
🗓 Data as of 2026-11-06

— Trend —
🧭 Regime: DOWN (SMA200 204.39, close 186.64)
📈 SMA50 vs SMA200: BUY
📉 EMA20 vs EMA50: SELL
↕️ +DI 9.92 / −DI 41.6 → Bearish
📊 MACD hist: -3.2008 (Bearish)

— Momentum & Volatility —
💡 RSI: 30.77 → Neutral
📉 Bollinger: 187.73 – 235.36
🔥 ATR(14): 7.77

Trend reads: price vs SMA200, SMA50 vs SMA200, EMA20 vs EMA50, +DI vs −DI, MACD. They describe the trend — not a forecast or a win probability.
```

The first line shows the signal and how many of the five trend reads listed in the footer
point up (0/5 = all down, 5/5 = all up). A ticker with under 200 trading days of history
replies `HOLD (not enough history)`.

The legacy engine (`v1`) reply keeps its `SIGNAL (strength, confidence%)` first line, lists SMA/EMA/MACD, RSI, Stochastic, Bollinger, ATR and
OBV signals instead and ends with `(legacy v1 engine)`. `⚠️ stale` is appended to the
date line when the API reports that its market data is behind the latest session.

## Webhook behaviour

`exports.LineBot` (`functions/index.js`) is an HTTPS function (`firebase-functions/v1`).

- **Empty `events` array** (LINE's *Verify* button) → `200 OK`, no reply.
- **Text message** → parse, call the API, reply via the Reply API, then `200`.
- **Any other event or message type** (sticker, image, follow, …) → `200`
  `Event type not supported`, no reply.
- **API error** (unknown ticker, provider outage, …) → the user gets
  `❌ Error: <message from the API>`; the function still returns `200` so LINE does
  not retry.
- **Unexpected failure** (e.g. the Reply API call itself fails) → `500`.

Only the first event of each webhook delivery is handled.

The reply is formatted by `formatV2` / `formatV1` depending on the `engine` field of
the API response. Fields are read with a null-safe `pick()` helper, so a field missing
from the API response renders as `-` instead of breaking the reply.

Errors are logged as `status + message` only — never the raw axios error, which
contains the request headers (including the API key).

### API request

```http
POST {API_URL}/stock_analysis
Content-Type: application/json
x-api-key: {API_KEY}

{"ticker": "AAPL", "period": "90d", "engine": "v2"}
```

Response fields used: `recommendation`, `strength`, `confidence`, `trend_strength`,
`data_as_of`, `stale`, `engine`, and `details` (per-indicator values).

## Configuration

Environment variables, read from `functions/.env` at deploy time (gitignored):

| Variable | Description |
|---|---|
| `API_URL` | Base URL of the analysis API **without** the endpoint, e.g. `https://<host>/api` — the function appends `/stock_analysis` |
| `API_KEY` | Value sent as the `x-api-key` header to the analysis API |
| `LB_KEY` | LINE Messaging API **channel access token** (long-lived), used for the Reply API |

```
# functions/.env
API_URL=https://<analysis-api-host>/api
API_KEY=<analysis api key>
LB_KEY=<LINE channel access token>
```

## Deploy

Requires the [Firebase CLI](https://firebase.google.com/docs/cli) and access to the
Firebase project in `.firebaserc` (`bnbn5588`). The project must be on the Blaze plan
for functions to make outbound requests.

```bash
npm install -g firebase-tools
firebase login
cd functions && npm ci && cd ..
firebase deploy --only functions
```

`firebase.json` runs `npm run lint` before every deploy; a lint error blocks the
deploy. ESLint is configured for `ecmaVersion: 2018`, so avoid newer syntax such as
optional chaining (`?.`) and nullish coalescing (`??`).

After deploying, the function URL is:

```
https://us-central1-bnbn5588.cloudfunctions.net/LineBot
```

## LINE Developers Console setup

In the channel's **Messaging API** tab:

1. **Webhook URL** → the function URL above, then press **Verify** (expects `200`).
2. **Use webhook** → on.
3. In LINE Official Account Manager, turn **Auto-reply messages** off (otherwise the
   OA's canned reply is sent alongside the bot's).
4. Issue a long-lived **channel access token** and put it in `LB_KEY`.

Replies use the Reply API, which is free and does not count toward the OA's monthly
message quota (push and broadcast messages do).

## Local development

```bash
cd functions
npm ci
npm run lint
npm run serve        # Firebase emulator: http://localhost:5001/bnbn5588/us-central1/LineBot
```

Send a sample webhook body to the emulator:

```bash
curl -X POST http://localhost:5001/bnbn5588/us-central1/LineBot \
  -H 'Content-Type: application/json' \
  -d '{"events":[{"type":"message","replyToken":"dummy","message":{"type":"text","text":"AAPL"}}]}'
```

The API call is real; the final Reply API call fails with a dummy `replyToken`
(the function returns `500`), but the formatted text is visible in the emulator log
if you add a `console.log(responseText)` while testing. Logs in production:

```bash
firebase functions:log --only LineBot
```

## Project structure

```
.firebaserc            Firebase project alias (default: bnbn5588)
firebase.json          Functions config; lint runs as predeploy
functions/
  index.js             Webhook handler, request parsing, reply formatting
  package.json         Node 20; axios, dotenv, firebase-functions
  .eslintrc.js         ESLint (google style, ecmaVersion 2018)
  .env                 Secrets (not committed)
```
