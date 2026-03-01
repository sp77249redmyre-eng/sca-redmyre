/* sw.js - Push Service Worker */

self.addEventListener("install", (event) => {
  // Immediately activate new SW
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all clients immediately
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { 
    data = event.data ? event.data.json() : {}; 
  } catch { 
    data = {}; 
  }

  const title = data.title || "SCA Redmyre";
  const options = {
    body: data.body || "New update",
    icon: "/icon-192-v3.png?v=4",
    badge: "/icon-192-v3.png?v=4",
    data: { url: (data.url || "/") }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification?.data && event.notification.data.url) 
    ? event.notification.data.url 
    : "/";

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ 
      type: "window", 
      includeUncontrolled: true 
    });

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
