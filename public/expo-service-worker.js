/* global self */

/**
 * Expo web push service worker (Metro export; no Workbox companion).
 * Handles push display and notification click routing for expo-notifications.
 */

self.addEventListener('message', (event) => {
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
    if (data?.fromExpoWebClient) return
    if (data?.notificationIcon) {
      self.notificationIcon = data.notificationIcon
    }
  } catch {
    // Ignore malformed messages.
  }
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { title: '', body: event.data?.text() ?? '' }
  }

  const title = payload.title ?? ''
  const options = {
    body: payload.body ?? '',
    data: payload.data ?? {},
    icon: payload.data?._icon ?? self.notificationIcon ?? null,
  }
  if (payload.data?._tag) {
    options.tag = payload.data._tag
    options.renotify = payload.data._renotify
  }
  if (payload.data?._richContent?.image) {
    options.image = payload.data._richContent.image
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  event.waitUntil(
    (async () => {
      const path = event.notification.data?._webPath || '/'
      const allClients = await self.clients.matchAll({ includeUncontrolled: true })

      for (const client of allClients) {
        const url = new URL(client.url)
        if (url.pathname === path) {
          client.focus()
          client.postMessage({
            origin: 'selected',
            data: event.notification.data,
            remote: !event.notification.data?._isLocal,
          })
          return
        }
      }

      const appClient = await self.clients.openWindow(path)
      appClient?.postMessage({
        origin: 'selected',
        data: event.notification.data,
        remote: !event.notification.data?._isLocal,
      })
    })(),
  )
})
