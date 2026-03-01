// netlify/functions/send-push.js
const webpush = require("web-push");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function normalizeVapidSubject(subject) {
  const s = String(subject || "").trim();
  if (!s) return "mailto:sp77249.redmyre@gmail.com";
  // 이미 mailto:면 그대로
  if (s.toLowerCase().startsWith("mailto:")) return s;
  // 그냥 이메일이면 mailto: 붙이기
  if (s.includes("@") && !s.includes("://")) return `mailto:${s}`;
  // 그 외는 그대로 (https://... 같은 것도 허용)
  return s;
}

function safeJsonParse(raw) {
  if (!raw) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function validateSubscription(sub) {
  if (!sub || typeof sub !== "object") return "subscription is missing or not an object";
  if (!sub.endpoint || typeof sub.endpoint !== "string") return "subscription.endpoint is missing";
  if (!sub.keys || typeof sub.keys !== "object") return "subscription.keys is missing";
  if (!sub.keys.p256dh || typeof sub.keys.p256dh !== "string") return "subscription.keys.p256dh is missing";
  if (!sub.keys.auth || typeof sub.keys.auth !== "string") return "subscription.keys.auth is missing";
  return null;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "ok" };
  }

  // Only POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Method Not Allowed" };
  }

  // --- ENV ---
  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = normalizeVapidSubject(process.env.VAPID_SUBJECT);

  // 디버그(핵심만)
  console.log(
    "ENV keys present:",
    JSON.stringify(
      {
        VAPID_PUBLIC_KEY: !!VAPID_PUBLIC,
        VAPID_PRIVATE_KEY: !!VAPID_PRIVATE,
        VAPID_SUBJECT: !!process.env.VAPID_SUBJECT,
        VAPID_SUBJECT_EFFECTIVE: VAPID_SUBJECT,
      },
      null,
      2
    )
  );

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("Missing VAPID keys");
    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          ok: false,
          error: "Missing VAPID keys",
          hint: "Netlify Environment variables에 VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY가 있어야 합니다.",
        },
        null,
        2
      ),
    };
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    // --- BODY PARSE ---
    const rawBody = event.body || "";
    const parsed = safeJsonParse(rawBody);
    if (!parsed.ok) {
      console.error("JSON parse error:", String(parsed.error));
      return {
        statusCode: 400,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            ok: false,
            error: "Invalid JSON body",
            hint: "ReqBin Body 탭에서 JSON 선택 후, 중괄호 { } 포함해서 JSON 형태로 보내야 합니다.",
          },
          null,
          2
        ),
      };
    }

    const bodyObj = parsed.value || {};
    const subscription = bodyObj.subscription;
    const title = bodyObj.title || "Redmyre House";
    const message = bodyObj.message || bodyObj.body || "New update available";
    const url = bodyObj.url || "https://sca-redmyre.netlify.app";

    const subErr = validateSubscription(subscription);
    if (subErr) {
      console.error("Bad subscription:", subErr, "bodyObj keys:", Object.keys(bodyObj || {}));
      return {
        statusCode: 400,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            ok: false,
            error: subErr,
            hint: "Body에 subscription 객체(endpoint/keys.p256dh/keys.auth)가 반드시 포함되어야 합니다.",
          },
          null,
          2
        ),
      };
    }

    console.log("Subscription endpoint:", subscription.endpoint);
    const payload = JSON.stringify({ title, body: message, url });
    console.log("Payload:", payload);

    await webpush.sendNotification(subscription, payload);

    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }, null, 2),
    };
  } catch (e) {
    // web-push가 던지는 WebPushError는 statusCode/body/endpoint가 붙어있음
    const details = {
      name: e?.name,
      message: e?.message || String(e),
      statusCode: e?.statusCode,
      endpoint: e?.endpoint,
      responseBody: e?.body,
    };

    console.error("send-push error detailed:", JSON.stringify(details, null, 2));
    if (e?.stack) console.error("stack:", e.stack);

    // ✅ 특히 403이면 거의 100% “subscription 만든 VAPID와 서버 VAPID 불일치”
    const hint403 =
      details.statusCode === 403
        ? "403이면: 현재 서버(Netlify ENV)의 VAPID_PUBLIC/PRIVATE가 'subscription 생성에 사용된 PUBLIC KEY'와 불일치입니다. 반드시 '같은 PUBLIC KEY'로 구독을 새로 만들어야 합니다."
        : undefined;

    // ✅ 410/404면 구독 만료/삭제 -> 새 구독 필요
    const hint410 =
      details.statusCode === 410 || details.statusCode === 404
        ? "410/404면: subscription이 만료되었거나 삭제됨. 브라우저에서 구독(subscription) 다시 생성해야 합니다."
        : undefined;

    return {
      statusCode: 500,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          ok: false,
          error: details,
          hint: hint403 || hint410 || "Netlify Logs에서 위 error 상세를 확인하세요.",
        },
        null,
        2
      ),
    };
  }
};
