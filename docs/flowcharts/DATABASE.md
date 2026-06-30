# database file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  characterDatabase --> index
  characterDatabase --> voiceDefaults
  index --> sqliteWebWorker
  index --> opfsRecovery
  index --> wikiService
  messageDatabase --> index
  taskDatabase --> index
  webLifecycle.web --> index
  webLifecycle.web --> sqliteWebWorker
```
