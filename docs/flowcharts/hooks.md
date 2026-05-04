# hooks call graph

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
(useAIChat.ts)"] --> isPlanTier__src_hooks_useAIChat_ts["isPlanTier
(useAIChat.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> SUBSCRIPTION_TIERS__src_config_constants_ts["SUBSCRIPTION_TIERS
(constants.ts)"]
  useAIChat__src_hooks_useAIChat_ts["useAIChat
(useAIChat.ts)"] --> sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"]
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
  useAuthCredits__src_hooks_useAuthSnapshot_ts["useAuthCredits
(useAuthSnapshot.ts)"] --> isPlanTier__src_hooks_useAuthSnapshot_ts["isPlanTier
(useAuthSnapshot.ts)"]
  useAuthCredits__src_hooks_useAuthSnapshot_ts["useAuthCredits
(useAuthSnapshot.ts)"] --> SUBSCRIPTION_TIERS__src_config_constants_ts["SUBSCRIPTION_TIERS
(constants.ts)"]
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
  useCurrentPlan__src_hooks_useCurrentPlan_ts["useCurrentPlan
(useCurrentPlan.ts)"] --> SUBSCRIPTION_TIERS__src_config_constants_ts["SUBSCRIPTION_TIERS
(constants.ts)"]
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
(useInitializeApp.web.ts)"] --> initializeGoogleSignIn__src_auth_googleSignin_ts["initializeGoogleSignIn
(googleSignin.ts)"]
  useIsPremium__src_hooks_useIsPremium_ts["useIsPremium
(useIsPremium.ts)"] --> useCurrentPlan__src_hooks_useCurrentPlan_ts["useCurrentPlan
(useCurrentPlan.ts)"]
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
  useDeductCredits__src_hooks_useUserCredits_ts["useDeductCredits
(useUserCredits.ts)"] --> useAuthMachine__src_hooks_useMachines_ts["useAuthMachine
(useMachines.ts)"]
  useDeductCredits__src_hooks_useUserCredits_ts["useDeductCredits
(useUserCredits.ts)"] --> deductCredits__src_utilities_getUserCredits_ts["deductCredits
(getUserCredits.ts)"]
  useDeductCredits__src_hooks_useUserCredits_ts["useDeductCredits
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
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> sendMessage__src_services_messageService_ts["sendMessage
(messageService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> getWiki__src_services_wikiService_ts["getWiki
(wikiService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> getRecentConversationHistory__src_services_aiChatService_ts["getRecentConversationHistory
(aiChatService.ts)"]
  sendMessageWithAIResponse__src_services_aiChatService_ts["sendMessageWithAIResponse
(aiChatService.ts)"] --> buildChatPrompt__src_services_aiChatService_ts["buildChatPrompt
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
(aiChatService.ts)"] --> toUsageSnapshot__src_services_aiChatService_ts["toUsageSnapshot
(aiChatService.ts)"]
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
  generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"] --> generateImageFn__src_config_firebaseConfig_ts["generateImageFn
(firebaseConfig.ts)"]
  generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"] --> parseResponse__src_services_imageGenerationService_ts["parseResponse
(imageGenerationService.ts)"]
  reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"] --> logCrashlyticsError__src_services_crashlyticsService_ts["logCrashlyticsError
(crashlyticsService.ts)"]
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
  deductCredits__src_utilities_getUserCredits_ts["deductCredits
(getUserCredits.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  deductCredits__src_utilities_getUserCredits_ts["deductCredits
(getUserCredits.ts)"] --> spendCreditsFn__src_config_firebaseConfig_ts["spendCreditsFn
(firebaseConfig.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> sendMessage__src_services_messageService_ts["sendMessage
(messageService.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> buildChatPrompt__src_services_aiChatService_ts["buildChatPrompt
(aiChatService.ts)"]
  sendVoiceMessage__src_services_voiceChatService_ts["sendVoiceMessage
(voiceChatService.ts)"] --> getRecentConversationHistory__src_services_aiChatService_ts["getRecentConversationHistory
(aiChatService.ts)"]
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
```
