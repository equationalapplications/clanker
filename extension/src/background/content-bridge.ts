import type { SingleAction } from '../shared/dsl-types.js'
import type { Injector } from './task-dispatcher.js'
import { runActionInPage } from '../content/executor.js'

function originPattern(url: string): string {
  try { return new URL(url).origin + '/*' } catch { return url }
}

async function ensureHost(url: string): Promise<void> {
  const origins = [originPattern(url)]
  if (await chrome.permissions.contains({ origins })) return
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title: 'Clanker needs access',
    message: `Clanker needs access to ${new URL(url).host}. Click to grant.`,
  })
  throw new Error('HOST_PERMISSION_REQUIRED')
}

async function activeTab(): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('EXECUTION_ERROR: no active tab')
  return { id: tab.id, url: tab.url ?? '' }
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
    async runInActiveTab(action: SingleAction) {
      const tab = await activeTab()
      if (tab.url) await ensureHost(tab.url)
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runActionInPage as unknown as (...a: unknown[]) => unknown,
        args: [action],
      })
      const out = res?.result as { data: Record<string, string>; activeUrl: string } | undefined
      if (!out) throw new Error('EXECUTION_ERROR: empty injection result')
      return out
    },
  }
}
