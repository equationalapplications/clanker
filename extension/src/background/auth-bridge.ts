const OFFSCREEN_PATH = 'offscreen/auth.html'

export async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
    justification:
      'Hosts Firebase Auth Web SDK (firebase/auth/web-extension). MV3 service workers ' +
      'cannot access DOM storage APIs required for auth token persistence. ' +
      'The offscreen document provides this context without exposing credentials ' +
      'to the service worker global scope.',
  })
}

export async function requestIdToken(): Promise<string> {
  await ensureOffscreen()
  const res = (await chrome.runtime.sendMessage({ target: 'offscreen-auth', type: 'GET_ID_TOKEN' })) as { idToken?: string; error?: string } | undefined
  if (!res?.idToken) throw new Error(res?.error ?? 'Not signed in. Open the side panel to sign in.')
  return res.idToken
}

export async function closeOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument()
}
