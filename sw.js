const CACHE_NAME = 'redmyre-bms-v5';
const VAPID_PUBLIC_KEY = 'BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Redmyre House', body: e.data.text() }; }

  const title = data.title || 'Redmyre House';
  const options = {
    body: data.body || '',
    icon: '/icon-192-v3.png',
    badge: '/favicon-32-v3.png',
    tag: data.tag || 'redmyre-notification',
    data: { url: data.url || '/announcements.html' },
    requireInteraction: false,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/announcements.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
