// Diamond Daily — service worker: push notifications.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { /* ignore */ }
  const title = data.title || 'Diamond Daily';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        try {
          if (new URL(w.url).origin === self.location.origin) {
            w.navigate(url);
            return w.focus();
          }
        } catch (e) { /* ignore */ }
      }
      return clients.openWindow(url);
    })
  );
});
