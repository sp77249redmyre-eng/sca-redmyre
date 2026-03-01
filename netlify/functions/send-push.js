// netlify/functions/send-push.js
const webpush = require("web-push");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

exports.handler = async (event) => {
  // ✅ 디버그 로그(무조건 찍히게)
  console.log("HTTP Method:", event.httpMethod);
  console.log("Headers:", JSON.stringify(event.headers || {}, null, 2));
  console.log("Raw body:", event.body);
  console.log(
    "ENV keys present:",
    JSON.stringify(
      {
        VAPID_PUBLIC_KEY: !!process.env.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: !!process.env.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: !!process.env.VAPID_SUBJECT,
      },
      null,
      2
    )
  );

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "ok" };
  }

  // Only POST allowed
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  try {
    const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT =
      process.env.VAPID_SUBJECT || "mailto:sp77249.redmyre@gmail.com";

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.error("Missing VAPID keys", {
        VAPID_PUBLIC: !!VAPID_PUBLIC,
        VAPID_PRIVATE: !!VAPID_PRIVATE,
      });
      return { statusCode: 500, headers: cors, body: "Missing VAPID keys" };
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    // ✅ Body parsing (JSON 아니면 에러 로그가 나오게)
    let bodyObj = {};
    if (event.body) {
      try {
        bodyObj = JSON.parse(event.body);
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
        return {
          statusCode: 400,
          headers: { ...cors, "Content-Type": "application/json" },
          body: JSON.stringify({
            ok: false,
            error: "Invalid JSON body",
          }),
        };
      }
    }

    const subscription = bodyObj.subscription;
    const title = bodyObj.title || "Redmyre House";
    const message =
      bodyObj.message || bodyObj.body || "New update available";
    const url = bodyObj.url || "https://sca-redmyre.netlify.app";

    // ✅ subscription 필수 체크 + subscription 내용 로그
    if (!subscription) {
      console.error("Missing subscription in request body. bodyObj=", bodyObj);
      return {
        statusCode: 400,
        headers: cors,
        body: "Missing subscription in request body",
      };
    }

    console.log("Subscription received:", JSON.stringify(subscription, null, 2));

    const payload = JSON.stringify({ title, body: message, url });
    console.log("Payload:", payload);

    // ✅ 실제 전송
    await webpush.sendNotification(subscription, payload);

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    // ✅ 여기서 진짜 원인 찍힘
    console.error("send-push error:", e);
    console.error("send-push error (string):", String(e?.stack || e));

    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: String(e?.message || e),
      }),
    };
  }
};
