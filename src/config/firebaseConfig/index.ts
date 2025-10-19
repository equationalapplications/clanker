// This file exists only for TypeScript resolution
// At runtime, Metro will resolve to index.web.ts or index.native.ts

export type { FirebaseUser } from './index.web'

export {
    firebaseApp,
    getCurrentUser,
    onAuthStateChanged,
    signOut,
    exchangeToken,
    generateReplyFn,
    purchasePackageStripe,
} from './index.web'
