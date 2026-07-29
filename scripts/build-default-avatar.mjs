/**
 * One-off: crop assets/icon.png to the logo circle and emit the bundled default avatar.
 *
 * Geometry is measured, not guessed: the circle's widest row in icon.png is
 * y=493 spanning x=19…1004, giving a 986px diameter with its left edge at x=19.
 * Run with:  npm i -D --no-save sharp && node scripts/build-default-avatar.mjs
 */
import sharp from 'sharp'

const SRC = 'assets/icon.png'
const OUT = 'assets/default-avatar-1024.webp'

const CROP = { left: 19, top: 0, width: 986, height: 986 }

const info = await sharp(SRC).metadata()
if (info.width !== 1024 || info.height !== 1024) {
  throw new Error(`Expected ${SRC} to be 1024x1024, got ${info.width}x${info.height}`)
}

await sharp(SRC)
  .extract(CROP)
  .resize(1024, 1024, { fit: 'fill' })
  .webp({ quality: 90 })
  .toFile(OUT)

const out = await sharp(OUT).metadata()
console.log(`Wrote ${OUT}: ${out.width}x${out.height} ${out.format}`)
if (out.width !== 1024 || out.height !== 1024) {
  throw new Error('Output is not 1024x1024')
}
