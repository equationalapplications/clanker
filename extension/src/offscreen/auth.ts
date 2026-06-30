import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged } from 'firebase/auth/web-extension'
import { FIREBASE_CONFIG } from '../env.js'

const app = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)

// Wait for the first onAuthStateChanged event before serving token requests.
// IndexedDB persistence is async — auth.currentUser is null until the state loads.
let authReady: Promise<void> = new Promise((resolve) => {
  const unsub = onAuthStateChanged(auth, () => { unsub(); resolve() })
})

chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string }, _sender, sendResponse) => {
  if (msg.target !== 'offscreen-auth') return
  if (msg.type === 'GET_ID_TOKEN') {
    authReady.then(() => {
      const user = auth.currentUser
      if (!user) { sendResponse({ error: 'Not signed in' }); return }
      user.getIdToken(false).then((idToken) => sendResponse({ idToken })).catch((e) => sendResponse({ error: String(e) }))
    }).catch((e) => sendResponse({ error: String(e) }))
    return true
  }
  return undefined
})
