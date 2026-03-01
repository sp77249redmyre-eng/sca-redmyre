/* sw.js - Push Service Worker (with logs + non-JSON payload support) */

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

  const normalize = (obj = {}) => ({
    title: obj.title || "SCA Redmyre",
    body: obj.body || "New update",
    url: obj.url || "/",
  });

  event.waitUntil((async () => {
    let payload = {};

    try {
      if (!event.data) {
        console.log("[SW] push event has no data");
        payload = {};
      } else {
        // 1) JSON 먼저 시도
        try {
          payload = event.data.json();
          console.log("[SW] push payload JSON:", payload);
        } catch (eJson) {
          // 2) JSON 실패 시 text로 처리
          try {
            const text = await event.data.text();
            console.log("[SW] push payload is not JSON, treating as plain text:", text);
            payload = { body: text };
          } catch (eText) {
            console.log("[SW] push text read failed, using empty payload", eText);
            payload = {};
          }
        }
      }
    } catch (e) {
      console.log("[SW] push handler failed, using empty payload", e);
      payload = {};
    }

    const p = normalize(payload);
    console.log("[SW] normalized payload:", p);

    const options = {
      body: p.body,
      icon: "/icon-192-v3.png?v=5",
      badge: "/icon-192-v3.png?v=5",
      data: { url: p.url },
    };

    return self.registration.showNotification(p.title, options)
      .then(() => console.log("[SW] showNotification OK"))
      .catch((e) => console.error("[SW] showNotification FAIL", e));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url =
    (event.notification && event.notification.data && event.notification.data.url)
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
      } catch (e) {
        console.log("[SW] client focus/navigate failed", e);
      }
    }

    await clients.openWindow(url);
  })());
});
