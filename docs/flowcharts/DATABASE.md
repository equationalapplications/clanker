# database file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._

```mermaid
graph LR
  characterDatabase --> index
  characterDatabase --> voiceDefaults
  characterImageDatabase --> index
  index --> sqliteWebWorker
  index --> opfsRecovery
  index --> wikiService
  messageDatabase --> index
  migrateAvatarsToImageStore --> index
  migrateAvatarsToImageStore --> characterImageDatabase
  migrateAvatarsToImageStore --> characterImageSyncService
  migrateAvatarsToImageStore --> imageVariants
  taskDatabase --> index
  webLifecycle.web --> sqliteWebWorker
  webLifecycle.web --> index
```
