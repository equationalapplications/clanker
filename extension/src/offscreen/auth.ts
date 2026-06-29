import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { FIREBASE_CONFIG } from '../env.js'

const app = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)
void setPersistence(auth, browserLocalPersistence)

chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string }, _sender, sendResponse) => {
  if (msg.target !== 'offscreen-auth') return
  if (msg.type === 'GET_ID_TOKEN') {
    const user = auth.currentUser
    if (!user) { sendResponse({ error: 'Not signed in' }); return true }
    user.getIdToken(false).then((idToken) => sendResponse({ idToken })).catch((e) => sendResponse({ error: String(e) }))
    return true
  }
  return undefined
})
