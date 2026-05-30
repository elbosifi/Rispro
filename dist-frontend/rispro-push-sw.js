self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = String(payload.title || "RISpro");
  const body = String(payload.body || "");
  const clickUrl = String(payload.clickUrl || "/");
  const eventType = String(payload.eventType || "");

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { clickUrl, eventType },
      tag: eventType ? `rispro-${eventType}` : "rispro-notification",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const clickUrl = new URL(String(event.notification.data?.clickUrl || "/"), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client && client.url === clickUrl) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(clickUrl);
      return undefined;
    })
  );
});
