import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

const entries = {
  'background/service-worker': 'src/background/service-worker.ts',
  'offscreen/auth': 'src/offscreen/auth.ts',
  'content/executor': 'src/content/executor.ts',
  'ui/side-panel/panel': 'src/ui/side-panel/panel.ts',
  'ui/popup/popup': 'src/ui/popup/popup.ts',
}

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: entries,
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
})

for (const f of ['manifest.json']) cpSync(f, `dist/${f}`)
cpSync('icons', 'dist/icons', { recursive: true })
cpSync('src/offscreen/auth.html', 'dist/offscreen/auth.html')
cpSync('src/ui/side-panel/index.html', 'dist/ui/side-panel/index.html')
cpSync('src/ui/popup/index.html', 'dist/ui/popup/index.html')
console.log('extension built → dist/')
