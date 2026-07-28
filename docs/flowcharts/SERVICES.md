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
  characterImageService --> characterDatabase
  characterImageService --> imageVariants
  characterImageService --> storageService
  characterImageService --> localImageStore
  characterImageService --> characterImageDatabase
  characterImageSyncService --> localImageStore
  characterImageSyncService --> characterDatabase
  characterImageSyncService --> characterImageDatabase
  characterImageSyncService --> characterImageService
  characterImageSyncService --> storageService
  characterImageSyncService --> apiClient
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
  characterSyncService --> characterImageSyncService
  characterSyncService --> voiceDefaults
  characterSyncService --> characterImageService
  chatReplyService --> groundingMetadata
  cloudAgentService --> googleSignin
  cloudAgentService --> groundingMetadata
  edgeToolExecutors --> wikiService
  edgeToolExecutors --> taskDatabase
  liveMemoryQuery --> aiChatService
  liveMemoryQuery --> messageDatabase
  liveMemoryQuery --> characterDatabase
  localImageStore --> storageService
  localImageStore.web --> storageService.web
  messageService --> messageDatabase
  messageService --> analyticsService
  storageService --> localImageStore
  userService --> apiClient
  wikiLlmProvider --> devSandboxFlag
  wikiLlmProvider --> apiClient
  wikiOrchestrator --> wikiService
  wikiService --> wikiLlmProvider
```
