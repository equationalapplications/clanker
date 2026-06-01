# services call graph + import fallback

_Auto-generated. Run `npm run docs:charts` to regenerate._
```mermaid
graph LR
  callAdmin__src_services_adminService_ts["callAdmin
(adminService.ts)"] --> ensureAppCheckConfigured__src_services_adminService_ts["ensureAppCheckConfigured
(adminService.ts)"]
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
  trimToBudget__src_services_aiChatService_ts["trimToBudget
(aiChatService.ts)"] --> estimatePayloadSize__src_services_aiChatService_ts["estimatePayloadSize
(aiChatService.ts)"]
  buildReferenceId__src_services_aiChatService_ts["buildReferenceId
(aiChatService.ts)"] --> truncateText__src_services_aiChatService_ts["truncateText
(aiChatService.ts)"]
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
  sendCharacterIntroduction__src_services_aiChatService_ts["sendCharacterIntroduction
(aiChatService.ts)"] --> buildSystemInstruction__src_services_CharacterPromptBuilder_ts["buildSystemInstruction
(CharacterPromptBuilder.ts)"]
  sendCharacterIntroduction__src_services_aiChatService_ts["sendCharacterIntroduction
(aiChatService.ts)"] --> trimToBudget__src_services_aiChatService_ts["trimToBudget
(aiChatService.ts)"]
  sendCharacterIntroduction__src_services_aiChatService_ts["sendCharacterIntroduction
(aiChatService.ts)"] --> generateChatReply__src_services_chatReplyService_ts["generateChatReply
(chatReplyService.ts)"]
  sendCharacterIntroduction__src_services_aiChatService_ts["sendCharacterIntroduction
(aiChatService.ts)"] --> buildReferenceId__src_services_aiChatService_ts["buildReferenceId
(aiChatService.ts)"]
  sendCharacterIntroduction__src_services_aiChatService_ts["sendCharacterIntroduction
(aiChatService.ts)"] --> saveAIMessage__src_database_messageDatabase_ts["saveAIMessage
(messageDatabase.ts)"]
  getUserState__src_services_apiClient_ts["getUserState
(apiClient.ts)"] --> bootstrapSession__src_auth_bootstrapSession_ts["bootstrapSession
(bootstrapSession.ts)"]
  getUserCharacters__src_services_characterService_ts["getUserCharacters
(characterService.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  getUserCharacters__src_services_characterService_ts["getUserCharacters
(characterService.ts)"] --> getUserCharacters__src_database_characterDatabase_ts["getUserCharacters
(characterDatabase.ts)"]
  getCharacter__src_services_characterService_ts["getCharacter
(characterService.ts)"] --> getCharacter__src_database_characterDatabase_ts["getCharacter
(characterDatabase.ts)"]
  createCharacter__src_services_characterService_ts["createCharacter
(characterService.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  createCharacter__src_services_characterService_ts["createCharacter
(characterService.ts)"] --> createCharacter__src_database_characterDatabase_ts["createCharacter
(characterDatabase.ts)"]
  updateCharacter__src_services_characterService_ts["updateCharacter
(characterService.ts)"] --> updateCharacter__src_database_characterDatabase_ts["updateCharacter
(characterDatabase.ts)"]
  deleteCharacter__src_services_characterService_ts["deleteCharacter
(characterService.ts)"] --> deleteCharacter__src_database_characterDatabase_ts["deleteCharacter
(characterDatabase.ts)"]
  getCharacterCount__src_services_characterService_ts["getCharacterCount
(characterService.ts)"] --> getCharacterCount__src_database_characterDatabase_ts["getCharacterCount
(characterDatabase.ts)"]
  searchCharacters__src_services_characterService_ts["searchCharacters
(characterService.ts)"] --> searchCharacters__src_database_characterDatabase_ts["searchCharacters
(characterDatabase.ts)"]
  createNewCharacter__src_services_characterService_ts["createNewCharacter
(characterService.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  createNewCharacter__src_services_characterService_ts["createNewCharacter
(characterService.ts)"] --> loadDefaultAvatarBase64__src_services_defaultAvatarService_ts["loadDefaultAvatarBase64
(defaultAvatarService.ts)"]
  createNewCharacter__src_services_characterService_ts["createNewCharacter
(characterService.ts)"] --> createCharacter__src_services_characterService_ts["createCharacter
(characterService.ts)"]
  reportWikiOpForCharacter__src_services_characterSyncService_ts["reportWikiOpForCharacter
(characterSyncService.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"] --> getAllCharactersIncludingDeleted__src_database_characterDatabase_ts["getAllCharactersIncludingDeleted
(characterDatabase.ts)"]
  syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"] --> getWiki__src_services_wikiService_ts["getWiki
(wikiService.ts)"]
  syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"] --> wikiSync__src_services_apiClient_ts["wikiSync
(apiClient.ts)"]
  syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"] --> wikiOrchestrator__src_services_wikiOrchestrator_ts["wikiOrchestrator
(wikiOrchestrator.ts)"]
  syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  syncAllToCloud__src_services_characterSyncService_ts["syncAllToCloud
(characterSyncService.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  syncAllToCloud__src_services_characterSyncService_ts["syncAllToCloud
(characterSyncService.ts)"] --> syncUnsyncedToCloud__src_services_characterSyncService_ts["syncUnsyncedToCloud
(characterSyncService.ts)"]
  syncAllToCloud__src_services_characterSyncService_ts["syncAllToCloud
(characterSyncService.ts)"] --> syncDeletionsToCloud__src_services_characterSyncService_ts["syncDeletionsToCloud
(characterSyncService.ts)"]
  syncAllToCloud__src_services_characterSyncService_ts["syncAllToCloud
(characterSyncService.ts)"] --> syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"]
  syncAllToCloud__src_services_characterSyncService_ts["syncAllToCloud
(characterSyncService.ts)"] --> setLastSyncTime__src_services_characterSyncService_ts["setLastSyncTime
(characterSyncService.ts)"]
  syncAllToCloud__src_services_characterSyncService_ts["syncAllToCloud
(characterSyncService.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> getUserCharactersFn__src_services_apiClient_ts["getUserCharactersFn
(apiClient.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> getAllCharactersIncludingDeleted__src_database_characterDatabase_ts["getAllCharactersIncludingDeleted
(characterDatabase.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> normalizeVoice__src_constants_voiceDefaults_ts["normalizeVoice
(voiceDefaults.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> batchInsertCharacters__src_database_characterDatabase_ts["batchInsertCharacters
(characterDatabase.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> syncWikiForCloud__src_services_characterSyncService_ts["syncWikiForCloud
(characterSyncService.ts)"]
  restoreFromCloud__src_services_characterSyncService_ts["restoreFromCloud
(characterSyncService.ts)"] --> reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"]
  syncUnsyncedToCloud__src_services_characterSyncService_ts["syncUnsyncedToCloud
(characterSyncService.ts)"] --> getUnsyncedCharacters__src_database_characterDatabase_ts["getUnsyncedCharacters
(characterDatabase.ts)"]
  syncUnsyncedToCloud__src_services_characterSyncService_ts["syncUnsyncedToCloud
(characterSyncService.ts)"] --> syncCharacterFn__src_services_apiClient_ts["syncCharacterFn
(apiClient.ts)"]
  syncUnsyncedToCloud__src_services_characterSyncService_ts["syncUnsyncedToCloud
(characterSyncService.ts)"] --> markCharacterSynced__src_database_characterDatabase_ts["markCharacterSynced
(characterDatabase.ts)"]
  syncUnsyncedToCloud__src_services_characterSyncService_ts["syncUnsyncedToCloud
(characterSyncService.ts)"] --> reportWikiOpForCharacter__src_services_characterSyncService_ts["reportWikiOpForCharacter
(characterSyncService.ts)"]
  importSharedCharacterFromCloud__src_services_characterSyncService_ts["importSharedCharacterFromCloud
(characterSyncService.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  importSharedCharacterFromCloud__src_services_characterSyncService_ts["importSharedCharacterFromCloud
(characterSyncService.ts)"] --> getPublicCharacterFn__src_services_apiClient_ts["getPublicCharacterFn
(apiClient.ts)"]
  importSharedCharacterFromCloud__src_services_characterSyncService_ts["importSharedCharacterFromCloud
(characterSyncService.ts)"] --> getAllCharactersIncludingDeleted__src_database_characterDatabase_ts["getAllCharactersIncludingDeleted
(characterDatabase.ts)"]
  importSharedCharacterFromCloud__src_services_characterSyncService_ts["importSharedCharacterFromCloud
(characterSyncService.ts)"] --> generateLocalCharacterId__src_services_characterSyncService_ts["generateLocalCharacterId
(characterSyncService.ts)"]
  importSharedCharacterFromCloud__src_services_characterSyncService_ts["importSharedCharacterFromCloud
(characterSyncService.ts)"] --> batchInsertCharacters__src_database_characterDatabase_ts["batchInsertCharacters
(characterDatabase.ts)"]
  importSharedCharacterFromCloud__src_services_characterSyncService_ts["importSharedCharacterFromCloud
(characterSyncService.ts)"] --> normalizeVoice__src_constants_voiceDefaults_ts["normalizeVoice
(voiceDefaults.ts)"]
  removeCharacterFromCloud__src_services_characterSyncService_ts["removeCharacterFromCloud
(characterSyncService.ts)"] --> getCharacter__src_database_characterDatabase_ts["getCharacter
(characterDatabase.ts)"]
  removeCharacterFromCloud__src_services_characterSyncService_ts["removeCharacterFromCloud
(characterSyncService.ts)"] --> clearCharacterCloudLink__src_database_characterDatabase_ts["clearCharacterCloudLink
(characterDatabase.ts)"]
  removeCharacterFromCloud__src_services_characterSyncService_ts["removeCharacterFromCloud
(characterSyncService.ts)"] --> deleteCharacterFn__src_services_apiClient_ts["deleteCharacterFn
(apiClient.ts)"]
  syncDeletionsToCloud__src_services_characterSyncService_ts["syncDeletionsToCloud
(characterSyncService.ts)"] --> getSoftDeletedCharacters__src_database_characterDatabase_ts["getSoftDeletedCharacters
(characterDatabase.ts)"]
  syncDeletionsToCloud__src_services_characterSyncService_ts["syncDeletionsToCloud
(characterSyncService.ts)"] --> hardDeleteCharacterLocal__src_database_characterDatabase_ts["hardDeleteCharacterLocal
(characterDatabase.ts)"]
  syncDeletionsToCloud__src_services_characterSyncService_ts["syncDeletionsToCloud
(characterSyncService.ts)"] --> deleteCharacterFn__src_services_apiClient_ts["deleteCharacterFn
(apiClient.ts)"]
  syncDeletionsToCloud__src_services_characterSyncService_ts["syncDeletionsToCloud
(characterSyncService.ts)"] --> reportWikiOpForCharacter__src_services_characterSyncService_ts["reportWikiOpForCharacter
(characterSyncService.ts)"]
  validateStructuredPayloadSize__src_services_chatReplyService_ts["validateStructuredPayloadSize
(chatReplyService.ts)"] --> getUtf8ByteLength__src_services_chatReplyService_ts["getUtf8ByteLength
(chatReplyService.ts)"]
  generateChatReply__src_services_chatReplyService_ts["generateChatReply
(chatReplyService.ts)"] --> validateStructuredPayloadSize__src_services_chatReplyService_ts["validateStructuredPayloadSize
(chatReplyService.ts)"]
  generateChatReply__src_services_chatReplyService_ts["generateChatReply
(chatReplyService.ts)"] --> generateReplyFn__src_config_firebaseConfig_ts["generateReplyFn
(firebaseConfig.ts)"]
  loadDefaultAvatarBase64__src_services_defaultAvatarService_ts["loadDefaultAvatarBase64
(defaultAvatarService.ts)"] --> loadDefaultCharacterAvatar__src_utilities_loadDefaultAvatar_ts["loadDefaultCharacterAvatar
(loadDefaultAvatar.ts)"]
  createEdgeToolExecutors__src_services_edgeToolExecutors_ts["createEdgeToolExecutors
(edgeToolExecutors.ts)"] --> readFromWiki__src_services_wikiService_ts["readFromWiki
(wikiService.ts)"]
  createEdgeToolExecutors__src_services_edgeToolExecutors_ts["createEdgeToolExecutors
(edgeToolExecutors.ts)"] --> writeToWiki__src_services_wikiService_ts["writeToWiki
(wikiService.ts)"]
  parseResponse__src_services_imageGenerationService_ts["parseResponse
(imageGenerationService.ts)"] --> normalizeBase64__src_services_imageGenerationService_ts["normalizeBase64
(imageGenerationService.ts)"]
  generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"] --> generateImageFn__src_config_firebaseConfig_ts["generateImageFn
(firebaseConfig.ts)"]
  generateImageViaCallable__src_services_imageGenerationService_ts["generateImageViaCallable
(imageGenerationService.ts)"] --> parseResponse__src_services_imageGenerationService_ts["parseResponse
(imageGenerationService.ts)"]
  saveCharacterImageLocally__src_services_localImageStorageService_ts["saveCharacterImageLocally
(localImageStorageService.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  saveCharacterImageLocally__src_services_localImageStorageService_ts["saveCharacterImageLocally
(localImageStorageService.ts)"] --> sanitizeImageMimeType__src_utilities_imageMimeType_ts["sanitizeImageMimeType
(imageMimeType.ts)"]
  getLocalCharacterImageUri__src_services_localImageStorageService_ts["getLocalCharacterImageUri
(localImageStorageService.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getLocalCharacterImageUri__src_services_localImageStorageService_ts["getLocalCharacterImageUri
(localImageStorageService.ts)"] --> sanitizeImageMimeType__src_utilities_imageMimeType_ts["sanitizeImageMimeType
(imageMimeType.ts)"]
  deleteLocalCharacterImage__src_services_localImageStorageService_ts["deleteLocalCharacterImage
(localImageStorageService.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
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
  getMessageCount__src_services_messageService_ts["getMessageCount
(messageService.ts)"] --> getMessageCount__src_database_messageDatabase_ts["getMessageCount
(messageDatabase.ts)"]
  getLastMessage__src_services_messageService_ts["getLastMessage
(messageService.ts)"] --> getLastMessage__src_database_messageDatabase_ts["getLastMessage
(messageDatabase.ts)"]
  searchMessages__src_services_messageService_ts["searchMessages
(messageService.ts)"] --> searchMessages__src_database_messageDatabase_ts["searchMessages
(messageDatabase.ts)"]
  deleteCharacterMessages__src_services_messageService_ts["deleteCharacterMessages
(messageService.ts)"] --> deleteCharacterMessages__src_database_messageDatabase_ts["deleteCharacterMessages
(messageDatabase.ts)"]
  getMostRecentMessage__src_services_messageService_ts["getMostRecentMessage
(messageService.ts)"] --> getMostRecentMessage__src_database_messageDatabase_ts["getMostRecentMessage
(messageDatabase.ts)"]
  summarizeText__src_services_summarizeTextService_ts["summarizeText
(summarizeTextService.ts)"] --> summarizeTextFn__src_config_firebaseConfig_ts["summarizeTextFn
(firebaseConfig.ts)"]
  toUsageSnapshotPayload__src_services_usageSnapshot_ts["toUsageSnapshotPayload
(usageSnapshot.ts)"] --> isPlanStatus__src_services_usageSnapshot_ts["isPlanStatus
(usageSnapshot.ts)"]
  usageSnapshotFromError__src_services_usageSnapshot_ts["usageSnapshotFromError
(usageSnapshot.ts)"] --> toUsageSnapshotPayload__src_services_usageSnapshot_ts["toUsageSnapshotPayload
(usageSnapshot.ts)"]
  getUserProfile__src_services_userService_ts["getUserProfile
(userService.ts)"] --> getUserState__src_services_apiClient_ts["getUserState
(apiClient.ts)"]
  getUserProfile__src_services_userService_ts["getUserProfile
(userService.ts)"] --> mapUserProfileFromState__src_services_userService_ts["mapUserProfileFromState
(userService.ts)"]
  upsertUserProfile__src_services_userService_ts["upsertUserProfile
(userService.ts)"] --> updateUserProfile__src_services_apiClient_ts["updateUserProfile
(apiClient.ts)"]
  getUserPublic__src_services_userService_ts["getUserPublic
(userService.ts)"] --> getUserProfile__src_services_userService_ts["getUserProfile
(userService.ts)"]
  getUserPrivate__src_services_userService_ts["getUserPrivate
(userService.ts)"] --> getUserState__src_services_apiClient_ts["getUserState
(apiClient.ts)"]
  getUserPrivate__src_services_userService_ts["getUserPrivate
(userService.ts)"] --> mapUserProfileFromState__src_services_userService_ts["mapUserProfileFromState
(userService.ts)"]
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
  buildVoicePrompt__src_services_voiceChatService_ts["buildVoicePrompt
(voiceChatService.ts)"] --> getRecentConversationHistory__src_services_aiChatService_ts["getRecentConversationHistory
(aiChatService.ts)"]
  generateVoiceReply__src_services_voiceReplyService_ts["generateVoiceReply
(voiceReplyService.ts)"] --> generateVoiceReplyFn__src_config_firebaseConfig_ts["generateVoiceReplyFn
(firebaseConfig.ts)"]
  createWikiLlmProvider__src_services_wikiLlmProvider_ts["createWikiLlmProvider
(wikiLlmProvider.ts)"] --> wikiLlm__src_services_apiClient_ts["wikiLlm
(apiClient.ts)"]
  createWikiLlmProvider__src_services_wikiLlmProvider_ts["createWikiLlmProvider
(wikiLlmProvider.ts)"] --> generateEmbedding__src_services_apiClient_ts["generateEmbedding
(apiClient.ts)"]
  stop__src_services_wikiOrchestrator_ts["stop
(wikiOrchestrator.ts)"] --> clearWikiNoResultCache__src_services_wikiService_ts["clearWikiNoResultCache
(wikiService.ts)"]
  syncAll__src_services_wikiOrchestrator_ts["syncAll
(wikiOrchestrator.ts)"] --> getOrSpawn__src_services_wikiOrchestrator_ts["getOrSpawn
(wikiOrchestrator.ts)"]
  syncAll__src_services_wikiOrchestrator_ts["syncAll
(wikiOrchestrator.ts)"] --> stop__src_services_wikiOrchestrator_ts["stop
(wikiOrchestrator.ts)"]
  readFromWiki__src_services_wikiService_ts["readFromWiki
(wikiService.ts)"] --> getWikiNoResultCache__src_services_wikiService_ts["getWikiNoResultCache
(wikiService.ts)"]
  readFromWiki__src_services_wikiService_ts["readFromWiki
(wikiService.ts)"] --> addWikiNoResultQuery__src_services_wikiService_ts["addWikiNoResultQuery
(wikiService.ts)"]
  ensureWikiEmbeddingMigration__src_services_wikiService_ts["ensureWikiEmbeddingMigration
(wikiService.ts)"] --> clearWikiNoResultCache__src_services_wikiService_ts["clearWikiNoResultCache
(wikiService.ts)"]
  setupWiki__src_services_wikiService_ts["setupWiki
(wikiService.ts)"] --> createWikiLlmProvider__src_services_wikiLlmProvider_ts["createWikiLlmProvider
(wikiLlmProvider.ts)"]
  initWiki__src_services_wikiService_ts["initWiki
(wikiService.ts)"] --> getSourceTypeEnumMigrationSql__src_services_wikiService_ts["getSourceTypeEnumMigrationSql
(wikiService.ts)"]
  initWiki__src_services_wikiService_ts["initWiki
(wikiService.ts)"] --> setupWiki__src_services_wikiService_ts["setupWiki
(wikiService.ts)"]
  initWiki__src_services_wikiService_ts["initWiki
(wikiService.ts)"] --> ensureWikiEmbeddingMigration__src_services_wikiService_ts["ensureWikiEmbeddingMigration
(wikiService.ts)"]
  initWiki__src_services_wikiService_ts["initWiki
(wikiService.ts)"] --> markWikiEmbeddingMigrationComplete__src_services_wikiService_ts["markWikiEmbeddingMigrationComplete
(wikiService.ts)"]
  _resetWikiForTests__src_services_wikiService_ts["_resetWikiForTests
(wikiService.ts)"] --> clearWikiNoResultCache__src_services_wikiService_ts["clearWikiNoResultCache
(wikiService.ts)"]
  getMessageCount__src_database_messageDatabase_ts["getMessageCount
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  updateCharacter__src_database_characterDatabase_ts["updateCharacter
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  updateCharacter__src_database_characterDatabase_ts["updateCharacter
(characterDatabase.ts)"] --> normalizeVoice__src_constants_voiceDefaults_ts["normalizeVoice
(voiceDefaults.ts)"]
  updateCharacter__src_database_characterDatabase_ts["updateCharacter
(characterDatabase.ts)"] --> toAppFormat__src_database_characterDatabase_ts["toAppFormat
(characterDatabase.ts)"]
  getMessagesForContextSummary__src_database_messageDatabase_ts["getMessagesForContextSummary
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getMessagesForContextSummary__src_database_messageDatabase_ts["getMessagesForContextSummary
(messageDatabase.ts)"] --> toGiftedChatMessage__src_database_messageDatabase_ts["toGiftedChatMessage
(messageDatabase.ts)"]
  pruneMessagesForCharacter__src_database_messageDatabase_ts["pruneMessagesForCharacter
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  saveAIMessage__src_database_messageDatabase_ts["saveAIMessage
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  reportError__src_utilities_reportError_ts["reportError
(reportError.ts)"] --> logCrashlyticsError__src_services_crashlyticsService_ts["logCrashlyticsError
(crashlyticsService.ts)"]
  bootstrapSession__src_auth_bootstrapSession_ts["bootstrapSession
(bootstrapSession.ts)"] --> getCurrentUser__src_auth_googleSignin_ts["getCurrentUser
(googleSignin.ts)"]
  bootstrapSession__src_auth_bootstrapSession_ts["bootstrapSession
(bootstrapSession.ts)"] --> runBootstrapSession__src_auth_bootstrapSession_ts["runBootstrapSession
(bootstrapSession.ts)"]
  getUserCharacters__src_database_characterDatabase_ts["getUserCharacters
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getCharacter__src_database_characterDatabase_ts["getCharacter
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getCharacter__src_database_characterDatabase_ts["getCharacter
(characterDatabase.ts)"] --> toAppFormat__src_database_characterDatabase_ts["toAppFormat
(characterDatabase.ts)"]
  createCharacter__src_database_characterDatabase_ts["createCharacter
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  createCharacter__src_database_characterDatabase_ts["createCharacter
(characterDatabase.ts)"] --> normalizeVoice__src_constants_voiceDefaults_ts["normalizeVoice
(voiceDefaults.ts)"]
  createCharacter__src_database_characterDatabase_ts["createCharacter
(characterDatabase.ts)"] --> toAppFormat__src_database_characterDatabase_ts["toAppFormat
(characterDatabase.ts)"]
  deleteCharacter__src_database_characterDatabase_ts["deleteCharacter
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getCharacterCount__src_database_characterDatabase_ts["getCharacterCount
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  searchCharacters__src_database_characterDatabase_ts["searchCharacters
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getAllCharactersIncludingDeleted__src_database_characterDatabase_ts["getAllCharactersIncludingDeleted
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  batchInsertCharacters__src_database_characterDatabase_ts["batchInsertCharacters
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  batchInsertCharacters__src_database_characterDatabase_ts["batchInsertCharacters
(characterDatabase.ts)"] --> normalizeVoice__src_constants_voiceDefaults_ts["normalizeVoice
(voiceDefaults.ts)"]
  getUnsyncedCharacters__src_database_characterDatabase_ts["getUnsyncedCharacters
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  markCharacterSynced__src_database_characterDatabase_ts["markCharacterSynced
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  clearCharacterCloudLink__src_database_characterDatabase_ts["clearCharacterCloudLink
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getSoftDeletedCharacters__src_database_characterDatabase_ts["getSoftDeletedCharacters
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  hardDeleteCharacterLocal__src_database_characterDatabase_ts["hardDeleteCharacterLocal
(characterDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getDatabase__src_database_index_ts["getDatabase
(index.ts)"] --> openDatabaseAsyncWithRetry__src_database_index_ts["openDatabaseAsyncWithRetry
(index.ts)"]
  getDatabase__src_database_index_ts["getDatabase
(index.ts)"] --> initializeDatabase__src_database_index_ts["initializeDatabase
(index.ts)"]
  getMessages__src_database_messageDatabase_ts["getMessages
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getMessages__src_database_messageDatabase_ts["getMessages
(messageDatabase.ts)"] --> toGiftedChatMessage__src_database_messageDatabase_ts["toGiftedChatMessage
(messageDatabase.ts)"]
  sendMessage__src_database_messageDatabase_ts["sendMessage
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  deleteMessage__src_database_messageDatabase_ts["deleteMessage
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  updateMessageText__src_database_messageDatabase_ts["updateMessageText
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getLastMessage__src_database_messageDatabase_ts["getLastMessage
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getLastMessage__src_database_messageDatabase_ts["getLastMessage
(messageDatabase.ts)"] --> toGiftedChatMessage__src_database_messageDatabase_ts["toGiftedChatMessage
(messageDatabase.ts)"]
  searchMessages__src_database_messageDatabase_ts["searchMessages
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  searchMessages__src_database_messageDatabase_ts["searchMessages
(messageDatabase.ts)"] --> toGiftedChatMessage__src_database_messageDatabase_ts["toGiftedChatMessage
(messageDatabase.ts)"]
  deleteCharacterMessages__src_database_messageDatabase_ts["deleteCharacterMessages
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getMostRecentMessage__src_database_messageDatabase_ts["getMostRecentMessage
(messageDatabase.ts)"] --> getDatabase__src_database_index_ts["getDatabase
(index.ts)"]
  getMostRecentMessage__src_database_messageDatabase_ts["getMostRecentMessage
(messageDatabase.ts)"] --> toGiftedChatMessage__src_database_messageDatabase_ts["toGiftedChatMessage
(messageDatabase.ts)"]
  CharacterPromptBuilder__src_services_CharacterPromptBuilder_ts["CharacterPromptBuilder
(CharacterPromptBuilder.ts)"] --> __services_aiChatService["aiChatService
(services)"]
  crashlyticsService__src_services_crashlyticsService_ts["crashlyticsService
(crashlyticsService.ts)"] --> __utilities_kvStorage["kvStorage
(utilities)"]
  syncMessage__src_services_syncMessage_ts["syncMessage
(syncMessage.ts)"] --> __database_messageDatabase["messageDatabase
(database)"]
```

> **Note:** Edges involving Firebase callable functions (created via `httpsCallable()`) are
> not captured here. Because callables are instantiated at module scope and invoked indirectly,
> static analysis cannot trace them as call edges. Affected call sites include
> `generateReplyFn`, `generateVoiceReplyFn`, `summarizeTextFn`, and similar callable wrappers.
