self.addEventListener('push', (event) => {
  let data = { title: 'Новое сообщение', body: 'У вас новое уведомление в chat-iK', url: '/' };
  try {
    data = event.data.json();
  } catch (e) {
    console.error('Push data error:', e);
  }

  const show = async () => {
    let currentUserId = self.currentUserId;
    if (!currentUserId) {
      try {
        const cache = await caches.open('chatik-meta');
        const resp = await cache.match('/__uid');
        if (resp) currentUserId = (await resp.text()) || null;
      } catch (e) {}
    }
    if (data.sender_id && currentUserId && data.sender_id === currentUserId) return;

    const options = {
      body: data.body,
      icon: '/logo192.png',
      badge: '/logo192.png',
      vibrate: [100, 50, 100],
      data: {
        url: data.url || '/'
      }
    };
    await self.registration.showNotification(data.title, options);
  };

  event.waitUntil(show());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});

// Skip waiting and claim clients
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'set-user') {
    const userId = event.data.userId || '';
    self.currentUserId = userId;
    event.waitUntil(
      caches.open('chatik-meta').then(cache => cache.put('/__uid', new Response(userId)))
    );
  }
  if (event.data?.type === 'clear-user') {
    self.currentUserId = null;
    event.waitUntil(
      caches.open('chatik-meta').then(cache => cache.put('/__uid', new Response('')))
    );
  }
});
