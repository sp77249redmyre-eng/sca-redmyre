import webpush from "web-push";

webpush.setVapidDetails(
  "mailto:sca.jacob77@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { subscription, title, body } = JSON.parse(event.body);

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
}
