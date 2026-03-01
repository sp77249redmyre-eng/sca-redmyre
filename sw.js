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

  const fallback = (obj = {}) => ({
    title: obj.title || "SCA Redmyre",
    body: obj.body || "New update",
    url: obj.url || "/",
  });

  event.waitUntil((async () => {
    let data = {};
    let text = "";

    try {
      if (event.data) {
        // 1) try JSON
        try {
          data = event.data.json();
          console.log("[SW] push payload JSON:", data);
        } catch (eJson) {
          // 2) fallback to text
          try {
            text = await event.data.text();
            console.log("[SW] push payload is not JSON, treating as plain text:", text);
            data = fallback({ body: text });
          } catch (eText) {
            console.log("[SW] push text read failed, using empty payload", eText);
            data = fallback({});
          }
        }
      } else {
        console.log("[SW] push event has no data");
        data = fallback({});
      }
    } catch (e) {
      console.log("[SW] push handler failed, using empty payload", e);
      data = fallback({});
    }

    // Normalize final payload
    const p = fallback(data || {});
    console.log("[SW] normalized payload:", p);

    const options = {
      body: p.body,
      icon: "/icon-192-v3.png?v=5",
      badge: "/icon-192-v3.png?v=5",
      data: { url: p.url },
    };

    await self.registration.showNotification(p.title, options);
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
      } catch {}
    }

    await clients.openWindow(url);
  })());
});
