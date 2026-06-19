# machines file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  authMachine --> googleSignin
  authMachine --> appleSignin
  authMachine --> bootstrapSession
  authMachine --> crashlyticsService
  characterMachine --> characterService
  characterMachine --> characterDatabase
  characterMachine --> characterSyncService
  characterMachine --> defaultAvatarService
  characterMachine --> wikiOrchestrator
  termsMachine --> apiClient
  termsMachine --> bootstrapSession
  wikiMachine --> wikiService
```
