import type { SingleAction } from '../shared/dsl-types.js'
import type { Injector } from './task-dispatcher.js'

function originPattern(url: string): string {
  try { return new URL(url).origin + '/*' } catch { return url }
}

const HOST_PERMISSION_NOTIFICATION = 'host-permission'

async function ensureHost(url: string): Promise<void> {
  const origin = originPattern(url)
  const origins = [origin]
  if (await chrome.permissions.contains({ origins })) return
  const host = new URL(url).host
  await chrome.storage.local.set({ pendingHost: host, pendingOrigin: origin })
  chrome.notifications.create(HOST_PERMISSION_NOTIFICATION, {
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title: 'Clanker needs access',
    message: `Clanker needs access to ${host}. Click to grant.`,
  })
  throw new Error('HOST_PERMISSION_REQUIRED')
}

async function activeTab(): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('EXECUTION_ERROR: no active tab')
  return { id: tab.id, url: tab.url ?? '' }
}

type ContentResponse =
  | { data: Record<string, string>; activeUrl: string }
  | { awaitingAuth: true }
  | { error: string }

function sendActionToTab(
  tabId: number,
  action: SingleAction,
  ctx: { skipLayerTwo?: boolean },
): Promise<{ data: Record<string, string>; activeUrl: string } | { awaitingAuth: true }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'CLANKER_RUN_ACTION', action, ctx }, (response: ContentResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error('EXECUTION_ERROR: ' + (chrome.runtime.lastError.message ?? 'no response from content script')))
        return
      }
      if (!response) {
        reject(new Error('EXECUTION_ERROR: empty response from content script'))
        return
      }
      if ('error' in response) {
        reject(new Error(response.error))
        return
      }
      if ('awaitingAuth' in response) {
        resolve({ awaitingAuth: true as const })
        return
      }
      resolve(response)
    })
  })
}

export function createInjector(): Injector {
  return {
    async openTab(url: string) {
      await ensureHost(url)
      await chrome.tabs.create({ url, active: true })
    },
    async focusTab(host: string) {
      const tabs = await chrome.tabs.query({})
      const match = tabs.find((t) => { try { return new URL(t.url ?? '').host === host } catch { return false } })
      if (!match?.id) throw new Error('EXECUTION_ERROR: no tab for host')
      await chrome.tabs.update(match.id, { active: true })
    },
    async runInActiveTab(action: SingleAction, ctx: { skipLayerTwo?: boolean } = {}) {
      const tab = await activeTab()
      if (tab.url) await ensureHost(tab.url)
      // Inject the executor content script (idempotent — guarded by window.__clankerInjected)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/executor.js'],
      })
      return sendActionToTab(tab.id, action, ctx)
    },
  }
}
