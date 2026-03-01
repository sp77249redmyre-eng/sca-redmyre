// netlify/functions/send-push.js
const webpush = require("web-push");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "ok" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT =
      process.env.VAPID_SUBJECT || "mailto:sp77249.redmyre@gmail.com";

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return { statusCode: 500, headers: cors, body: "Missing VAPID keys" };
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const body = event.body ? JSON.parse(event.body) : {};
    const subscription = body.subscription;
    const title = body.title || "Redmyre House";
    const message = body.message || body.body || "New update available";
    const url = body.url || "https://sca-redmyre.netlify.app";

    if (!subscription) {
      return {
        statusCode: 400,
        headers: cors,
        body: "Missing subscription in request body",
      };
    }

    const payload = JSON.stringify({ title, body: message, url });

    await webpush.sendNotification(subscription, payload);

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(e?.message || e) }),
    };
  }
};
