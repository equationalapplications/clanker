# machines import dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph TD
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
