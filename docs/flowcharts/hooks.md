# hooks call graph + import fallback

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> useChatMessages__src_hooks_useMessages_ts["useChatMessages
(useMessages.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> useCharacterWiki__src_hooks_useCharacterWiki_ts["useCharacterWiki
(useCharacterWiki.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> useEdgeAgent__src_hooks_useEdgeAgent_ts["useEdgeAgent
(useEdgeAgent.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> saveAIMessage__src_database_messageDatabase_ts["saveAIMessage
(messageDatabase.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> getRecentConversationHistory__src_services_aiChatService_ts["getRecentConversationHistory
(aiChatService.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> getUnsyncedMessages__src_database_messageDatabase_ts["getUnsyncedMessages
(messageDatabase.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> toSyncMessage__src_services_syncMessage_ts["toSyncMessage
(syncMessage.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> markMessagesAsSynced__src_database_messageDatabase_ts["markMessagesAsSynced
(messageDatabase.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> messageKeys__src_hooks_useMessages_ts["messageKeys
(useMessages.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> usageSnapshotFromError__src_services_usageSnapshot_ts["usageSnapshotFromError
(usageSnapshot.ts)"]
  useAdminUsers__src_hooks_useAdminDashboard_ts["useAdminUsers
(useAdminDashboard.ts)"] --> adminUsersKey__src_hooks_useAdminDashboard_ts["adminUsersKey
(useAdminDashboard.ts)"]
  useAdminUsers__src_hooks_useAdminDashboard_ts["useAdminUsers
(useAdminDashboard.ts)"] --> listAdminUsers__src_services_adminService_ts["listAdminUsers
(adminService.ts)"]
  useSetAdminUserCredits__src_hooks_useAdminDashboard_ts["useSetAdminUserCredits
(useAdminDashboard.ts)"] --> setAdminUserCredits__src_services_adminService_ts["setAdminUserCredits
(adminService.ts)"]
  useSetAdminUserSubscription__src_hooks_useAdminDashboard_ts["useSetAdminUserSubscription
(useAdminDashboard.ts)"] --> setAdminUserSubscription__src_services_adminService_ts["setAdminUserSubscription
(adminService.ts)"]
  useClearAdminTerms__src_hooks_useAdminDashboard_ts["useClearAdminTerms
(useAdminDashboard.ts)"] --> clearAdminTerms__src_services_adminService_ts["clearAdminTerms
(adminService.ts)"]
  useResetAdminUserState__src_hooks_useAdminDashboard_ts["useResetAdminUserState
(useAdminDashboard.ts)"] --> resetAdminUserState__src_services_adminService_ts["resetAdminUserState
(adminService.ts)"]
  useDeleteAdminUser__src_hooks_useAdminDashboard_ts["useDeleteAdminUser
(useAdminDashboard.ts)"] --> deleteAdminUser__src_services_adminService_ts["deleteAdminUser
(adminService.ts)"]
  useAuthSubscription__src_hooks_useAuthSnapshot_ts["useAuthSubscription
(useAuthSnapshot.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useAuthCredits__src_hooks_useAuthSnapshot_ts["useAuthCredits
(useAuthSnapshot.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useAuthTerms__src_hooks_useAuthSnapshot_ts["useAuthTerms
(useAuthSnapshot.ts)"] --> useAuthSubscription__src_hooks_useAuthSnapshot_ts["useAuthSubscription
(useAuthSnapshot.ts)"]
  useAvatarUpload__src_hooks_useAvatarUpload_ts["useAvatarUpload
(useAvatarUpload.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useAvatarUpload__src_hooks_useAvatarUpload_ts["useAvatarUpload
(useAvatarUpload.ts)"] --> saveCharacterImageLocally__src_services_localImageStorageService_ts["saveCharacterImageLocally
(localImageStorageService.ts)"]
  useBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["useBootstrapRefresh
(useBootstrapRefresh.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["useBootstrapRefresh
(useBootstrapRefresh.ts)"] --> requestBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["requestBootstrapRefresh
(useBootstrapRefresh.ts)"]
  useCachedResources__src_hooks_useCachedResources_ts["useCachedResources
(useCachedResources.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  tailForEntity__src_hooks_useCharacterWiki_ts["tailForEntity
(useCharacterWiki.ts)"] --> emptyOperationTail__src_hooks_useCharacterWiki_ts["emptyOperationTail
(useCharacterWiki.ts)"]
  useCharacterWiki__src_hooks_useCharacterWiki_ts["useCharacterWiki
(useCharacterWiki.ts)"] --> wikiOrchestrator__src_services_wikiOrchestrator_ts["wikiOrchestrator
(wikiOrchestrator.ts)"]
  useCharacterWiki__src_hooks_useCharacterWiki_ts["useCharacterWiki
(useCharacterWiki.ts)"] --> tailForEntity__src_hooks_useCharacterWiki_ts["tailForEntity
(useCharacterWiki.ts)"]
  useCharacterWiki__src_hooks_useCharacterWiki_ts["useCharacterWiki
(useCharacterWiki.ts)"] --> waitForActorOperation__src_hooks_useCharacterWiki_ts["waitForActorOperation
(useCharacterWiki.ts)"]
  useCharacterWiki__src_hooks_useCharacterWiki_ts["useCharacterWiki
(useCharacterWiki.ts)"] --> wikiSync__src_services_apiClient_ts["wikiSync
(apiClient.ts)"]
  useCharacterWiki__src_hooks_useCharacterWiki_ts["useCharacterWiki
(useCharacterWiki.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  useCharacters__src_hooks_useCharacters_ts["useCharacters
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useCharacter__src_hooks_useCharacters_ts["useCharacter
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useCreateCharacter__src_hooks_useCharacters_ts["useCreateCharacter
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useUpdateCharacter__src_hooks_useCharacters_ts["useUpdateCharacter
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useDeleteCharacter__src_hooks_useCharacters_ts["useDeleteCharacter
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useSyncCharacters__src_hooks_useCharacters_ts["useSyncCharacters
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useUnsyncCharacter__src_hooks_useCharacters_ts["useUnsyncCharacter
(useCharacters.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useCurrentPlan__src_hooks_useCurrentPlan_ts["useCurrentPlan
(useCurrentPlan.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useCurrentPlan__src_hooks_useCurrentPlan_ts["useCurrentPlan
(useCurrentPlan.ts)"] --> isPlanTier__src_hooks_useCurrentPlan_ts["isPlanTier
(useCurrentPlan.ts)"]
  useEdgeAgent__src_hooks_useEdgeAgent_ts["useEdgeAgent
(useEdgeAgent.ts)"] --> buildSystemInstruction__src_services_CharacterPromptBuilder_ts["buildSystemInstruction
(CharacterPromptBuilder.ts)"]
  useEdgeAgent__src_hooks_useEdgeAgent_ts["useEdgeAgent
(useEdgeAgent.ts)"] --> buildContentHistory__src_services_CharacterPromptBuilder_ts["buildContentHistory
(CharacterPromptBuilder.ts)"]
  useEdgeAgent__src_hooks_useEdgeAgent_ts["useEdgeAgent
(useEdgeAgent.ts)"] --> createEdgeToolExecutors__src_services_edgeToolExecutors_ts["createEdgeToolExecutors
(edgeToolExecutors.ts)"]
  useEditDirtyState__src_hooks_useEditDirtyState_ts["useEditDirtyState
(useEditDirtyState.ts)"] --> setEditDirty__src_hooks_useEditDirtyState_ts["setEditDirty
(useEditDirtyState.ts)"]
  useImageGeneration__src_hooks_useImageGeneration_ts["useImageGeneration
(useImageGeneration.ts)"] --> useCharacterMachine__src_hooks_useMachines_ts["useCharacterMachine
(useMachines.ts)"]
  useImageGeneration__src_hooks_useImageGeneration_ts["useImageGeneration
(useImageGeneration.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useImageGeneration__src_hooks_useImageGeneration_ts["useImageGeneration
(useImageGeneration.ts)"] --> generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"]
  useImageGeneration__src_hooks_useImageGeneration_ts["useImageGeneration
(useImageGeneration.ts)"] --> saveCharacterImageLocally__src_services_localImageStorageService_ts["saveCharacterImageLocally
(localImageStorageService.ts)"]
  useImageGeneration__src_hooks_useImageGeneration_ts["useImageGeneration
(useImageGeneration.ts)"] --> usageSnapshotFromError__src_services_usageSnapshot_ts["usageSnapshotFromError
(usageSnapshot.ts)"]
  useInitializeApp__src_hooks_useInitializeApp_ts["useInitializeApp
(useInitializeApp.ts)"] --> initializeCrashlytics__src_services_crashlyticsService_ts["initializeCrashlytics
(crashlyticsService.ts)"]
  useInitializeApp__src_hooks_useInitializeApp_ts["useInitializeApp
(useInitializeApp.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  useInitializeApp__src_hooks_useInitializeApp_ts["useInitializeApp
(useInitializeApp.ts)"] --> initializeGoogleSignIn__src_auth_googleSignin_ts["initializeGoogleSignIn
(googleSignin.ts)"]
  useInitializeApp__src_hooks_useInitializeApp_ts["useInitializeApp
(useInitializeApp.ts)"] --> initializeRevenueCat__src_config_revenueCatConfig_ts["initializeRevenueCat
(revenueCatConfig.ts)"]
  useInitializeApp__src_hooks_useInitializeApp_web_ts["useInitializeApp
(useInitializeApp.web.ts)"] --> installGoogleIdentityConsoleFilter__src_utilities_devConsoleFilters_web_ts["installGoogleIdentityConsoleFilter
(devConsoleFilters.web.ts)"]
  useIsPremium__src_hooks_useIsPremium_ts["useIsPremium
(useIsPremium.ts)"] --> useCurrentPlan__src_hooks_useCurrentPlan_ts["useCurrentPlan
(useCurrentPlan.ts)"]
  useMemoryBundle__src_hooks_useMemoryBundle_ts["useMemoryBundle
(useMemoryBundle.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  useMessages__src_hooks_useMessages_ts["useMessages
(useMessages.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useMessages__src_hooks_useMessages_ts["useMessages
(useMessages.ts)"] --> getMessages__src_services_messageService_ts["getMessages
(messageService.ts)"]
  useSendMessage__src_hooks_useMessages_ts["useSendMessage
(useMessages.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useSendMessage__src_hooks_useMessages_ts["useSendMessage
(useMessages.ts)"] --> sendMessage__src_services_messageService_ts["sendMessage
(messageService.ts)"]
  useDeleteMessage__src_hooks_useMessages_ts["useDeleteMessage
(useMessages.ts)"] --> deleteMessage__src_services_messageService_ts["deleteMessage
(messageService.ts)"]
  useUpdateMessage__src_hooks_useMessages_ts["useUpdateMessage
(useMessages.ts)"] --> updateMessage__src_services_messageService_ts["updateMessage
(messageService.ts)"]
  useMostRecentMessage__src_hooks_useMessages_ts["useMostRecentMessage
(useMessages.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useMostRecentMessage__src_hooks_useMessages_ts["useMostRecentMessage
(useMessages.ts)"] --> getMostRecentMessage__src_services_messageService_ts["getMostRecentMessage
(messageService.ts)"]
  useChatMessages__src_hooks_useMessages_ts["useChatMessages
(useMessages.ts)"] --> useMessages__src_hooks_useMessages_ts["useMessages
(useMessages.ts)"]
  useUserProfile__src_hooks_useUser_ts["useUserProfile
(useUser.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useUserProfile__src_hooks_useUser_ts["useUserProfile
(useUser.ts)"] --> requestBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["requestBootstrapRefresh
(useBootstrapRefresh.ts)"]
  useUserPublicData__src_hooks_useUser_ts["useUserPublicData
(useUser.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useUserPublicData__src_hooks_useUser_ts["useUserPublicData
(useUser.ts)"] --> requestBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["requestBootstrapRefresh
(useBootstrapRefresh.ts)"]
  useUserPrivateData__src_hooks_useUser_ts["useUserPrivateData
(useUser.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useUserPrivateData__src_hooks_useUser_ts["useUserPrivateData
(useUser.ts)"] --> requestBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["requestBootstrapRefresh
(useBootstrapRefresh.ts)"]
  useUpdateProfile__src_hooks_useUser_ts["useUpdateProfile
(useUser.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useUpdateProfile__src_hooks_useUser_ts["useUpdateProfile
(useUser.ts)"] --> upsertUserProfile__src_services_userService_ts["upsertUserProfile
(userService.ts)"]
  useUserCredits__src_hooks_useUserCredits_ts["useUserCredits
(useUserCredits.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useUserCredits__src_hooks_useUserCredits_ts["useUserCredits
(useUserCredits.ts)"] --> useAuthCredits__src_hooks_useAuthSnapshot_ts["useAuthCredits
(useAuthSnapshot.ts)"]
  useUserCredits__src_hooks_useUserCredits_ts["useUserCredits
(useUserCredits.ts)"] --> requestBootstrapRefresh__src_hooks_useBootstrapRefresh_ts["requestBootstrapRefresh
(useBootstrapRefresh.ts)"]
  useVoiceChat__src_hooks_useVoiceChat_ts["useVoiceChat
(useVoiceChat.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useVoiceChat__src_hooks_useVoiceChat_ts["useVoiceChat
(useVoiceChat.ts)"] --> useCharacter__src_hooks_useCharacters_ts["useCharacter
(useCharacters.ts)"]
  useVoiceChat__src_hooks_useVoiceChat_ts["useVoiceChat
(useVoiceChat.ts)"] --> useChatMessages__src_hooks_useMessages_ts["useChatMessages
(useMessages.ts)"]
  useVoiceChat__src_hooks_useVoiceChat_ts["useVoiceChat
(useVoiceChat.ts)"] --> useCurrentPlan__src_hooks_useCurrentPlan_ts["useCurrentPlan
(useCurrentPlan.ts)"]
  useVoiceChat__src_hooks_useVoiceChat_ts["useVoiceChat
(useVoiceChat.ts)"] --> sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"]
  useVoiceChat__src_hooks_useVoiceChat_ts["useVoiceChat
(useVoiceChat.ts)"] --> extractTranscript__src_hooks_useVoiceChat_ts["extractTranscript
(useVoiceChat.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> isPaygProduct__src_hooks_useWebCheckoutSync_web_ts["isPaygProduct
(useWebCheckoutSync.web.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> onAuthStateChanged__src_config_firebaseConfig_ts["onAuthStateChanged
(firebaseConfig.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> clearPendingCheckoutAttempts__src_utilities_checkoutStateStore_ts["clearPendingCheckoutAttempts
(checkoutStateStore.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> deriveLocks__src_hooks_useWebCheckoutSync_web_ts["deriveLocks
(useWebCheckoutSync.web.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> readCheckoutAttempts__src_utilities_checkoutStateStore_ts["readCheckoutAttempts
(checkoutStateStore.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> createCheckoutChannel__src_utilities_checkoutChannel_ts["createCheckoutChannel
(checkoutChannel.ts)"]
  useWebCheckoutSync__src_hooks_useWebCheckoutSync_web_ts["useWebCheckoutSync
(useWebCheckoutSync.web.ts)"] --> expireStalePendingAttempts__src_utilities_checkoutStateStore_ts["expireStalePendingAttempts
(checkoutStateStore.ts)"]
  reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"] --> logCrashlyticsError__src_services_crashlyticsService_ts["logCrashlyticsError
(crashlyticsService.ts)"]
  saveAIMessage__src_database_messageDatabase_ts["saveAIMessage
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"] --> getMessageCount__src_database_messageDatabase_ts["getMessageCount
(messageDatabase.ts)"]
  triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"] --> updateCharacter__src_database_characterDatabase_ts["updateCharacter
(characterDatabase.ts)"]
  triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"] --> getMessagesForContextSummary__src_database_messageDatabase_ts["getMessagesForContextSummary
(messageDatabase.ts)"]
  triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"] --> buildSummaryInput__src_services_aiChatService_ts["buildSummaryInput
(aiChatService.ts)"]
  triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"] --> summarizeText__src_services_summarizeTextService_ts["summarizeText
(summarizeTextService.ts)"]
  triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"] --> pruneMessagesForCharacter__src_database_messageDatabase_ts["pruneMessagesForCharacter
(messageDatabase.ts)"]
  getUnsyncedMessages__src_database_messageDatabase_ts["getUnsyncedMessages
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> sendMessage__src_services_messageService_ts["sendMessage
(messageService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> getRecentConversationHistory__src_services_aiChatService_ts["getRecentConversationHistory
(aiChatService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> buildSystemInstruction__src_services_CharacterPromptBuilder_ts["buildSystemInstruction
(CharacterPromptBuilder.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> buildContentHistory__src_services_CharacterPromptBuilder_ts["buildContentHistory
(CharacterPromptBuilder.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> trimToBudget__src_services_aiChatService_ts["trimToBudget
(aiChatService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> generateChatReply__src_services_chatReplyService_ts["generateChatReply
(chatReplyService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> buildReferenceId__src_services_aiChatService_ts["buildReferenceId
(aiChatService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> saveAIMessage__src_database_messageDatabase_ts["saveAIMessage
(messageDatabase.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> toUsageSnapshot__src_services_aiChatService_ts["toUsageSnapshot
(aiChatService.ts)"]
  markMessagesAsSynced__src_database_messageDatabase_ts["markMessagesAsSynced
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  usageSnapshotFromError__src_services_usageSnapshot_ts["usageSnapshotFromError
(usageSnapshot.ts)"] --> toUsageSnapshotPayload__src_services_usageSnapshot_ts["toUsageSnapshotPayload
(usageSnapshot.ts)"]
  listAdminUsers__src_services_adminService_ts["listAdminUsers
(adminService.ts)"] --> callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"]
  setAdminUserCredits__src_services_adminService_ts["setAdminUserCredits
(adminService.ts)"] --> callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"]
  setAdminUserCredits__src_services_adminService_ts["setAdminUserCredits
(adminService.ts)"] --> ensureReason__src_services_adminService_ts["ensureReason
(adminService.ts)"]
  setAdminUserCredits__src_services_adminService_ts["setAdminUserCredits
(adminService.ts)"] --> makeRequestId__src_services_adminService_ts["makeRequestId
(adminService.ts)"]
  setAdminUserSubscription__src_services_adminService_ts["setAdminUserSubscription
(adminService.ts)"] --> callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"]
  setAdminUserSubscription__src_services_adminService_ts["setAdminUserSubscription
(adminService.ts)"] --> ensureReason__src_services_adminService_ts["ensureReason
(adminService.ts)"]
  setAdminUserSubscription__src_services_adminService_ts["setAdminUserSubscription
(adminService.ts)"] --> makeRequestId__src_services_adminService_ts["makeRequestId
(adminService.ts)"]
  clearAdminTerms__src_services_adminService_ts["clearAdminTerms
(adminService.ts)"] --> callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"]
  clearAdminTerms__src_services_adminService_ts["clearAdminTerms
(adminService.ts)"] --> ensureReason__src_services_adminService_ts["ensureReason
(adminService.ts)"]
  clearAdminTerms__src_services_adminService_ts["clearAdminTerms
(adminService.ts)"] --> makeRequestId__src_services_adminService_ts["makeRequestId
(adminService.ts)"]
  resetAdminUserState__src_services_adminService_ts["resetAdminUserState
(adminService.ts)"] --> callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"]
  resetAdminUserState__src_services_adminService_ts["resetAdminUserState
(adminService.ts)"] --> ensureReason__src_services_adminService_ts["ensureReason
(adminService.ts)"]
  resetAdminUserState__src_services_adminService_ts["resetAdminUserState
(adminService.ts)"] --> makeRequestId__src_services_adminService_ts["makeRequestId
(adminService.ts)"]
  deleteAdminUser__src_services_adminService_ts["deleteAdminUser
(adminService.ts)"] --> callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"]
  deleteAdminUser__src_services_adminService_ts["deleteAdminUser
(adminService.ts)"] --> ensureReason__src_services_adminService_ts["ensureReason
(adminService.ts)"]
  deleteAdminUser__src_services_adminService_ts["deleteAdminUser
(adminService.ts)"] --> makeRequestId__src_services_adminService_ts["makeRequestId
(adminService.ts)"]
  saveCharacterImageLocally__src_services_localImageStorageService_ts["saveCharacterImageLocally
(localImageStorageService.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  saveCharacterImageLocally__src_services_localImageStorageService_ts["saveCharacterImageLocally
(localImageStorageService.ts)"] --> sanitizeImageMimeType__src_utilities_imageMimeType_ts["sanitizeImageMimeType
(imageMimeType.ts)"]
  getDatabase__src_database_index_ts["getDatabase
(index.ts)"] --> openDatabaseAsyncWithRetry__src_database_index_ts["openDatabaseAsyncWithRetry
(index.ts)"]
  getDatabase__src_database_index_ts["getDatabase
(index.ts)"] --> initializeDatabase__src_database_index_ts["initializeDatabase
(index.ts)"]
  createEdgeToolExecutors__src_services_edgeToolExecutors_ts["createEdgeToolExecutors
(edgeToolExecutors.ts)"] --> readFromWiki__src_services_wikiService_ts["readFromWiki
(wikiService.ts)"]
  generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"] --> generateImageFn__src_config_firebaseConfig_ts["generateImageFn
(firebaseConfig.ts)"]
  generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"] --> parseResponse__src_services_imageGenerationService_ts["parseResponse
(imageGenerationService.ts)"]
  getMessages__src_services_messageService_ts["getMessages
(messageService.ts)"] --> getMessages__src_database_messageDatabase_ts["getMessages
(messageDatabase.ts)"]
  sendMessage__src_services_messageService_ts["sendMessage
(messageService.ts)"] --> sendMessage__src_database_messageDatabase_ts["sendMessage
(messageDatabase.ts)"]
  deleteMessage__src_services_messageService_ts["deleteMessage
(messageService.ts)"] --> deleteMessage__src_database_messageDatabase_ts["deleteMessage
(messageDatabase.ts)"]
  updateMessage__src_services_messageService_ts["updateMessage
(messageService.ts)"] --> updateMessageText__src_database_messageDatabase_ts["updateMessageText
(messageDatabase.ts)"]
  getMostRecentMessage__src_services_messageService_ts["getMostRecentMessage
(messageService.ts)"] --> getMostRecentMessage__src_database_messageDatabase_ts["getMostRecentMessage
(messageDatabase.ts)"]
  upsertUserProfile__src_services_userService_ts["upsertUserProfile
(userService.ts)"] --> updateUserProfile__src_services_apiClient_ts["updateUserProfile
(apiClient.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> sendMessage__src_services_messageService_ts["sendMessage
(messageService.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> buildVoicePrompt__src_services_voiceChatService_ts["buildVoicePrompt
(voiceChatService.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> generateVoiceReply__src_services_voiceReplyService_ts["generateVoiceReply
(voiceReplyService.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> saveAIMessage__src_database_messageDatabase_ts["saveAIMessage
(messageDatabase.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> triggerConversationSummary__src_services_aiChatService_ts["triggerConversationSummary
(aiChatService.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> queryClient__src_config_queryClient_ts["queryClient
(queryClient.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> messageKeys__src_hooks_useMessages_ts["messageKeys
(useMessages.ts)"]
  useEdgeAgent_test__src_hooks___tests___useEdgeAgent_test_ts["useEdgeAgent.test
(useEdgeAgent.test.ts)"] --> __services_edgeToolExecutors["edgeToolExecutors
(services)"]
  useMachines__src_hooks_useMachines_ts["useMachines
(useMachines.ts)"] --> __machines_authMachine["authMachine
(machines)"]
  useMachines__src_hooks_useMachines_ts["useMachines
(useMachines.ts)"] --> __machines_termsMachine["termsMachine
(machines)"]
  useMachines__src_hooks_useMachines_ts["useMachines
(useMachines.ts)"] --> __machines_characterMachine["characterMachine
(machines)"]
```

> **Note:** Edges involving Firebase callable functions (created via `httpsCallable()`) are
> not captured here. Because callables are instantiated at module scope and invoked indirectly,
> static analysis cannot trace them as call edges. Affected call sites include
> `generateReplyFn`, `generateVoiceReplyFn`, `summarizeTextFn`, and similar callable wrappers.
