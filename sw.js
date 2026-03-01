/* sw.js - Push Service Worker (with logs) */

self.addEventListener("install", (event) => {
  console.log("[SW] install");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] activate");
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.log("[SW] push event received");

  let data = {};
  let text = "";

  // 1) 먼저 "텍스트"로 안전하게 읽기 (JSON 아니어도 안 터짐)
  try {
    text = event.data ? event.data.text() : "";
  } catch (e) {
    console.log("[SW] push text read failed", e);
    text = "";
  }

  // 2) 텍스트가 있으면 JSON 파싱 시도, 실패하면 그냥 본문으로 처리
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("[SW] payload is not JSON, treating as plain text:", text);
      data = { title: "SCA Redmyre", body: text, url: "/" };
    }
  } else {
    data = {};
  }

  console.log("[SW] push payload:", data);

  const title = data.title || "SCA Redmyre";
  const options = {
    body: data.body || "New update",
    icon: "/icon-192-v3.png?v=5",
    badge: "/icon-192-v3.png?v=5",
    data: { url: (data.url || "/") }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification?.data && event.notification.data.url)
      ? event.notification.data.url
      : "/";

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of allClients) {
      try {
        if (c.url && c.url.startsWith(self.location.origin)) {
          await c.focus();
          await c.navigate(url);
          return;
        }
      } catch {}
    }
    await clients.openWindow(url);
  })());
});
