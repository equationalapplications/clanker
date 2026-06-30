import { runActionInPage } from './executor.js'

declare const window: Window & { __clankerInjected?: boolean }

if (!window.__clankerInjected) {
  window.__clankerInjected = true
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if ((msg as { type?: string })?.type !== 'CLANKER_RUN_ACTION') return false
    const { action, ctx } = msg as { action: Parameters<typeof runActionInPage>[0]; ctx: Parameters<typeof runActionInPage>[1] }
    runActionInPage(action, ctx)
      .then(sendResponse)
      .catch((e: Error) => sendResponse({ error: e.message }))
    return true
  })
}
