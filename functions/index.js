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
  `  AAPL 30d\n` +
  `  PTT.BK 6mo\n\n` +
  `Supported periods: 30d, 60d, 90d, 6mo, 1y\n\n` +
  `The analysis includes:\n` +
  `  • BUY / SELL / HOLD recommendation\n` +
  `  • Confidence score & strength\n` +
  `  • RSI, MACD, Bollinger Bands\n` +
  `  • Stochastic Oscillator & OBV\n` +
  `  • ADX trend strength`;

exports.LineBot = functions.https.onRequest(async (req, res) => {
  try {
    if (req.body.events[0].message.type === "text") {
      const responseText = await handle_message(req.body);
      await reply(req.body, responseText);
    } else {
      res.status(200).send("Event type not supported");
      return;
    }
    res.status(200).send("Message processed successfully");
  } catch (error) {
    console.error("Error processing message: ", error);
    res.status(500).send("Error processing message");
  }
});

async function handle_message(event) {
  try {
    const msg_from_user = event.events[0].message.text.trim();
    const extracted = msg_from_user.split(" ");
    const ticker = extracted[0].toUpperCase();
    const period = extracted[1] || "90d";

    // /help command
    if (ticker === "/HELP" || ticker === "HELP") {
      return HELP_TEXT;
    }

    console.log(`Analysing ${ticker} period=${period}`);

    const response = await axios.post(
      `${API_URL}/stock_analysis`,
      { ticker, period },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
      },
    );

    const data = response.data;
    const d = data.details;

    const emoji_map = { BUY: "🟢", SELL: "🔴", HOLD: "🟡" };
    const reco_emoji = emoji_map[data.recommendation] || "⚪";

    return (
      `📊 ${ticker} — Stock Analysis\n\n` +
      `${reco_emoji} ${data.recommendation} (${data.strength}, ${data.confidence}%)\n` +
      `📡 Trend: ${data.trend_strength}\n\n` +
      `— Trend Indicators —\n` +
      `📈 SMA: ${d.SMA_Signal}\n` +
      `📉 EMA: ${d.EMA_Signal}\n` +
      `📊 MACD: ${d.MACD.value} (${d.MACD.signal})\n\n` +
      `— Momentum Indicators —\n` +
      `💡 RSI: ${d.RSI.value} → ${d.RSI.signal}\n` +
      `🎯 Stochastic: %K ${d.Stochastic.K} / %D ${d.Stochastic.D} → ${d.Stochastic.signal}\n\n` +
      `— Volatility & Volume —\n` +
      `📉 Bollinger: ${d.BollingerBands.signal} (close ${d.BollingerBands.close})\n` +
      `🔥 ATR(14): ${d.ATR14.value}\n` +
      `📦 OBV: ${d.OBV.signal}`
    );
  } catch (err) {
    console.error("handle_message error:", err);
    const apiError =
      err.response && err.response.data && err.response.data.error;
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
