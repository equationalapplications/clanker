# services file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._

```mermaid
graph LR
  edgeAgentEvals.int.test --> CharacterPromptBuilder
  aiChatService --> devSandboxFlag
  aiChatService --> messageDatabase
  aiChatService --> characterDatabase
  aiChatService --> CharacterPromptBuilder
  aiChatService --> summarizeTextService
  aiChatService --> messageService
  aiChatService --> chatReplyService
  characterImageService --> characterDatabase
  characterImageService --> imageVariants
  characterImageService --> devSandboxFlag
  characterImageService --> characterImageDatabase
  characterImageService --> storageService
  characterImageService --> localImageStore
  characterImageSyncService --> localImageStore
  characterImageSyncService --> characterImageDatabase
  characterImageSyncService --> storageService
  characterImageSyncService --> characterDatabase
  characterImageSyncService --> characterImageService
  characterService --> googleSignin
  characterService --> characterDatabase
  characterService --> analyticsService
  chatReplyService --> groundingMetadata
  edgeToolExecutors --> wikiService
  edgeToolExecutors --> taskDatabase
  imageModelBytes --> characterImageDatabase
  imageModelBytes --> localImageStore
  liveMemoryQuery --> aiChatService
  liveMemoryQuery --> messageDatabase
  liveMemoryQuery --> characterDatabase
  localImageStore --> storageService
  localImageStore.web --> storageService.web
  messageService --> messageDatabase
  messageService --> analyticsService
  userService --> bootstrapSession
  wikiLlmProvider --> devSandboxFlag
  wikiOrchestrator --> wikiService
  wikiService --> wikiLlmProvider
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
  characterSyncService --> characterImageDatabase
  cloudAgentService --> googleSignin
  cloudAgentService --> groundingMetadata
```
