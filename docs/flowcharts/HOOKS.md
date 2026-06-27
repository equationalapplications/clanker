# hooks file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  useAgeVerification.test --> useAgeVerification
  useAIChat --> useMachines
  useAIChat --> useMessages
  useAIChat --> useCharacterWiki
  useAIChat --> ensureDevSandboxCharacter
  useAIChat --> useEdgeAgent
  useAIChat --> messageDatabase
  useAIChat --> aiChatService
  useAIChat --> CharacterPromptBuilder
  useAIChat --> taskDatabase
  useAIChat --> cloudAgentService
  useAIChat --> syncMessage
  useAIChat --> usageSnapshot
  useAdminDashboard --> adminService
  useAuthSnapshot --> useMachines
  useAvatarUpload --> useMachines
  useAvatarUpload --> localImageStorageService
  useBootstrapRefresh --> useMachines
  useCachedResources --> index
  useCharacterWiki --> wikiOrchestrator
  useCharacterWiki --> wikiSourceType
  useCharacterWiki --> apiClient
  useCharacters --> useMachines
  useCurrentPlan --> useMachines
  useEdgeAgent --> CharacterPromptBuilder
  useEdgeAgent --> edgeToolExecutors
  useEdgeAgent --> chatReplyService
  useImageGeneration --> useMachines
  useImageGeneration --> imageGenerationService
  useImageGeneration --> localImageStorageService
  useImageGeneration --> usageSnapshot
  useInitializeApp --> crashlyticsService
  useInitializeApp --> googleSignin
  useIsPremium --> useCurrentPlan
  useLiveVoiceChat --> useMachines
  useLiveVoiceChat --> useCharacters
  useLiveVoiceChat --> useCurrentPlan
  useLiveVoiceChat --> useLiveAudioIO
  useLiveVoiceChat --> liveVoiceMachine
  useMessages --> useMachines
  useMessages --> messageService
  useTabCharacterId --> useActiveCharacterId
  useTabCharacterId --> useMessages
  useTabCharacterId --> useCharacters
  useTabCharacterId --> useMachines
  useTabCharacterId --> ensureDevSandboxCharacter
  useUser --> useMachines
  useUser --> useBootstrapRefresh
  useUser --> userService
  useUserCredits --> useMachines
  useUserCredits --> useAuthSnapshot
  useUserCredits --> useBootstrapRefresh
  useWebCheckoutSync.web --> googleSignin
```
