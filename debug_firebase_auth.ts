import jwt from 'jsonwebtoken'

// Debug script to examine your current JWT token
// This will help us understand what's in the token that's failing

console.log('Firebase Auth Debug Script')
console.log('==========================\n')

// Test data based on your error logs
const firebaseId = 'vdZDYuwp7ORzPRkcgbelSTSSmJD2'
console.log('Firebase ID format:', firebaseId)
console.log('Firebase ID length:', firebaseId.length)
console.log(
  'Firebase ID is UUID format:',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firebaseId),
)
console.log('')

// If you have access to your JWT token, decode it to see what's inside
// Replace 'YOUR_JWT_TOKEN_HERE' with an actual token from your app
const exampleJWT = 'YOUR_JWT_TOKEN_HERE'

if (exampleJWT !== 'YOUR_JWT_TOKEN_HERE') {
  try {
    const decoded = jwt.decode(exampleJWT, { complete: true })
    console.log('JWT Header:', JSON.stringify(decoded?.header, null, 2))
    console.log('JWT Payload:', JSON.stringify(decoded?.payload, null, 2))
  } catch (error) {
    console.log('Error decoding JWT:', error)
  }
}

// Generate a sample UUID to show the format difference
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c == 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

console.log('Example UUID format:', generateUUID())
console.log('Your Firebase ID:   ', firebaseId)
console.log('')

// Check if we can parse the Firebase ID as different formats
console.log('Firebase ID as hex:', Buffer.from(firebaseId, 'utf8').toString('hex'))
console.log('Firebase ID as base64:', Buffer.from(firebaseId, 'utf8').toString('base64'))
