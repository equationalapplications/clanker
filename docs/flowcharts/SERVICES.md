# services file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  edgeAgentEvals.int.test --> CharacterPromptBuilder
  aiChatService --> ensureDevSandboxCharacter
  aiChatService --> messageDatabase
  aiChatService --> characterDatabase
  aiChatService --> summarizeTextService
  aiChatService --> messageService
  aiChatService --> CharacterPromptBuilder
  aiChatService --> chatReplyService
  apiClient --> bootstrapSession
  characterService --> googleSignin
  characterService --> characterDatabase
  characterService --> defaultAvatarService
  characterSyncService --> characterDatabase
  characterSyncService --> wikiService
  characterSyncService --> wikiSourceType
  characterSyncService --> apiClient
  characterSyncService --> wikiOrchestrator
  characterSyncService --> ensureDevSandboxCharacter
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
  userService --> apiClient
  wikiLlmProvider --> ensureDevSandboxCharacter
  wikiLlmProvider --> apiClient
  wikiOrchestrator --> wikiService
  wikiService --> wikiLlmProvider
```
