/* eslint-disable linebreak-style */
/* eslint-disable object-curly-spacing */
/* eslint-disable spaced-comment */
/* eslint-disable quote-props */
/* eslint-disable comma-dangle */
/* eslint-disable indent */
/* eslint-disable operator-linebreak */
/* eslint-disable camelcase */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */

const functions = require("firebase-functions/v1");
const axios = require("axios");

require("dotenv").config(); // Load .env file

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message";
const LINE_HEADER = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LB_KEY}`,
};

const HELP_TEXT =
  `📖 Stock Bot Usage\n\n` +
  `Send a ticker symbol to get a technical analysis:\n` +
  `  AAPL\n` +
  `  PTT.BK\n\n` +
  `The analysis includes:\n` +
  `  • BUY / SELL / HOLD recommendation\n` +
  `  • Trend regime (price vs 200-day average)\n` +
  `  • Trend agreement score & strength\n` +
  `  • EMA, +DI/−DI, MACD, RSI, ADX\n` +
  `  • Bollinger Bands & ATR\n\n` +
  `Legacy engine: add "v1" (optionally with a period)\n` +
  `  AAPL v1\n` +
  `  AAPL v1 30d\n` +
  `Periods (v1 only): 30d, 60d, 90d, 6mo, 1y`;

// Safe nested lookup — the API's `details` differs by engine, and a missing
// field must render as "-" instead of crashing the whole reply.
// (No optional chaining: eslint is pinned to ecmaVersion 2018.)
function pick(obj, path) {
  return path.split(".").reduce(
    (o, k) => (o !== undefined && o !== null ? o[k] : undefined),
    obj,
  );
}

function show(value) {
  return value === undefined || value === null ? "-" : value;
}

// Parses "AAPL", "AAPL v1", "AAPL v1 30d" and the older "AAPL 30d".
// A bare period without "v1" is accepted but ignored by the default engine,
// which always uses its own (longer) history window.
function parseRequest(text) {
  const parts = text.trim().split(/\s+/);
  const ticker = parts[0].toUpperCase();
  let engine = "v2";
  let period = "90d";
  for (const p of parts.slice(1)) {
    if (p.toLowerCase() === "v1" || p.toLowerCase() === "v2") {
      engine = p.toLowerCase();
    } else {
      period = p;
    }
  }
  return { ticker, engine, period };
}

const EMOJI = { BUY: "🟢", SELL: "🔴", HOLD: "🟡" };

// How many of v2's five trend reads point up (price vs SMA200, SMA50 vs
// SMA200, EMA20 vs EMA50, +DI vs -DI, MACD histogram).
function trendReadsUp(d) {
  return [
    pick(d, "Regime.signal") === "UP",
    d.SMA_Signal === "BUY",
    d.EMA_Signal === "BUY",
    pick(d, "DI.signal") === "Bullish",
    pick(d, "MACD.signal") === "Bullish",
  ].filter(Boolean).length;
}

function header(ticker, data, signalText) {
  const reco = data.recommendation;
  return (
    `📊 ${ticker} — Stock Analysis\n\n` +
    `${EMOJI[reco] || "⚪"} ${signalText}\n` +
    `📡 Trend: ${data.trend_strength}\n` +
    `🗓 Data as of ${show(String(data.data_as_of || "").slice(0, 10))}` +
    (data.stale ? " ⚠️ stale" : "") +
    earningsLine(data.earnings) +
    `\n\n`
  );
}

// Next earnings date from the API (context only, the signal ignores it).
// Within a week it is a warning: the price can gap on the report.
function earningsLine(e) {
  if (!e || e.days === undefined || e.days === null) return "";
  const est = e.estimated ? " (est.)" : "";
  if (e.days < 0) return `\n📅 Last earnings: ${e.date} (${-e.days} days ago)`;
  if (e.days <= 7) {
    const when = e.days === 0 ? "today" : e.days === 1 ? "tomorrow" : `in ${e.days} days`;
    return `\n⚠️ Earnings ${when} · ${e.date}${est}`;
  }
  return `\n📅 Next earnings: ${e.date}${est} (in ${e.days} days)`;
}

// Default engine (v2): regime-gated trend following. BUY = above the 200-day
// average with short-term trend and directional movement up; SELL = below it,
// or short-term trend and directional movement both down.
function formatV2(ticker, data) {
  const d = data.details || {};
  if (d.note) {
    return header(ticker, data, `${data.recommendation} (not enough history)`) + `ℹ️ ${d.note}`;
  }
  return (
    header(ticker, data, `${data.recommendation} · ${trendReadsUp(d)}/5 trend reads up`) +
    `— Trend —\n` +
    `🧭 Regime: ${show(pick(d, "Regime.signal"))} (SMA200 ${show(pick(d, "Regime.sma200"))}, close ${show(pick(d, "BollingerBands.close"))})\n` +
    `📈 SMA50 vs SMA200: ${show(d.SMA_Signal)}\n` +
    `📉 EMA20 vs EMA50: ${show(d.EMA_Signal)}\n` +
    `↕️ +DI ${show(pick(d, "DI.plus"))} / −DI ${show(pick(d, "DI.minus"))} → ${show(pick(d, "DI.signal"))}\n` +
    `📊 MACD hist: ${show(pick(d, "MACD.histogram"))} (${show(pick(d, "MACD.signal"))})\n\n` +
    `— Momentum & Volatility —\n` +
    `💡 RSI: ${show(pick(d, "RSI.value"))} → ${show(pick(d, "RSI.signal"))}\n` +
    `📉 Bollinger: ${show(pick(d, "BollingerBands.lower"))} – ${show(pick(d, "BollingerBands.upper"))}\n` +
    `🔥 ATR(14): ${show(pick(d, "ATR14.value"))}\n\n` +
    `Trend reads: price vs SMA200, SMA50 vs SMA200, EMA20 vs EMA50, +DI vs −DI, MACD. ` +
    `They describe the trend — not a forecast or a win probability.`
  );
}

// Legacy engine (v1): 7-indicator weighted vote.
function formatV1(ticker, data) {
  const d = data.details || {};
  return (
    header(ticker, data, `${data.recommendation} (${data.strength}, ${data.confidence}%)`) +
    `— Trend Indicators —\n` +
    `📈 SMA: ${show(d.SMA_Signal)}\n` +
    `📉 EMA: ${show(d.EMA_Signal)}\n` +
    `📊 MACD: ${show(pick(d, "MACD.value"))} (${show(pick(d, "MACD.signal"))})\n\n` +
    `— Momentum Indicators —\n` +
    `💡 RSI: ${show(pick(d, "RSI.value"))} → ${show(pick(d, "RSI.signal"))}\n` +
    `🎯 Stochastic: %K ${show(pick(d, "Stochastic.K"))} / %D ${show(pick(d, "Stochastic.D"))} → ${show(pick(d, "Stochastic.signal"))}\n\n` +
    `— Volatility & Volume —\n` +
    `📉 Bollinger: ${show(pick(d, "BollingerBands.signal"))} (close ${show(pick(d, "BollingerBands.close"))})\n` +
    `🔥 ATR(14): ${show(pick(d, "ATR14.value"))}\n` +
    `📦 OBV: ${show(pick(d, "OBV.signal"))}\n\n` +
    `(legacy v1 engine)`
  );
}

exports.LineBot = functions
  .region("asia-southeast1")
  .runWith({ serviceAccount: "1092928750813-compute@developer.gserviceaccount.com" })
  .https.onRequest(async (req, res) => {
  try {
    const events = (req.body && req.body.events) || [];
    // LINE's "Verify" button posts an empty events array.
    if (events.length === 0) {
      res.status(200).send("OK");
      return;
    }
    if (events[0].type === "message" && events[0].message.type === "text") {
      const responseText = await handle_message(req.body);
      await reply(req.body, responseText);
    } else {
      res.status(200).send("Event type not supported");
      return;
    }
    res.status(200).send("Message processed successfully");
  } catch (error) {
    console.error("Error processing message:", error.response ? error.response.status : "", error.message);
    res.status(500).send("Error processing message");
  }
});

async function handle_message(event) {
  try {
    const { ticker, engine, period } = parseRequest(event.events[0].message.text);

    // /help command
    if (ticker === "/HELP" || ticker === "HELP") {
      return HELP_TEXT;
    }

    console.log(`Analysing ${ticker} engine=${engine} period=${period}`);

    const response = await axios.post(
      `${API_URL}/stock_analysis`,
      { ticker, period, engine },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
      },
    );

    const data = response.data;
    return data.engine === "v1" ? formatV1(ticker, data) : formatV2(ticker, data);
  } catch (err) {
    const apiError =
      err.response && err.response.data && err.response.data.error;
    // Log status + message only: the full axios error carries the request
    // config, including the x-api-key header.
    console.error(
      "handle_message error:",
      err.response ? err.response.status : "",
      apiError || err.message,
    );
    return `❌ Error: ${apiError || err.message}`;
  }
}

const reply = (bodyResponse, responseText) => {
  return axios.post(
    `${LINE_MESSAGING_API}/reply`,
    {
      replyToken: bodyResponse.events[0].replyToken,
      messages: [{ type: "text", text: responseText }],
    },
    { headers: LINE_HEADER },
  );
};
