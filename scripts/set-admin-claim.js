#!/usr/bin/env node

const admin = require('firebase-admin')

async function main() {
  const email = process.argv[2]?.trim()
  const maybeFlag = process.argv[3]?.trim()

  if (!email) {
    console.error('Usage: node scripts/set-admin-claim.js <email> [--revoke]')
    process.exitCode = 1
    return
  }

  const revoke = maybeFlag === '--revoke'
  if (maybeFlag && !revoke) {
    console.error(`Unknown flag: ${maybeFlag}`)
    console.error('Usage: node scripts/set-admin-claim.js <email> [--revoke]')
    process.exitCode = 1
    return
  }

  if (!admin.apps.length) {
    admin.initializeApp()
  }

  const user = await admin.auth().getUserByEmail(email)
  const existingClaims = user.customClaims ?? {}
  const nextClaims = { ...existingClaims }

  if (revoke) {
    delete nextClaims.admin
  } else {
    nextClaims.admin = true
  }

  await admin.auth().setCustomUserClaims(user.uid, nextClaims)

  const action = revoke ? 'revoked' : 'granted'
  console.log(`Admin claim ${action} for ${email} (uid: ${user.uid}).`)
}

main().catch((error) => {
  console.error('Failed to update admin claim:', error)
  process.exitCode = 1
})
