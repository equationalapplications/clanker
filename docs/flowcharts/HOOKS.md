# hooks file dependencies

_Auto-generated. Run `npm run docs:charts` to regenerate._

```mermaid
graph LR
  useAIChat --> useMachines
  useAIChat --> useMessages
  useAIChat --> useCharacterWiki
  useAIChat --> devSandboxFlag
  useAIChat --> useEdgeAgent
  useAIChat --> aiChatService
  useAIChat --> CharacterPromptBuilder
  useAIChat --> taskDatabase
  useAIChat --> cloudAgentService
  useAIChat --> characterImageDatabase
  useAIChat --> characterImageService
  useAIChat --> messageDatabase
  useAIChat --> syncMessage
  useAIChat --> usageSnapshot
  useAdminDashboard --> adminService
  useAuthSnapshot --> useMachines
  useAvatarUpload --> useMachines
  useAvatarUpload --> googleSignin
  useAvatarUpload --> characterImageService
  useBootstrapRefresh --> useMachines
  useCachedResources --> index
  useCharacterWiki --> characterWikiQueue
  useCharacterWiki --> wikiOrchestrator
  useCharacterWiki --> wikiSourceType
  useCharacterWiki --> apiClient
  useCharacters --> useMachines
  useChatPhotoUpload --> imageVariants
  useCurrentPlan --> useMachines
  useEdgeAgent --> CharacterPromptBuilder
  useEdgeAgent --> edgeToolExecutors
  useEdgeAgent --> chatReplyService
  useExportCharacterOKF --> okfReadmeContent
  useImageGeneration --> useMachines
  useImageGeneration --> googleSignin
  useImageGeneration --> imageGenerationService
  useImageGeneration --> characterImageService
  useImageGeneration --> usageSnapshot
  useInitializeApp --> crashlyticsService
  useInitializeApp --> analyticsService
  useInitializeApp --> googleSignin
  useIsPremium --> useCurrentPlan
  useLiveAudioIO --> twoWayAudioAdapter
  useLiveAudioIO.web --> twoWayAudioAdapter
  useLiveVoiceChat --> useMachines
  useLiveVoiceChat --> useCharacters
  useLiveVoiceChat --> useCurrentPlan
  useLiveVoiceChat --> useLiveAudioIO
  useLiveVoiceChat --> liveVoiceMachine
  useLiveVoiceChat --> twoWayAudioAdapter
  useMessages --> useMachines
  useMessages --> messageService
  usePowerBalance --> useUserCredits
  usePowerBalance --> useAuthSnapshot
  useRegisterExpoPushToken --> devSandboxFlag
  useRegisterExpoPushToken --> googleSignin
  useResolvedImage --> characterImageDatabase
  useResolvedImage --> localImageStore
  useScreenTracking --> analyticsService
  useTabCharacterId --> useActiveCharacterId
  useTabCharacterId --> useMessages
  useTabCharacterId --> useCharacters
  useTabCharacterId --> useMachines
  useTabCharacterId --> devSandboxFlag
  useUser --> useMachines
  useUser --> useBootstrapRefresh
  useUser --> userService
  useUserCredits --> useMachines
  useUserCredits --> useAuthSnapshot
  useUserCredits --> useBootstrapRefresh
  useWebCheckoutSync.web --> googleSignin
```
