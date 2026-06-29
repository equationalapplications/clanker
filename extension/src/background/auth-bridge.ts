const OFFSCREEN_PATH = 'offscreen/auth.html'

export async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
    justification: 'Required to host Firebase Web Auth SDK which relies on DOM storage APIs',
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
