# machines file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  authMachine --> googleSignin
  authMachine --> appleSignin
  authMachine --> bootstrapSession
  authMachine --> crashlyticsService
  authMachine --> analyticsService
  authMachine --> lowPowerSession
  characterMachine --> characterService
  characterMachine --> characterDatabase
  characterMachine --> characterSyncService
  characterMachine --> characterImageSyncService
  characterMachine --> wikiOrchestrator
  characterMachine --> devSandboxFlag
  liveVoiceMachine --> analyticsService
  liveVoiceMachine --> devSandboxFlag
  liveVoiceMachine --> wikiService
  liveVoiceMachine --> apiClient
  liveVoiceMachine --> wikiSourceType
  liveVoiceMachine --> messageDatabase
  liveVoiceMachine --> characterDatabase
  liveVoiceMachine --> groundingMetadata
  liveVoiceMachine --> aiChatService
  liveVoiceMachine --> characterWikiQueue
  liveVoiceMachine --> liveMemoryQuery
  termsMachine --> apiClient
  termsMachine --> analyticsService
  termsMachine --> bootstrapSession
  wikiMachine --> wikiService
```
