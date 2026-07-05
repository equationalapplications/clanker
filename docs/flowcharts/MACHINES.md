# machines file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  authMachine --> googleSignin
  authMachine --> appleSignin
  authMachine --> bootstrapSession
  authMachine --> crashlyticsService
  authMachine --> analyticsService
  characterMachine --> characterService
  characterMachine --> characterDatabase
  characterMachine --> characterSyncService
  characterMachine --> defaultAvatarService
  characterMachine --> wikiOrchestrator
  characterMachine --> ensureDevSandboxCharacter
  liveVoiceMachine --> analyticsService
  liveVoiceMachine --> ensureDevSandboxCharacter
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
