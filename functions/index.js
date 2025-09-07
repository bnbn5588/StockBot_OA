/* eslint-disable linebreak-style */
/* eslint-disable object-curly-spacing */
/* eslint-disable spaced-comment */
/* eslint-disable quote-props */
/* eslint-disable comma-dangle */
/* eslint-disable indent */
/* eslint-disable operator-linebreak */
/* eslint-disable linebreak-style */
/* eslint-disable camelcase */
/* eslint-disable max-len */
/* eslint-disable require-jsdoc */

const functions = require("firebase-functions/v1");
const request = require("request-promise");
const axios = require("axios");

require("dotenv").config(); // Load .env file

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

const LINE_MESSAGING_API = "https://api.line.me/v2/bot/message";
const LINE_HEADER = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.LB_KEY}`,
};

exports.LineBot = functions.https.onRequest(async (req, res) => {
  const userId = req.body.events[0].source.userId;

  try {
    if (req.body.events[0].message.type === "text") {
      const responseText = await handle_message(req.body, userId);
      await reply(req.body, responseText);
    } else {
      res.status(200).send("Event type not supported");
      return;
    }

    // Send a success response to Line after processing
    res.status(200).send("Message processed successfully");
  } catch (error) {
    console.error("Error processing message: ", error);
    res.status(500).send("Error processing message");
  }
});

async function handle_message(event) {
  let res_message = "-";

  try {
    const msg_from_user = event.events[0].message.text.trim();
    // const userid = event.events[0].source.userId;
    const extracted = msg_from_user.split(" ");
    const inst_from_user = extracted[0].toUpperCase();

    console.log(inst_from_user);

    if (inst_from_user != null) {
      try {
        const response = await axios.post(
          `${API_URL}/stock_analysis`,
          {
            ticker: extracted[0],
            period: "90d",
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": API_KEY,
            },
          }
        );
        const data = response.data;
        const res_message =
          `📊 Stock Analysis Result\n\n` +
          `📌 Recommendation: ${data.recommendation}\n\n` +
          `📈 SMA Signal: ${data.details.SMA_Signal}\n` +
          `📉 EMA Signal: ${data.details.EMA_Signal}\n` +
          `💡 RSI: ${data.details.RSI.value} (${data.details.RSI.signal})\n` +
          `📊 MACD: ${data.details.MACD.value} (${data.details.MACD.signal})\n` +
          `🔥 ATR(14): ${data.details.ATR14.value} (${data.details.ATR14.description})`;

        return res_message;
      } catch (error) {
        res_message = error.message;
      }
    }
  } catch (err) {
    console.error(err);
    res_message = err;
  }

  return res_message;
}

const reply = (bodyResponse, responseText) => {
  return request({
    method: "POST",
    uri: `${LINE_MESSAGING_API}/reply`,
    headers: LINE_HEADER,
    body: JSON.stringify({
      replyToken: bodyResponse.events[0].replyToken,
      messages: [
        {
          type: "text",
          text: responseText, // Use the response text received as an argument
        },
      ],
    }),
  });
};
