# machines file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._

```mermaid
graph LR
  authMachine --> crashlyticsService
  authMachine --> analyticsService
  authMachine --> googleSignin
  authMachine --> appleSignin
  authMachine --> bootstrapSession
  authMachine --> lowPowerSession
  characterMachine --> devSandboxFlag
  characterMachine --> ensureDevSandboxCharacter
  characterMachine --> characterDatabase
  characterMachine --> wikiOrchestrator
  characterMachine --> characterImageSyncService
  characterMachine --> characterSyncService
  liveVoiceMachine --> analyticsService
  liveVoiceMachine --> groundingMetadata
  liveVoiceMachine --> characterWikiQueue
  liveVoiceMachine --> liveMemoryQuery
  liveVoiceMachine --> characterDatabase
  liveVoiceMachine --> devSandboxFlag
  liveVoiceMachine --> wikiService
  liveVoiceMachine --> wikiSourceType
  liveVoiceMachine --> apiClient
  liveVoiceMachine --> googleSignin
  liveVoiceMachine --> messageDatabase
  termsMachine --> analyticsService
  termsMachine --> apiClient
  wikiMachine --> wikiService
```
