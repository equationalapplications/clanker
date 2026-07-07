# services file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  edgeAgentEvals.int.test --> CharacterPromptBuilder
  aiChatService --> devSandboxFlag
  aiChatService --> messageDatabase
  aiChatService --> characterDatabase
  aiChatService --> summarizeTextService
  aiChatService --> messageService
  aiChatService --> CharacterPromptBuilder
  aiChatService --> chatReplyService
  apiClient --> bootstrapSession
  characterService --> googleSignin
  characterService --> characterDatabase
  characterService --> analyticsService
  characterSyncService --> characterDatabase
  characterSyncService --> wikiService
  characterSyncService --> wikiSourceType
  characterSyncService --> apiClient
  characterSyncService --> wikiOrchestrator
  characterSyncService --> devSandboxFlag
  characterSyncService --> googleSignin
  characterSyncService --> voiceDefaults
  chatReplyService --> groundingMetadata
  cloudAgentService --> googleSignin
  cloudAgentService --> groundingMetadata
  edgeToolExecutors --> wikiService
  edgeToolExecutors --> taskDatabase
  liveMemoryQuery --> aiChatService
  liveMemoryQuery --> messageDatabase
  liveMemoryQuery --> characterDatabase
  localImageStorageService --> index
  messageService --> messageDatabase
  messageService --> analyticsService
  userService --> apiClient
  wikiLlmProvider --> devSandboxFlag
  wikiLlmProvider --> apiClient
  wikiOrchestrator --> wikiService
  wikiService --> wikiLlmProvider
```
