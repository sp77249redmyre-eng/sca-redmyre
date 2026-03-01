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
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.log("[SW] push payload parse failed, using empty payload", e);
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
