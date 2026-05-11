# machines call graph + import fallback

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  abortableSleep__src_machines_wikiMachine_ts["abortableSleep
(wikiMachine.ts)"] --> abortErrorFromSignal__src_machines_wikiMachine_ts["abortErrorFromSignal
(wikiMachine.ts)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __config_firebaseConfig["firebaseConfig
(config)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __auth_googleSignin["googleSignin
(auth)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __auth_appleSignin["appleSignin
(auth)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __auth_bootstrapSession["bootstrapSession
(auth)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __config_revenueCatConfig["revenueCatConfig
(config)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __services_crashlyticsService["crashlyticsService
(services)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __config_queryClient["queryClient
(config)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __config_queryPersister["queryPersister
(config)"]
  authMachine__src_machines_authMachine_ts["authMachine
(authMachine.ts)"] --> __utilities_settingsStorage["settingsStorage
(utilities)"]
  characterMachine__src_machines_characterMachine_ts["characterMachine
(characterMachine.ts)"] --> __services_characterService["characterService
(services)"]
  characterMachine__src_machines_characterMachine_ts["characterMachine
(characterMachine.ts)"] --> __database_characterDatabase["characterDatabase
(database)"]
  characterMachine__src_machines_characterMachine_ts["characterMachine
(characterMachine.ts)"] --> __services_characterSyncService["characterSyncService
(services)"]
  characterMachine__src_machines_characterMachine_ts["characterMachine
(characterMachine.ts)"] --> __constants_voiceDefaults["voiceDefaults
(constants)"]
  characterMachine__src_machines_characterMachine_ts["characterMachine
(characterMachine.ts)"] --> __services_defaultAvatarService["defaultAvatarService
(services)"]
  characterMachine__src_machines_characterMachine_ts["characterMachine
(characterMachine.ts)"] --> __services_wikiOrchestrator["wikiOrchestrator
(services)"]
  termsMachine__src_machines_termsMachine_ts["termsMachine
(termsMachine.ts)"] --> __config_termsConfig["termsConfig
(config)"]
  termsMachine__src_machines_termsMachine_ts["termsMachine
(termsMachine.ts)"] --> __services_apiClient["apiClient
(services)"]
  termsMachine__src_machines_termsMachine_ts["termsMachine
(termsMachine.ts)"] --> __auth_bootstrapSession["bootstrapSession
(auth)"]
```

> **Note:** Edges involving Firebase callable functions (created via `httpsCallable()`) are
> not captured here. Because callables are instantiated at module scope and invoked indirectly,
> static analysis cannot trace them as call edges. Affected call sites include
> `generateReplyFn`, `generateVoiceReplyFn`, `summarizeTextFn`, and similar callable wrappers.
