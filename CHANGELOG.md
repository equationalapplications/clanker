# [29.1.0](https://github.com/equationalapplications/clanker/compare/v29.0.0...v29.1.0) (2026-04-27)


### Bug Fixes

* **voice:** address code review feedback for error handling and UI state ([3867e12](https://github.com/equationalapplications/clanker/commit/3867e12482a1f1810ff61c006567c7ed40ac5cfd))
* **voice:** anchor parsePcmParam regex to parameter boundaries ([6c3c24d](https://github.com/equationalapplications/clanker/commit/6c3c24df91be7ae183c6509bca3930cff63bd503))
* **voice:** handle nomatch + no-speech gracefully with friendly errors ([40dc4e8](https://github.com/equationalapplications/clanker/commit/40dc4e81d7d67865e53cd1488d217feb500b8977))
* **voice:** platform-aware permission error message; trim whitespace in normalizeVoice ([b4955ca](https://github.com/equationalapplications/clanker/commit/b4955ca27e5f539a26fee0d4d948ca48158b5c66))
* **voice:** resolve talk page re-entrancy and web audio playback ([6c04b6d](https://github.com/equationalapplications/clanker/commit/6c04b6d5ec5d9fa2a3bb0d1c2d7cd055df438ae2))
* **voice:** validate PCM params before writing WAV header; deduplicate test ([78865f6](https://github.com/equationalapplications/clanker/commit/78865f61955dae7a086f36ab22b21b1c8d1156a2))


### Features

* **voice:** complete voice selection with web support and modern FileSystem ([408f1d3](https://github.com/equationalapplications/clanker/commit/408f1d31a12c438a18aee8bd1d78e5ff8ca58ee0))

# [29.0.0](https://github.com/equationalapplications/clanker/compare/v28.8.0...v29.0.0) (2026-04-26)


### Bug Fixes

* **schema:** include voice in base table ([13ce108](https://github.com/equationalapplications/clanker/commit/13ce10803f57bc586af786e725ffa9d8d9add376))
* **voice:** centralize app default voice constant ([1cd0380](https://github.com/equationalapplications/clanker/commit/1cd0380afade152128bc5346f12c4b2a8b30cb4e))
* **voice:** centralize functions default and trim normalization ([c3c3f31](https://github.com/equationalapplications/clanker/commit/c3c3f312f6a2ae8441a77a82b167ff35a62a2382))
* **voice:** default and backfill voice values ([22cf463](https://github.com/equationalapplications/clanker/commit/22cf463dea9e2b72ab50383f5938e8428f394a7e))
* **voice:** enforce default and sync persist ([02a4dcc](https://github.com/equationalapplications/clanker/commit/02a4dcc140cd3298fc6b88593650eb904dc71ab6))
* **voice:** enforce non-null voice writes ([f4b159f](https://github.com/equationalapplications/clanker/commit/f4b159f0b5f60310278441eceff4686cc2d4d764))
* **voice:** migration guard and sync type safety ([d773543](https://github.com/equationalapplications/clanker/commit/d773543114041e7c4f7a33f7c7005d0223428778)), closes [#318](https://github.com/equationalapplications/clanker/issues/318)
* **voice:** normalize whitespace across all layers ([0bacb51](https://github.com/equationalapplications/clanker/commit/0bacb5188a9f0108381383f0863219e5727cb03c)), closes [#318](https://github.com/equationalapplications/clanker/issues/318)
* **voice:** preserve omitted voice and normalize blanks ([e9ea574](https://github.com/equationalapplications/clanker/commit/e9ea5743beb1318aad3215f77d82e7f79086f3d9)), closes [#318](https://github.com/equationalapplications/clanker/issues/318)
* **voice:** split migration 9 backfill, trim whitespace in SQLite and Postgres ([7584773](https://github.com/equationalapplications/clanker/commit/7584773a7e0c27d8b17bdc504740c96fecd4dc5f))


### Features

* **voice:** persist character voice end-to-end ([feca2db](https://github.com/equationalapplications/clanker/commit/feca2db373cfde69031bb3cf15c98ac742740bf9))


### BREAKING CHANGES

* **voice:** app.config.ts now includes expo-audio plugin.
Native build required. Cannot OTA.

# [28.8.0](https://github.com/equationalapplications/clanker/compare/v28.7.1...v28.8.0) (2026-04-25)


### Bug Fixes

* **avatar:** use single File instance with try/finally for guaranteed cleanup ([707b33a](https://github.com/equationalapplications/clanker/commit/707b33a5db9680bee4fd86d4d99803b65418da19))
* clean up temp webp files after avatar upload ([7c6eab6](https://github.com/equationalapplications/clanker/commit/7c6eab63eba7f87c8b208ebf3f22bb0cc18f2fb4))


### Features

* **avatar:** migrate to File API and remove size constraints ([6fec4fd](https://github.com/equationalapplications/clanker/commit/6fec4fd538552b02c0343825ae8be54616020374))
* **characters:** add photo library avatar upload ([37900a2](https://github.com/equationalapplications/clanker/commit/37900a2f6d3da2e01c99c4bae1baaf79dca9a8be))

## [28.7.1](https://github.com/equationalapplications/clanker/compare/v28.7.0...v28.7.1) (2026-04-24)


### Bug Fixes

* **deeplinks:** replace clanker.app with clanker-ai.com across all platforms ([61e1916](https://github.com/equationalapplications/clanker/commit/61e1916e37342b40b3c51ac145578aa2640e0064))

# [28.7.0](https://github.com/equationalapplications/clanker/compare/v28.6.1...v28.7.0) (2026-04-24)


### Bug Fixes

* **deps:** add expo-file-system to package.json to fix CI lint failure ([3fc8f82](https://github.com/equationalapplications/clanker/commit/3fc8f823456b4d1bd5f6aee66cf4a58683fd70d4))
* guard stale state in voice events and settings ([3eb2014](https://github.com/equationalapplications/clanker/commit/3eb2014e0aaf6903a9d70955cf87d00119181c2d))
* **settings:** gate initial darkMode read on preferences consent on web ([8c7943c](https://github.com/equationalapplications/clanker/commit/8c7943c5654971a0cdc3f1de663e7735579a745b))
* **settings:** narrow SettingKey types and gate darkMode consent web-only ([91ccace](https://github.com/equationalapplications/clanker/commit/91ccacea7865dd2764123ed27ed11444639e331c))
* **tests:** mock crashlyticsService in failing test suites to fix CI ([c9973ab](https://github.com/equationalapplications/clanker/commit/c9973ab284f60a193e04788d5d4de1b82ffad82a))
* **voice:** add clearListenTimer to startListening useCallback deps ([9706ef4](https://github.com/equationalapplications/clanker/commit/9706ef4088537ba2e21588a017e154a0764f5185))
* **voice:** apply fourth review batch feedback ([9ba4cb6](https://github.com/equationalapplications/clanker/commit/9ba4cb6e39c0023f42d9f9174f95e3c276a3ee7f))
* **voice:** apply review feedback from PR [#306](https://github.com/equationalapplications/clanker/issues/306) ([ec96ed8](https://github.com/equationalapplications/clanker/commit/ec96ed82a0104703b15dee9420d1326841e87e38))
* **voice:** apply second review batch feedback ([fa70d66](https://github.com/equationalapplications/clanker/commit/fa70d66d71e8032273ed0f85bffcc0927113969a))
* **voice:** apply third review batch feedback ([f74e959](https://github.com/equationalapplications/clanker/commit/f74e95910661add3b66e510327b42df8b09c1527))
* **voice:** defensive filter for styleHints and clearer TTS instruction ([f8eedda](https://github.com/equationalapplications/clanker/commit/f8eedda3fd2a21d14e789eb8c06a3a0819c624e9))
* **voice:** move credit spend to after successful text+TTS generation ([200c833](https://github.com/equationalapplications/clanker/commit/200c83340ae7c030cc694e6af7dd68a6b555e9c9))
* **voice:** remove unawaited removeItem from clearSettings; drop misleading fallback message in voiceChatService catch block ([f34a158](https://github.com/equationalapplications/clanker/commit/f34a1585ed6528f3999e29892856054175af9078))
* **voice:** use character.avatar (not appearance) for AI message avatar in voiceChatService ([63f3843](https://github.com/equationalapplications/clanker/commit/63f3843cf4b8fafc4307ab9c92e2d99ef6992fa7))
* **voice:** use import type for UsageSnapshot/IMessage; fix settingsStorage indentation ([c684047](https://github.com/equationalapplications/clanker/commit/c684047bb1a254e32dd238058c7805079eba8f03))
* **voice:** use MIME-to-extension lookup map for audio file path ([8a7e7fd](https://github.com/equationalapplications/clanker/commit/8a7e7fd80e83e06063e77959b9ba60dc14fde3a4))


### Features

* **cookies:** enforce consent rules for settings persistence and Crashlytics ([f2d946c](https://github.com/equationalapplications/clanker/commit/f2d946cc5672a1176f2d70243023f1202a3070a2))
* **voice:** add Talk tab with voice conversation support ([53e32c3](https://github.com/equationalapplications/clanker/commit/53e32c3d2d6b156d119ad434d864754c93900c3f))


### Performance Improvements

* **voice:** cache GoogleGenAI client at module level in generateVoiceReply ([8b0c333](https://github.com/equationalapplications/clanker/commit/8b0c3332faeda5edb5cc03cd1f51ec0dcd293fe7))

## [28.6.1](https://github.com/equationalapplications/clanker/compare/v28.6.0...v28.6.1) (2026-04-24)


### Bug Fixes

* **schema:** handle NULL owner_user_id/is_public in migration 8 backfill ([288b6b0](https://github.com/equationalapplications/clanker/commit/288b6b0c9ad3ffb922425aa22fed54f302200dfb))

# [28.6.0](https://github.com/equationalapplications/clanker/compare/v28.5.1...v28.6.0) (2026-04-24)


### Bug Fixes

* **consent:** enforce necessary=true at storage + canUse boundaries ([f30356c](https://github.com/equationalapplications/clanker/commit/f30356c179cd6660c5da4ae40112b601e0221286))
* **CookieConsentBanner:** remove invalid accessibilityRole='dialog' from View ([51d3e2a](https://github.com/equationalapplications/clanker/commit/51d3e2a34b9f0c72f02c4bbe30d7f8652339e0a2))
* **test:** apply code review feedback on jest setup and context perf ([af233a2](https://github.com/equationalapplications/clanker/commit/af233a2efc83502d6de323e39b1a24a796256084))
* **test:** remove TS type annotation from plain JS jest.setup.js ([4d3136c](https://github.com/equationalapplications/clanker/commit/4d3136cda4c559a6c7a96d82af7bd1cf4ca5fb3c))
* **test:** strip remaining TS annotations from plain JS jest.setup.js ([eda9e59](https://github.com/equationalapplications/clanker/commit/eda9e591589199b580016867e6fc32206270e17a))
* **web:** address review feedback on gap, localStorage mock, and getStorage ([d121934](https://github.com/equationalapplications/clanker/commit/d121934276e4dd7244317e3f8ac8c532ef953905))
* **web:** flatten style arrays in Link asChild children to resolve CSSStyleDeclaration crash ([6b909c4](https://github.com/equationalapplications/clanker/commit/6b909c4a1316bd4eec133a592955ad192172a67a))
* **web:** remove animationType fade from Modal to fix useNativeDriver and CSSStyleDeclaration crash ([10580b7](https://github.com/equationalapplications/clanker/commit/10580b79911ab8bac387112c9776329071e0c705))
* **web:** resolve CSSStyleDeclaration indexed setter error in cookie banner ([f08ec9b](https://github.com/equationalapplications/clanker/commit/f08ec9beb5890c36db1f664be70994c3c10bfaa8))


### Features

* **web:** add cookie consent banner and preferences modal ([92b4efa](https://github.com/equationalapplications/clanker/commit/92b4efaf788452fb37d37a3dfcc5655cb1b27394))
* **web:** add cookie consent provider and canUse gating ([369884b](https://github.com/equationalapplications/clanker/commit/369884b1552a0efeaf42df7e8e4575c80fa0e221))
* **web:** add cookie consent storage and types ([c5dd97d](https://github.com/equationalapplications/clanker/commit/c5dd97d6c54d1863ec7eed51d073d27b1ad0c733))
* **web:** integrate cookie consent provider and UI into app layout ([f1fddb5](https://github.com/equationalapplications/clanker/commit/f1fddb54b80ab926a60202e14afee06c5d9925b1))

## [28.5.1](https://github.com/equationalapplications/clanker/compare/v28.5.0...v28.5.1) (2026-04-24)


### Bug Fixes

* **db:** add migration 8 for owner backfill repair ([3505252](https://github.com/equationalapplications/clanker/commit/3505252aec6ea881fea7cfbfcd6c745456e97430))
* **db:** backfill owner for local chars ([93928c7](https://github.com/equationalapplications/clanker/commit/93928c76eb72edcd5d343e96cb5fb3381fbdad56))

# [28.5.0](https://github.com/equationalapplications/clanker/compare/v28.4.0...v28.5.0) (2026-04-23)


### Bug Fixes

* **auth-redirect:** address code review feedback ([05bbd4c](https://github.com/equationalapplications/clanker/commit/05bbd4cf9c6db56c0b9d1f0eb15f168707411ab4))
* **characters:** gate owner backfill and save flow ([452c0b4](https://github.com/equationalapplications/clanker/commit/452c0b49a6f430d616ab2ca21d44b6fec6b7b1b1))
* **characters:** simplify subscription requirement message ([fcb6f0c](https://github.com/equationalapplications/clanker/commit/fcb6f0c5791f041aec2b10f53c89229b895a6631))
* **database:** clear save_to_cloud when unsyncing character ([3545bc2](https://github.com/equationalapplications/clanker/commit/3545bc2847f02cfe5fef1d0570dda333be858041))
* **data:** harden lock and ownership errors ([d9e4407](https://github.com/equationalapplications/clanker/commit/d9e44079ce66cbd65194a528924942f8409da220))
* **functions:** map ownership errors consistently ([3cd685e](https://github.com/equationalapplications/clanker/commit/3cd685e333bd00da91a9fb0802d5530ef9128b39))
* **functions:** use Firebase UID for ownerUserId, not internal user ID ([af82c93](https://github.com/equationalapplications/clanker/commit/af82c938277a07a9683af91a19b32ee46124acaa))
* **landing:** remove JS timer from hero shiver ([fba23db](https://github.com/equationalapplications/clanker/commit/fba23db1b34d84937fb1521f91238442af8544f9))
* **landing:** use internal router navigation to resolve sign-in loop on web ([7fe9a59](https://github.com/equationalapplications/clanker/commit/7fe9a59f181392fe2b0895428898bbd391504c9a))
* **machine:** scope sync/unsync errors + eliminate public char owner round-trip ([2ccfd24](https://github.com/equationalapplications/clanker/commit/2ccfd245847cf72c484eb0e69ea5431f8e7377e5))
* **sync:** prevent stale cloud unsync state and tighten cloud unlink logic ([d4f9ed9](https://github.com/equationalapplications/clanker/commit/d4f9ed9de3d03bfc20d31e8ceb58591b3b651950))
* **sync:** tighten cloud update guard ([5f2466c](https://github.com/equationalapplications/clanker/commit/5f2466c69ed9e7a8c0f5d9d8a8686e1912ee4dc9))
* **ui:** guard cloud sync button + block nav during cloudUnsyncing ([084f835](https://github.com/equationalapplications/clanker/commit/084f83503b187e7d37d57504209fbd48c1af94d1))
* **ui:** scope cloud sync toast errors ([c77a4f9](https://github.com/equationalapplications/clanker/commit/c77a4f9c4c9700eb66bf987292c1fb54d50098a0))
* **web:** reduce auth root re-renders by splitting useSelector state selectors ([5777430](https://github.com/equationalapplications/clanker/commit/57774308eab141ca970d9a2d6c87b4572c74c4c3))


### Features

* **characters:** add owner_user_id column with backfill migration ([54d2161](https://github.com/equationalapplications/clanker/commit/54d2161bc157cde7172f9dabf4bb6fbc5f92785e))
* **characters:** add useSyncCharacters and useUnsyncCharacter hooks ([e5683fe](https://github.com/equationalapplications/clanker/commit/e5683fe87fa5fe25e167adbbb7d4e9f79ce0fcc2))
* **characters:** machine cloudSyncing and cloudUnsyncing with locking ([f6f639d](https://github.com/equationalapplications/clanker/commit/f6f639d6183882b394d36a51dc6527aedca480eb))
* **characters:** ownership read-only mode and cloud removal confirm ([bbaa126](https://github.com/equationalapplications/clanker/commit/bbaa126d2e44014e72944b6a276d484231ee6485))
* **characters:** support unsync from cloud preserving local copy ([0958acc](https://github.com/equationalapplications/clanker/commit/0958acc4cf8e3c83518b5fa8aa5ab8ebb241abad))
* **functions:** expose owner and enforce owner-only character writes ([d4b0270](https://github.com/equationalapplications/clanker/commit/d4b027089b9396522f7fc49f53109fab75fbe10b))

# [28.4.0](https://github.com/equationalapplications/clanker/compare/v28.3.4...v28.4.0) (2026-04-23)


### Bug Fixes

* **landing:** address code review feedback ([b5a5ac1](https://github.com/equationalapplications/clanker/commit/b5a5ac1ef0bb21feb4f5dd6fb01403a14e829668))
* **landing:** address code review feedback (round 2) ([ec53ae6](https://github.com/equationalapplications/clanker/commit/ec53ae6ecb2d274cc7b2d861bc1acefef467def6))
* **landing:** improve SEO and link crawlability ([943004b](https://github.com/equationalapplications/clanker/commit/943004bac004267904d11b984e2d6fccaacb4f63))
* **landing:** tighten hero section spacing ([2037f5c](https://github.com/equationalapplications/clanker/commit/2037f5cab1c3d7cec5b33fa75ed191beb7570533))


### Features

* **landing:** web landing page with deep link auth redirect ([5ef3d82](https://github.com/equationalapplications/clanker/commit/5ef3d8257c50fef7635da0a8b93330c6313a9452))

## [28.3.4](https://github.com/equationalapplications/clanker/compare/v28.3.3...v28.3.4) (2026-04-23)


### Bug Fixes

* **auth:** explicitly set iOS client IDs for sign-in ([e56ad3a](https://github.com/equationalapplications/clanker/commit/e56ad3a83d11e098921e08d3ba9b19ac9b970487))
* **payments:** harden RC product ID handling ([4faf8bf](https://github.com/equationalapplications/clanker/commit/4faf8bf8d98122cb9598a74189b363b3765bacb5))

## [28.3.3](https://github.com/equationalapplications/clanker/compare/v28.3.2...v28.3.3) (2026-04-22)


### Bug Fixes

* **purchases:** use base plan ID for Android subscription ([24dbdbe](https://github.com/equationalapplications/clanker/commit/24dbdbe09a8d5fc5dedceaf1b8e67992eb9231ff))

## [28.3.2](https://github.com/equationalapplications/clanker/compare/v28.3.1...v28.3.2) (2026-04-22)


### Bug Fixes

* **auth:** address code review feedback ([8cd86ae](https://github.com/equationalapplications/clanker/commit/8cd86ae9b1fbbc90c434b97e86d3dc40b421b17a))
* **auth:** validate env vars and cleanup on bootstrap failure ([aa70d22](https://github.com/equationalapplications/clanker/commit/aa70d220f54fa97f2d1bfd1ec56284e80783afc3))

## [28.3.1](https://github.com/equationalapplications/clanker/compare/v28.3.0...v28.3.1) (2026-04-22)


### Bug Fixes

* **auth:** consistent env var usage in googleSignin.web ([10a164a](https://github.com/equationalapplications/clanker/commit/10a164af014c2c9f03f85cd38a9bdcd42cff0fdb))
* **auth:** reset failed bootstrap sessions ([bb26ded](https://github.com/equationalapplications/clanker/commit/bb26ded3f1eea62071679694fdb12fa0d3ac4066))

# [28.3.0](https://github.com/equationalapplications/clanker/compare/v28.2.0...v28.3.0) (2026-04-22)


### Bug Fixes

* **characters:** clarify cloud save subscription message ([01cb2d1](https://github.com/equationalapplications/clanker/commit/01cb2d1abf7882c7cf4106bf5a5643b4f09c8c29))
* **characters:** use theme color in share modal; fix schema version doc ([447396a](https://github.com/equationalapplications/clanker/commit/447396a7a9a1ee03994f03e58da72dead706362c))
* **checkout:** address PR review feedback for web checkout sync ([1735acd](https://github.com/equationalapplications/clanker/commit/1735acde71bb41284117a2a3c4ba7c4d0e05cecc))


### Features

* **chat:** make Enter send message, Shift+Enter adds newline ([549c6fd](https://github.com/equationalapplications/clanker/commit/549c6fd352d66eb690e488f4a69031fea531bd02))
* **checkout:** multi-tab robustness + Stripe return recovery ([9abd565](https://github.com/equationalapplications/clanker/commit/9abd56507409ab4fdd4ade7179206176e26fbfa7))
* **subscribe:** add Apple EULA link to Legal card ([915234a](https://github.com/equationalapplications/clanker/commit/915234aeae6913b0b45f7f906ed55bba19e026f4))

# [28.2.0](https://github.com/equationalapplications/clanker/compare/v28.1.1...v28.2.0) (2026-04-22)


### Bug Fixes

* **build:** simplify local EAS builds via env var injection ([2d9b6ac](https://github.com/equationalapplications/clanker/commit/2d9b6ac18d2bb3ed8b72f88c32f5b5c2ff5c9bd2))
* **build:** stabilize local firebase temp paths ([51d50e5](https://github.com/equationalapplications/clanker/commit/51d50e5f231bcafaef7d8f4ff3b755a7e0a624b3))
* **characters:** add share-sheet error handling ([4b32489](https://github.com/equationalapplications/clanker/commit/4b32489f58e5134a47494871ecc4597fef48a5d6))
* **characters:** address final review nits ([6b2fb1c](https://github.com/equationalapplications/clanker/commit/6b2fb1cfa7e89e5b2989970feb78f2005fc86dbf))
* **characters:** address review feedback on naming and state ([a4a9a2f](https://github.com/equationalapplications/clanker/commit/a4a9a2f80a6aa6d495799e84f62f28dc683e4ba2))
* **characters:** harden qr generation and sync transition logic ([10a27d5](https://github.com/equationalapplications/clanker/commit/10a27d52a7cf335b1d50cafc1602a9d27912f451))
* **characters:** make share failure toast generic ([40d128d](https://github.com/equationalapplications/clanker/commit/40d128d720e2930ef7e2aae9e3c87b171e7e928e))
* **characters:** polish migration and share error messages ([d7f840a](https://github.com/equationalapplications/clanker/commit/d7f840a9c94396da235d7456a81bdeb8474d11e4))
* **characters:** polish qr error handling and logging ([5f25eff](https://github.com/equationalapplications/clanker/commit/5f25effafd6ec4d374baf7630aed3b47e08d6a6a))
* **characters:** refine messaging and shareable state naming ([4411e7b](https://github.com/equationalapplications/clanker/commit/4411e7b7a9f26f10b5f190229c1312e276ca6972))
* **characters:** remove qr code and resolve review follow-ups ([fee0f3a](https://github.com/equationalapplications/clanker/commit/fee0f3a8dd42a332d47a70ae823a51d9ef410bb1))
* **characters:** resolve remaining PR review feedback ([fc8430f](https://github.com/equationalapplications/clanker/commit/fc8430f07994b283e5718ac2d1c33a8a6ab8db62))
* **chat:** advance summary_checkpoint before attempt to prevent burst retries on failure ([e2e9c48](https://github.com/equationalapplications/clanker/commit/e2e9c48c35bc7305996b78ab01c04f56010d5392))
* **chat:** persist summary checkpoints for 20-message batches ([8b2167d](https://github.com/equationalapplications/clanker/commit/8b2167d71e1f4ce05480ba6e384689a295762da2))
* **chat:** resolve three review issues - web callable, role detection, and getModel error handling ([70e5b30](https://github.com/equationalapplications/clanker/commit/70e5b30799692d10fa2a25aa102c378370816a94))
* **chat:** select most recent messages for prompt context ([0655d89](https://github.com/equationalapplications/clanker/commit/0655d899c534a6e967ebb65f1f0407ce5592ff5d))
* **docs:** make local Firebase base64 commands cross-platform ([13b1004](https://github.com/equationalapplications/clanker/commit/13b1004f1a44d9047f43eb7be2a3d3989fa2bccb))
* **functions:** harden summarizeText input typing ([2c84b5d](https://github.com/equationalapplications/clanker/commit/2c84b5d2b715f2c04399cd26c2163f861b05d755))
* **functions:** remove hardcoded maxCharacters upper bound from summarizeText ([1161dd3](https://github.com/equationalapplications/clanker/commit/1161dd3af4f3019d2ea9af9b94240e9cf0be0363))


### Features

* **characters:** add cloud save share UI and deep-link import ([85e82c4](https://github.com/equationalapplications/clanker/commit/85e82c4034cc4a04bd016c136e3490daf7fcf236))
* **characters:** add cloud share backend and opt-in sync flag ([9578d86](https://github.com/equationalapplications/clanker/commit/9578d86954219cd76b02935b331819f31512e82d))
* **chat:** add background chat memory summarization pipeline ([cf48f2c](https://github.com/equationalapplications/clanker/commit/cf48f2cc48e3106fda7c3e6cfa151e128cf7fccb))

## [28.1.1](https://github.com/equationalapplications/clanker/compare/v28.1.0...v28.1.1) (2026-04-21)


### Bug Fixes

* **docs:** indent checklist code fence in firebase setup guide ([1b8f32e](https://github.com/equationalapplications/clanker/commit/1b8f32efccf093be3972ddadd5aaa8c2282a16a6))
* **services:** trim verifiedAt in usage parsers ([65b444d](https://github.com/equationalapplications/clanker/commit/65b444dfb8f48e133e1815a15aed04f7b9c4d5f2))

# [28.1.0](https://github.com/equationalapplications/clanker/compare/v28.0.1...v28.1.0) (2026-04-21)


### Bug Fixes

* **auth:** clear stale pending refresh replay reason ([ad2c442](https://github.com/equationalapplications/clanker/commit/ad2c4422961f6014d28e1e64bca03a488693ef4b))
* **auth:** require server verifiedAt and align user optimistic patching ([105604c](https://github.com/equationalapplications/clanker/commit/105604ce7c48baa76012d979dce231c99a9589d2))
* **auth:** simplify optimistic profile patch payloads ([728dce8](https://github.com/equationalapplications/clanker/commit/728dce835e961df012d607ca597c661fa21239a2))
* **auth:** surface machine errors in user hooks ([a09ebf4](https://github.com/equationalapplications/clanker/commit/a09ebf418cd69efd5481c7f7f1d69df89da6987a))
* **functions:** normalize usage planStatus in image and chat handlers ([a5f58c7](https://github.com/equationalapplications/clanker/commit/a5f58c70a061bee506890e99d47389c2c74fffb6))
* normalize email lookup and docs ([9eb653e](https://github.com/equationalapplications/clanker/commit/9eb653ec01c4e0d98001e70e045f4512f3f075d3))


### Features

* **auth:** make bootstrap refresh event-driven ([2efa422](https://github.com/equationalapplications/clanker/commit/2efa422a837fd1824be882b38e08cc86f9ed3971))

## [28.0.1](https://github.com/equationalapplications/clanker/compare/v28.0.0...v28.0.1) (2026-04-21)


### Bug Fixes

* **auth:** normalize email and gate appcheck ([e21f19a](https://github.com/equationalapplications/clanker/commit/e21f19a4b8e92a679a14b27d94fe16ff16cf5723))

# [28.0.0](https://github.com/equationalapplications/clanker/compare/v27.1.1...v28.0.0) (2026-04-21)


* refactor!: migrate from Supabase to dedicated Cloud SQL ([dd0ca95](https://github.com/equationalapplications/clanker/commit/dd0ca95b92d1ed7c120e300d80f0ab09bcf65c9d))


### Bug Fixes

* address pr 268 code review feedback ([573e3b5](https://github.com/equationalapplications/clanker/commit/573e3b5abfb725309251c85757c07f107297c4d7))
* address PR 268 code review feedback ([a4841c0](https://github.com/equationalapplications/clanker/commit/a4841c0796ebe3f8930445fe0b0cf72297296d71))
* address PR review feedback on user and character services ([59df959](https://github.com/equationalapplications/clanker/commit/59df9596afe4f5c14eacbbe47b6c5c0e8d3cf3a1))
* address PR268 review feedback ([0cb57c2](https://github.com/equationalapplications/clanker/commit/0cb57c265f0bf3b65c111fffdf6f25b2d7fa1afc))
* address pr268 review items ([1253c89](https://github.com/equationalapplications/clanker/commit/1253c899adf081ecfbb8440b02bd916eee8d16ea))
* **api:** harden callable contract handling ([6155a2a](https://github.com/equationalapplications/clanker/commit/6155a2aade3dc7801f5c072d443e8ab6c8aa3263))
* **appcheck:** update recaptcha key and debug token ([8652c53](https://github.com/equationalapplications/clanker/commit/8652c5348923038283c3a2a19329ab29229dc5b4))
* **auth:** avoid date drift and credit reset ([dd00b32](https://github.com/equationalapplications/clanker/commit/dd00b32a1a86ca050ba20119c22adb05e10e0da3))
* **auth:** dedupe bootstrap session calls ([4077c38](https://github.com/equationalapplications/clanker/commit/4077c38d97545ef4d2dca56f39e8692fd3fd4e78))
* **auth:** isolate bootstrap by uid ([4ed7dc1](https://github.com/equationalapplications/clanker/commit/4ed7dc1ed4a64ee83f967a7a3466c8a8e79bcb1c))
* **auth:** preserve error when transitioning to signedOut ([c61201f](https://github.com/equationalapplications/clanker/commit/c61201fd65a4710808fe718ac97f7876d3c54a44))
* **auth:** remove unnecessary CORS allowlist and clarify Cloud Run IAM requirement ([d43a780](https://github.com/equationalapplications/clanker/commit/d43a780e5b1221c2d5ec895bc1163418daa98f61))
* **billing:** gate credits on active subscription status ([77f58ae](https://github.com/equationalapplications/clanker/commit/77f58aed495879efab67ea800bfd9926f711d148))
* **character:** make provided-id upsert atomic ([7fb7b65](https://github.com/equationalapplications/clanker/commit/7fb7b65095e16bb460b7a6849510af9b4b737ce0))
* consolidate purchase refresh mechanism ([0ee034d](https://github.com/equationalapplications/clanker/commit/0ee034da27e910155a419cb711739d121974465a))
* **credits:** refresh query after native purchase ([2bddc87](https://github.com/equationalapplications/clanker/commit/2bddc87add35f48d19e8c4c1e8ec610d4dca32a6))
* **exchangeToken:** convert Date timestamps to ISO strings in callable response ([73b9357](https://github.com/equationalapplications/clanker/commit/73b93574bc00bcbf1a3ffb91e60a7b92116b3fb5))
* **functions:** address PR 268 review feedback ([ab2f631](https://github.com/equationalapplications/clanker/commit/ab2f631edcd308be7da8d70b3fe32c24a829c833))
* **functions:** align credit spending and reduce Stripe function secrets ([bf70748](https://github.com/equationalapplications/clanker/commit/bf70748aa60b1092449a42842e138938d90fa93e))
* **functions:** bootstrap defaults in acceptTerms ([3e411ae](https://github.com/equationalapplications/clanker/commit/3e411ae89cca0cd637e0bd0bbbaf2bed028d63a7))
* **functions:** detect cloud sql config errors ([19a2232](https://github.com/equationalapplications/clanker/commit/19a2232e2260e1f2f759ad4a7ca5c311a6891fc3))
* **functions:** enforce ownership and input validation ([d6d4056](https://github.com/equationalapplications/clanker/commit/d6d40566739f5015bb966392d1ce5a1bd0b65635))
* **functions:** guard callable payload validation ([009c4d5](https://github.com/equationalapplications/clanker/commit/009c4d5c4b820c29a310ec54f1582e54e80abe48))
* **functions:** guard idempotent credit delta ([66241e4](https://github.com/equationalapplications/clanker/commit/66241e46724f76e96598f0a0a81d7966b812bb89))
* **functions:** normalize callable bootstrap errors ([332e8c3](https://github.com/equationalapplications/clanker/commit/332e8c367224f2c82c71d244ce716399a43d6c6e))
* **functions:** prevent duplicate credit mutations and validate character fields ([314cd3b](https://github.com/equationalapplications/clanker/commit/314cd3b5ff8f1f37b67716af06ec8aa53b88fa98))
* **functions:** require non-null user timestamps ([b1ebe7b](https://github.com/equationalapplications/clanker/commit/b1ebe7b4d803bcb4f19fe94a77b7ba762a1506ae))
* **functions:** resolve latest copilot review findings ([587d517](https://github.com/equationalapplications/clanker/commit/587d51724a3db380baa73aeff9ce14e056b0b9e3))
* **functions:** resolve test paths from cwd ([c322262](https://github.com/equationalapplications/clanker/commit/c322262c97d382a1ecf147556cd83acb94195f86))
* **functions:** serialize callable timestamps to ISO strings ([bac18c0](https://github.com/equationalapplications/clanker/commit/bac18c02c9be05b5b8c6bb0c633e2b7381168300))
* **functions:** use public IP for Cloud SQL connector ([d333fac](https://github.com/equationalapplications/clanker/commit/d333fac5c33568209c2c115a6ae728b4686f8177))
* implement PR 268 review feedback for type safety and error consistency ([a3dcf7e](https://github.com/equationalapplications/clanker/commit/a3dcf7e1fcfdf387675f548bf6e8e617d2a662d5))
* **purchase:** refresh state after native purchase ([d28d3b8](https://github.com/equationalapplications/clanker/commit/d28d3b835484b21c0b8f5739f993f8c3abc234dd)), closes [#268](https://github.com/equationalapplications/clanker/issues/268)
* **purchase:** skip refresh on cancel ([0b4c5f6](https://github.com/equationalapplications/clanker/commit/0b4c5f64faa1c803921d219b049a2a9bb7139691))
* remove remaining supabaseClient imports and state checks from UI ([bb391f4](https://github.com/equationalapplications/clanker/commit/bb391f4b1ec466cebe6565c18da5a068d95a716e))
* resolve PR 268 review findings ([4995d8c](https://github.com/equationalapplications/clanker/commit/4995d8c68ad2c6917a299a0a9687f4ad4c20bcfd)), closes [#268](https://github.com/equationalapplications/clanker/issues/268)
* revenueCat entitlement, docs, validation ([e6a1ace](https://github.com/equationalapplications/clanker/commit/e6a1acedc0a1b7c7e8a7822089a1d45757a1658f))
* **revenueCat:** retry webhook when Cloud SQL user unavailable ([2307c1b](https://github.com/equationalapplications/clanker/commit/2307c1bcac101ef0b5d1f78ed6273364b129a501))
* **state:** dedupe refresh and touch updatedAt ([b7158e1](https://github.com/equationalapplications/clanker/commit/b7158e10e4630edfbf5d024c022d29abcdc2411e))
* **subscription:** keep default credits on webhook upsert ([0c591c2](https://github.com/equationalapplications/clanker/commit/0c591c209eae5d677b4c78ee42f685a6f5de7baa))
* **subscription:** preserve credits on cancelled/expired status ([457bf4b](https://github.com/equationalapplications/clanker/commit/457bf4b8411e59dca9b53b1b6b27efaefd5ec86e))
* **sync:** refresh credits and harden tests ([c719c90](https://github.com/equationalapplications/clanker/commit/c719c905109c30d2609c9e733868bf3a4d9d3d51))
* **userRepository:** reject email identity when firebase uid differs ([e6d8b6d](https://github.com/equationalapplications/clanker/commit/e6d8b6d5da09f8c248314508e4a6fb995790f3f9))
* **userService:** restore updated_at to profile and bootstrap ([b73b266](https://github.com/equationalapplications/clanker/commit/b73b2667966d246c172931b7936ce6f0a3bbc6e7))


### Features

* **appcheck:** web debug token support for localhost dev ([8c520b6](https://github.com/equationalapplications/clanker/commit/8c520b681bdee36ec7fc2259484cb2a8b0fc9ded))
* **functions:** add Cloud SQL secrets to DB-backed functions ([5aa710e](https://github.com/equationalapplications/clanker/commit/5aa710e30d255688cbac20a6d6291e927413649a))


### BREAKING CHANGES

* All direct Supabase connections and the auth
bridge have been removed. The application now exclusively relies
on Firebase Cloud Functions and Cloud SQL.

## [27.1.1](https://github.com/equationalapplications/clanker/compare/v27.1.0...v27.1.1) (2026-04-20)


### Bug Fixes

* **webhook:** case-insensitive Bearer auth and smarter form detection ([d41ed04](https://github.com/equationalapplications/clanker/commit/d41ed04023ce367aa1918d9cf935a67a6b174f13))
* **webhook:** compare buffer byte length and deduplicate body extraction ([6825790](https://github.com/equationalapplications/clanker/commit/68257909e683cf4bc9e9a4c5199a6fe7a64f2a4e))
* **webhook:** skip auth for TEST events ([0c1c822](https://github.com/equationalapplications/clanker/commit/0c1c82264abbd5fe532c0a18c0d9620e9d913c41))

# [27.1.0](https://github.com/equationalapplications/clanker/compare/v27.0.0...v27.1.0) (2026-04-17)


### Bug Fixes

* **functions:** harden generateReply credit-spend parsing ([902fa67](https://github.com/equationalapplications/clanker/commit/902fa67abbe100b240b4423a892f6ec665de59bd))
* **generateImage:** evict stale throttle buckets to prevent memory leak ([6160100](https://github.com/equationalapplications/clanker/commit/6160100c4044dd215a15a1dad3d1c22564ef2b47))
* **generateReply:** restore error handling and enhance test coverage ([a4eca1b](https://github.com/equationalapplications/clanker/commit/a4eca1be33fa2b7b161889d6bbb8aeb14f9acfc9))
* **image:** address PR 266 review feedback ([d1cf488](https://github.com/equationalapplications/clanker/commit/d1cf4883305167a35478f672bb6ea68ea016ef1f))
* **images:** persist MIME type and fix throttle memory leak ([47c0c9b](https://github.com/equationalapplications/clanker/commit/47c0c9b13c5c6dccc0fc570dc5e68c0d32ca611b))


### Features

* **image:** move image generation to secure callable ([4d4a3eb](https://github.com/equationalapplications/clanker/commit/4d4a3ebcdd425992e386463b8c13da6e4018ac46))

# [27.0.0](https://github.com/equationalapplications/clanker/compare/v26.2.2...v27.0.0) (2026-04-16)


### Bug Fixes

* **chat:** bound prompt size and align function docs ([c6a5379](https://github.com/equationalapplications/clanker/commit/c6a5379840a7deb7a7572a95bcc6ba45b09b594f))
* **config:** remove obsolete purchases ios build flag ([6cf2b2d](https://github.com/equationalapplications/clanker/commit/6cf2b2dbc186bed58f7286a079c9eebc540f494e))
* **deps:** remove duplicate package entry ([f575c8f](https://github.com/equationalapplications/clanker/commit/f575c8f25c47509b7c3521e17f56b8ca433b3dd9))
* **functions:** harden generateReply review follow-ups ([4a2ea61](https://github.com/equationalapplications/clanker/commit/4a2ea613bf50aa187ec041e9b6897fc3b55ec447))
* **functions:** resolve TypeScript errors in generateReply ([5e66a6d](https://github.com/equationalapplications/clanker/commit/5e66a6d6ad474b658a0e4df84b1fd123ba6667f8))
* **purchases:** disable monthly_50 RevenueCat wiring ([62e71ad](https://github.com/equationalapplications/clanker/commit/62e71addf71fd161cf305b124fb1d042c43d8bc1))
* **test:** add expo-modules-core for jest-expo in CI ([af847bc](https://github.com/equationalapplications/clanker/commit/af847bc499451e7c4297ce6497776b75725b1bae))
* **test:** resolve Jest setup issues with expo-sqlite and jest-expo polyfills ([d80d537](https://github.com/equationalapplications/clanker/commit/d80d537011ca7f519bc6828699ea376519ace9e6))


### Features

* **chat:** move AI reply generation to secure cloud callable ([733213e](https://github.com/equationalapplications/clanker/commit/733213e28e5e483d921eaf09c0a0cd24f3d48225))
* **deps:** update dependency versions ([106e4ae](https://github.com/equationalapplications/clanker/commit/106e4aea9dba054bb2744dfa90822d47bcf859df))


### BREAKING CHANGES

* **deps:** react-native-purchases major version update from 9 to 10

## [26.2.2](https://github.com/equationalapplications/clanker/compare/v26.2.1...v26.2.2) (2026-04-13)


### Bug Fixes

* **purchases:** skip session refresh when RevenueCat purchase cancelled ([3f8f827](https://github.com/equationalapplications/clanker/commit/3f8f827b1dd07430343b67a7de859f55f3d0e725)), closes [#257](https://github.com/equationalapplications/clanker/issues/257)

## [26.2.1](https://github.com/equationalapplications/clanker/compare/v26.2.0...v26.2.1) (2026-04-13)


### Bug Fixes

* **functions:** secure exchangeToken error handling and config validation ([b56a4e5](https://github.com/equationalapplications/clanker/commit/b56a4e50773c8d66bd95595b7545b99ab046a31d))
* **functions:** update engines.node to >=22.14 to match bridge dependency requirement ([5b6b144](https://github.com/equationalapplications/clanker/commit/5b6b1443f74d43ca4f557f40988e0211736c04c1))

# [26.2.0](https://github.com/equationalapplications/clanker/compare/v26.1.3...v26.2.0) (2026-04-12)


### Bug Fixes

* address Copilot PR review comments ([cb10542](https://github.com/equationalapplications/clanker/commit/cb10542e48f98650aabac5a1ee1c4a7ea36fbe79))
* **auth,exchange:** prevent SIGN_OUT reentrancy and remove rate-limit PII ([f057ec4](https://github.com/equationalapplications/clanker/commit/f057ec4b231fe23fa2d47405f52c64dbd537e867))
* **auth:** allow sign-out during initial signin ([fb330e9](https://github.com/equationalapplications/clanker/commit/fb330e979f88a46ba54d5f18b91698e245a70223))
* **exchangeToken:** clear rate-limit on transient failure ([6343bfd](https://github.com/equationalapplications/clanker/commit/6343bfdf5dedd699af8b0df09491e2216d4a9cb1)), closes [#251](https://github.com/equationalapplications/clanker/issues/251)
* **functions:** finalize exchange-token review updates ([f493f4f](https://github.com/equationalapplications/clanker/commit/f493f4fce4fb4e0077a4b9f5aa4210a068a3a503))
* **functions:** harden exchangeToken flow ([ae14677](https://github.com/equationalapplications/clanker/commit/ae14677bfc25061d59b41d8c5fa93edd409ea42f))
* **functions:** harden exchangeToken rate limiting ([cbe7119](https://github.com/equationalapplications/clanker/commit/cbe71196ef2ac414f9503765eecdce550f1857a7))
* **test:** restore firestore descriptor properly ([4063267](https://github.com/equationalapplications/clanker/commit/40632673039e9d394bc18f49e639cbc2d853a0a0))


### Features

* **deletion:** hard-delete accounts, add self-service deletion ([6d3083a](https://github.com/equationalapplications/clanker/commit/6d3083aedcb8f5c2cf32e42a7de810601d013c91))

## [26.1.3](https://github.com/equationalapplications/clanker/compare/v26.1.2...v26.1.3) (2026-04-11)


### Bug Fixes

* **tsconfig:** document skipLibCheck requirement for Supabase SDK ([82146a1](https://github.com/equationalapplications/clanker/commit/82146a1ad4cda6f133d10808142daebdf108a233))


### Performance Improvements

* memoize Supabase admin client as module-level singleton ([d3f02d5](https://github.com/equationalapplications/clanker/commit/d3f02d5e646897c9fa6a479ee296b8a2497259f7))

## [26.1.2](https://github.com/equationalapplications/clanker/compare/v26.1.1...v26.1.2) (2026-04-11)


### Bug Fixes

* **auth:** handle soft-deleted Supabase users and implement optimistic terms acceptance ([d3d9f1d](https://github.com/equationalapplications/clanker/commit/d3d9f1dc51950efa4f26ab228cd873376293e1f1))

## [26.1.1](https://github.com/equationalapplications/clanker/compare/v26.1.0...v26.1.1) (2026-04-11)


### Bug Fixes

* **credits:** make terms acceptance atomic and gate free-tier provisioning ([f585bd1](https://github.com/equationalapplications/clanker/commit/f585bd124f530a0d61118fec04ab739837243d4b))
* **credits:** separate terms acceptance from credit provisioning ([f11dcc8](https://github.com/equationalapplications/clanker/commit/f11dcc8860698ec9a49ca7ee1f8e2bef3cd5a622))
* **credits:** simplify exchange token provisioning and fix docs ([b0325a4](https://github.com/equationalapplications/clanker/commit/b0325a4b861f3516effac2c58700bcf4dee6f45b))
* **subscribe:** refine iOS legal copy grammar ([042a00f](https://github.com/equationalapplications/clanker/commit/042a00f1749c53a2ed473185933ec9e42dc962fe))

# [26.1.0](https://github.com/equationalapplications/clanker/compare/v26.0.3...v26.1.0) (2026-04-11)


### Bug Fixes

* **accept-terms:** resolve terms/privacy navigation on web ([d8bcb67](https://github.com/equationalapplications/clanker/commit/d8bcb67c0fa61a3e3e0a7ad9848d848dc01a4fe9))
* **consent:** scope Apple copy to iOS and inline EULA terms ([e11b35e](https://github.com/equationalapplications/clanker/commit/e11b35e43cd2501bc9968eba80fbaf54296ee1af))
* **copy:** clarify Apple's App Store terms wording in acceptance notice ([50f7e54](https://github.com/equationalapplications/clanker/commit/50f7e5472f94ff20a152654a55a75345abf90303))
* **lint:** escape apostrophe in JSX text ([3e787d2](https://github.com/equationalapplications/clanker/commit/3e787d247e2b9b400edece4936e30bbea7982462))
* **nav:** dismiss drawer context before navigating to terms/privacy from accept screen ([ffe3b59](https://github.com/equationalapplications/clanker/commit/ffe3b59c61aa752a6458af53faaa5d1f1050a2e3))
* remove unused styles and fix terms gate alignment ([1a87c92](https://github.com/equationalapplications/clanker/commit/1a87c92de14352dbdb55ea6b40b20d6a145afa28))
* **terms:** further shorten iOS legal summary copy ([01567b0](https://github.com/equationalapplications/clanker/commit/01567b0985fc3f50891c64110e13f0b830ffaf55))
* **terms:** shorten iOS Apple legal summary copy ([18844a1](https://github.com/equationalapplications/clanker/commit/18844a110c4cf3d572011d55928683892272c712))


### Features

* **nav:** add icon-back navigation to legal pages with dark mode support ([83f53b6](https://github.com/equationalapplications/clanker/commit/83f53b60a7b1947c75038223b898924d7f2f40af))
* **subscriptions:** add Apple auto-renewable subscription consent compliance ([ad0d170](https://github.com/equationalapplications/clanker/commit/ad0d1703eb6218c963cad14429d33ab353d650b5))

## [26.0.3](https://github.com/equationalapplications/clanker/compare/v26.0.2...v26.0.3) (2026-04-11)


### Bug Fixes

* **babel:** fix plugin ordering to prevent hermes bytecode corruption ([7d0b1ff](https://github.com/equationalapplications/clanker/commit/7d0b1ff6dc125d31d9e72ee37d3db6b54810cd6f))

## [26.0.2](https://github.com/equationalapplications/clanker/compare/v26.0.1...v26.0.2) (2026-04-11)


### Bug Fixes

* **hooks:** stabilize useCurrentPlan selectors and add regression tests ([b6f38a9](https://github.com/equationalapplications/clanker/commit/b6f38a91cd14f96d2b5f8ed11343f7e661de4ce5))

## [26.0.1](https://github.com/equationalapplications/clanker/compare/v26.0.0...v26.0.1) (2026-04-11)


### Bug Fixes

* **build:** resolve package build error in v26.0.0 ([3f0fa4f](https://github.com/equationalapplications/clanker/commit/3f0fa4fcd882023d934543c07b613e3b8707c973))

# [26.0.0](https://github.com/equationalapplications/clanker/compare/v25.8.3...v26.0.0) (2026-04-11)


### Bug Fixes

* address PR feedback and resolve TypeScript compatibility ([c473caa](https://github.com/equationalapplications/clanker/commit/c473caaa1288ad1def38238de18dd8e2c533f2ec))
* **deps:** update react-native-worklets to 0.7.4 to hoist expo-modules-core ([a807ea1](https://github.com/equationalapplications/clanker/commit/a807ea11b3e621c8214322a99f2bfaa1736ae7ec))
* **nav:** display 'Back' label instead of '(drawer)' on Support screen ([8175135](https://github.com/equationalapplications/clanker/commit/8175135871c22c220ae6f0a41fff07fc52bff53a))
* **subscribe:** restore monthly button spacing ([32247c7](https://github.com/equationalapplications/clanker/commit/32247c7e32ea617b07ca0588d65b57fcc3f96402))


### Features

* **splash:** add dark mode background support ([a7e21a7](https://github.com/equationalapplications/clanker/commit/a7e21a726dbfbb92da784610f21a1efe16319836))


### BREAKING CHANGES

* **splash:** Expo package updates require a native app build

## [25.8.3](https://github.com/equationalapplications/clanker/compare/v25.8.2...v25.8.3) (2026-04-10)


### Bug Fixes

* **database:** require both migration indicators before short-circuiting schema init ([3785d74](https://github.com/equationalapplications/clanker/commit/3785d742269098cf8dc7dd7378ca92bdacba586b))
* **subscribe:** adjust button spacing for consistent gaps ([34dd5c7](https://github.com/equationalapplications/clanker/commit/34dd5c7c29e5f54dac41bdd2dc5c1e2b6532af08))
* **terms:** improve checkbox visibility in dark mode and update contact email ([bd0a307](https://github.com/equationalapplications/clanker/commit/bd0a307c89e27a8ce6d092bad4ff31d6e0114cf8))

## [25.8.2](https://github.com/equationalapplications/clanker/compare/v25.8.1...v25.8.2) (2026-04-10)


### Bug Fixes

* **database:** prevent concurrent initialization race on iOS and harden migrations ([84bd21d](https://github.com/equationalapplications/clanker/commit/84bd21ddf683b8653bda625fcf2aaa0896d66fe2))
* **database:** remove manual transaction wrapper from init ([3c1a394](https://github.com/equationalapplications/clanker/commit/3c1a394dae9990fe44631c995c01d61d42917542))
* **navigation:** prevent route names leaking into headers and hide back button on chat ([81116ea](https://github.com/equationalapplications/clanker/commit/81116ea73e370bdaf4cf839b122431f62441f26e))
* **revenuecat:** add direct product fallback for consumables ([2a456b1](https://github.com/equationalapplications/clanker/commit/2a456b1d27b5f543f16fe1e497b51cd6d9230e7c))

## [25.8.1](https://github.com/equationalapplications/clanker/compare/v25.8.0...v25.8.1) (2026-04-10)


### Bug Fixes

* **functions:** avoid global auth and stdio test stubs ([852a5e1](https://github.com/equationalapplications/clanker/commit/852a5e1e4b4e0df7f7487d8b65752984eaf2edf7))
* **payments:** derive Stripe mode from price type and add purchase tests ([29f0d9f](https://github.com/equationalapplications/clanker/commit/29f0d9f378c588f7697da556e929464a59c0989c))
* **profile:** prevent native crashes from concurrent session reads ([e0158af](https://github.com/equationalapplications/clanker/commit/e0158afd8158b576430cf99bd3c31d81b663bf36))
* **subscribe:** remove duplicate header and add legal links ([330e597](https://github.com/equationalapplications/clanker/commit/330e597b168a7144b077e8ade85a1ff5d20a2bbe))

# [25.8.0](https://github.com/equationalapplications/clanker/compare/v25.7.0...v25.8.0) (2026-04-09)


### Bug Fixes

* **auth:** guard Apple name string fallback ([4519cb5](https://github.com/equationalapplications/clanker/commit/4519cb5d6cba63328a6da692e4272836604e70a4))
* **auth:** hide Apple sign-in on Android ([3948e56](https://github.com/equationalapplications/clanker/commit/3948e56e44d3b7ae867229bf62db8bbf13976c89))
* **auth:** hide Apple sign-in on Android ([42a754e](https://github.com/equationalapplications/clanker/commit/42a754ebad3fba6ba2ba41b80851811d47970596))
* **ci:** allow hotfix branches for production release validation ([386c419](https://github.com/equationalapplications/clanker/commit/386c419d84bed9f4ab43ca5a977484bf9a182ab4))


### Features

* **auth:** capture provider names and make Apple sign-in cross-platform ([c237c4b](https://github.com/equationalapplications/clanker/commit/c237c4b6e509a63033061672a060997c14708781))
* **auth:** capture provider names and make Apple sign-in cross-platform ([a0f7453](https://github.com/equationalapplications/clanker/commit/a0f7453ca2690f0bc01e3c3ce407d9f815824f5f))
* **support:** add public support page for App Store compliance ([47c9c26](https://github.com/equationalapplications/clanker/commit/47c9c2623edfd017ca0341570a6ccf878344e8b3))

# [25.7.0](https://github.com/equationalapplications/clanker/compare/v25.6.1...v25.7.0) (2026-04-09)


### Features

* **support:** add public support page for App Store compliance ([fb57ef1](https://github.com/equationalapplications/clanker/commit/fb57ef1e4414b9d37cb5b561dbb5a901e2b6e441))

## [25.6.1](https://github.com/equationalapplications/clanker/compare/v25.6.0...v25.6.1) (2026-04-09)


### Bug Fixes

* **avatar:** make default avatar loading best-effort in character creation ([7506251](https://github.com/equationalapplications/clanker/commit/7506251dfdf4bfb77db9756e0b28e63be7a75b2d))

# [25.6.0](https://github.com/equationalapplications/clanker/compare/v25.5.1...v25.6.0) (2026-04-09)


### Bug Fixes

* **avatar:** correct service docs and test mock contract ([830420c](https://github.com/equationalapplications/clanker/commit/830420c46af249d14886b0654afc8c06cffc3808))
* **avatar:** lazy load and assign directly without fallback ([cc491b0](https://github.com/equationalapplications/clanker/commit/cc491b0fa081f86dfd9e225d6fd81639fcd67175))
* **characters:** embed default avatar as base64 to remove expo dependencies ([bf9d2f6](https://github.com/equationalapplications/clanker/commit/bf9d2f664d815f2cb754ddf53de46407e6b138e8))
* **characters:** normalize default avatar data and trim whitespace ([7bd2f59](https://github.com/equationalapplications/clanker/commit/7bd2f59ad1146a274689b2235e6cdabb4bdb20e2))
* **characters:** resolve avatar loader review feedback and test isolation ([0db82a1](https://github.com/equationalapplications/clanker/commit/0db82a17536f85548b05b8b67f4a66e79624191d))
* **navigation:** prevent route-group name from leaking to drawer header ([45557f9](https://github.com/equationalapplications/clanker/commit/45557f9a4f1cdc9db0cc50bbd26b19d8fae9c582))
* **navigation:** prevent route-group name from leaking to drawer header ([124fd92](https://github.com/equationalapplications/clanker/commit/124fd92855f7da483e7b7dbd366c0766f8d16bb2))
* rename *.instructions.md to semantic-release.instructions.md ([5deb7ad](https://github.com/equationalapplications/clanker/commit/5deb7ada96b6f0fc519ee46b38785d17dbad79a4))
* **sign-in:** improve spacing between auth buttons and legal links ([d39f4a0](https://github.com/equationalapplications/clanker/commit/d39f4a0d8b6ba7337e57c4ea3790f50649d7f7ad))
* **sign-in:** improve spacing between auth buttons and legal links ([12b536a](https://github.com/equationalapplications/clanker/commit/12b536a1a2d2b981ee4c952b451806245888ce2a))


### Features

* **characters:** add default avatar to newly created characters ([e2183c2](https://github.com/equationalapplications/clanker/commit/e2183c27f3e44cfa95701f3b134eff6b93e976b6))

## [25.5.1](https://github.com/equationalapplications/clanker/compare/v25.5.0...v25.5.1) (2026-04-09)


### Bug Fixes

* **functions:** share Stripe secret key validation ([e9d9c16](https://github.com/equationalapplications/clanker/commit/e9d9c168d86849446f0eeaeac6618b1786acdf8a))
* **terms:** clear stale error on acceptance check success ([c8703f1](https://github.com/equationalapplications/clanker/commit/c8703f16a790f447c28ab262293378a368f28b1d))
* **terms:** harden gating and add machine tests ([404473e](https://github.com/equationalapplications/clanker/commit/404473e9699981096557746a2b3151e6fb11dc2f))
* **terms:** prevent redirect loop and add acceptance gate regressions ([7e7f7e8](https://github.com/equationalapplications/clanker/commit/7e7f7e82d9f77c79f7a4841b90782d52f04b492a))

# [25.5.0](https://github.com/equationalapplications/clanker/compare/v25.4.0...v25.5.0) (2026-04-09)


### Bug Fixes

* **admin:** add explicit non-web platform gate for dashboard ([d5bccbc](https://github.com/equationalapplications/clanker/commit/d5bccbc46baff2fa88b9ac1ebdf2e5a11c1906c6))
* **admin:** address review comments on error handling, test mocks, and docs ([36913fa](https://github.com/equationalapplications/clanker/commit/36913fa14906be3921ff327538f44178c59ed9b3))
* **admin:** remove admin dashboard feature flag ([f0cd3ce](https://github.com/equationalapplications/clanker/commit/f0cd3ce73b88c54cdd1c47a02506ce426819b2ea))
* **admin:** remove feature flag gate - dashboard is always enabled ([8d8d68d](https://github.com/equationalapplications/clanker/commit/8d8d68dfae5906e65c13ff39fdfd1849bdb27b97))
* **admin:** restore dashboard feature flag and reduce duplicate delete errors ([a3f8041](https://github.com/equationalapplications/clanker/commit/a3f80414e47560b6802b98774e526030611d0da4))
* **admin:** restore delete error severity and selected-row contrast ([ab4be5b](https://github.com/equationalapplications/clanker/commit/ab4be5bd0cf7747b52d09c004da920bad4190af7))
* **admin:** tighten Supabase missing-table error detection ([d37194c](https://github.com/equationalapplications/clanker/commit/d37194cf4aae40edd030f53cc1d237856cfb2e87))
* **admin:** validate tableName matches query path in deleteFromCanonicalTable ([b25c37e](https://github.com/equationalapplications/clanker/commit/b25c37ea04f29cc1f9315e11ef14338607a4a602))
* **functions:** warn on non-string admin user filters ([f53284c](https://github.com/equationalapplications/clanker/commit/f53284cb2e81b522cc6c5f6f9ac9dc4f391b677b))
* reduce sensitive data exposure in canonical table delete logs ([7b4b6fe](https://github.com/equationalapplications/clanker/commit/7b4b6fea1d3c8a27a03179a5f86a0c630f741f65))
* update admin function tests to use correct table names (yours_brightly_*) ([7cd8263](https://github.com/equationalapplications/clanker/commit/7cd8263e739f4b2e93c2b29187850e19c8f9177a))


### Features

* **admin:** dark mode, contrast improvements, delete fix, update docs ([e4d9c73](https://github.com/equationalapplications/clanker/commit/e4d9c73e9eeea586f887b183dc6223be82905e54))

# [25.4.0](https://github.com/equationalapplications/clanker/compare/v25.3.1...v25.4.0) (2026-04-08)


### Bug Fixes

* **admin-dashboard:** clarify invalid filter behavior and validate renewal date format ([1a664cc](https://github.com/equationalapplications/clanker/commit/1a664cc82f80fd1d5e332399d592fc0abdc3b5f5))
* **admin-dashboard:** correct renewalDate semantics and hook type contract ([6c56f25](https://github.com/equationalapplications/clanker/commit/6c56f257092ce2d0a3f7ee06270cb46920f2980d))
* **admin:** address Copilot code review issues ([7d28c69](https://github.com/equationalapplications/clanker/commit/7d28c69bc484c0468dcf33afe7547d6465bdaf67))
* **admin:** address Copilot PR review feedback ([dff3543](https://github.com/equationalapplications/clanker/commit/dff354328e9e1b8b9a21b606deb8a71337986801))
* **admin:** address data integrity and UX issues in admin dashboard ([79ba1f9](https://github.com/equationalapplications/clanker/commit/79ba1f985eb2734f2f799bbb0bab47b07b251dc9))
* **admin:** align subscription statuses with canonical backend values ([5f69e68](https://github.com/equationalapplications/clanker/commit/5f69e68b442706feec28b0c636f6a055eebaf6e8))
* **admin:** distinguish renewal-date omit vs clear, validate clear-terms precondition ([3197731](https://github.com/equationalapplications/clanker/commit/3197731a8d2013dda4b86d183f2cd55e13e85bb8))
* **admin:** harden input validation, query safety, and type coverage ([3c4105b](https://github.com/equationalapplications/clanker/commit/3c4105b3f8cb3bfc357c7c8bc0752e0744e0a79d))
* **admin:** only include renewalDate in payload when admin provides input ([f0a1647](https://github.com/equationalapplications/clanker/commit/f0a1647457cbc48ec9ff3daf3bf7947420232e48))
* **admin:** strict ISO date validation, remove redundant access query, normalize plan tier filter ([5a7ed5b](https://github.com/equationalapplications/clanker/commit/5a7ed5bf4d54e87354b2805ec7925a17589e172f))
* **admin:** sync confirmation modal, validate credits bounds, resilient deletion, cache allowlists ([b88be82](https://github.com/equationalapplications/clanker/commit/b88be827d931f3367c5b1b64dd893d002437d91b))
* **admin:** tighten confirmation validation and add admin claim management ([adcef8d](https://github.com/equationalapplications/clanker/commit/adcef8dd7091ee7ef205f4aa2d9512330351558d))
* **app-check:** resolve promise instead of rejecting when recaptcha site key missing ([ac67b17](https://github.com/equationalapplications/clanker/commit/ac67b176c84c2d60e0e4dcac831c134b3464720b))
* **functions:** use dynamic import in adminFunctions test to ensure env vars set first ([73c6be3](https://github.com/equationalapplications/clanker/commit/73c6be39154c14509b3bdc9dd9c4a6371a428c37))


### Features

* **admin:** add server-side search, debounce, and pagination UX ([13a959e](https://github.com/equationalapplications/clanker/commit/13a959e9a74d4b4a99bb58a86482bac8dfd01798))
* **admin:** implement admin dashboard with pagination and server-side search ([25806e3](https://github.com/equationalapplications/clanker/commit/25806e3ca03b399c403f1f2dcc7d44ddea797286))
* **admin:** implement web-only admin dashboard with user management callables ([d1023e8](https://github.com/equationalapplications/clanker/commit/d1023e83cfac29167a778c6b314c13bb2acd09e4))

## [25.3.1](https://github.com/equationalapplications/clanker/compare/v25.3.0...v25.3.1) (2026-04-08)


### Bug Fixes

* **functions:** remove Stripe price lookup on checkout path ([2fb5ca5](https://github.com/equationalapplications/clanker/commit/2fb5ca5fae3604eaaa4a9b8fb5579f0b34701ca3))
* **stripe-webhook:** normalize and validate STRIPE_SECRET_KEY before client creation ([6530163](https://github.com/equationalapplications/clanker/commit/65301630b47f71c7897cd932e7bd9bd37b4fc787))
* **stripe:** fail fast on missing checkout URLs and invalid secret keys ([12f3c58](https://github.com/equationalapplications/clanker/commit/12f3c585f93d235ee54aff5276d007f8d53fa919))

# [25.3.0](https://github.com/equationalapplications/clanker/compare/v25.2.1...v25.3.0) (2026-04-08)


### Bug Fixes

* address PR review feedback on validation and error handling ([fd75e03](https://github.com/equationalapplications/clanker/commit/fd75e030cd8a0e832283966ffd6496a3bf492ef1))
* apply copilot PR review security and correctness fixes ([7dc2e9b](https://github.com/equationalapplications/clanker/commit/7dc2e9b99058ad350142ae15350eb649d32dba83))
* **auth:** unify Apple sign-in button styling across iOS and web ([7fa37bc](https://github.com/equationalapplications/clanker/commit/7fa37bca1ff146a04ae91633c26a05b459b876f9))
* **build:** improve expo temp path errors and trim unused eas installs ([6a6eea3](https://github.com/equationalapplications/clanker/commit/6a6eea3fe0fbba5540f6421c17ab989d122f53f8))
* **functions:** add explicit invoker: "public" to webhooks and callables ([5349be1](https://github.com/equationalapplications/clanker/commit/5349be17f4d9c558275093e64b9034375731d9cf))
* **functions:** address PR review feedback ([e0a021e](https://github.com/equationalapplications/clanker/commit/e0a021eb51b98590f39d45d7551d7bd75dd6b8ff))
* **functions:** avoid double-logging Supabase errors in findSupabaseUserByEmail ([39731b1](https://github.com/equationalapplications/clanker/commit/39731b1ccef2b38ba86586432475db773d87f3a3))
* **functions:** bind secrets to cloud run functions for secure access ([7ce7d12](https://github.com/equationalapplications/clanker/commit/7ce7d12abced3b6afd19ffed5435e998105efd2c))
* **functions:** configure typescript for gen 2 cloud run with node 22 esm ([9baa28b](https://github.com/equationalapplications/clanker/commit/9baa28bfd39e1ec90f8e49686c01293f99c3239a))
* **functions:** declare missing secrets and enable webhook retries ([520bc60](https://github.com/equationalapplications/clanker/commit/520bc60bbb743df64ae1141a97d901f1302a31f3))
* **functions:** distinguish user-not-found from transient errors in RevenueCat webhook ([0ddc236](https://github.com/equationalapplications/clanker/commit/0ddc236e9a4aaeda7b405e79ef10b27da2773090))
* **functions:** harden auth checks, Stripe client init, and ESM lint rules ([1a944c9](https://github.com/equationalapplications/clanker/commit/1a944c9edf0aa9236749ad86c1a8d1cd6d36a0ba))
* **functions:** harden webhook handling and cleanup ([dc48e4c](https://github.com/equationalapplications/clanker/commit/dc48e4c9ae513a8438af1aa2e7a885af26178040))
* **functions:** implement fail-fast Stripe price ID validation ([0d23efa](https://github.com/equationalapplications/clanker/commit/0d23efa7e253eabfec37304c4a7e944325e8d2dd))
* **functions:** improve webhook error handling and security ([758481a](https://github.com/equationalapplications/clanker/commit/758481acab7028ee8f6feb65aa87f9c29c0ca03a))
* **functions:** secure webhook parsing and add focused unit tests ([1da13c0](https://github.com/equationalapplications/clanker/commit/1da13c00656db6182d43199d8f8dc98a22455c59))
* **functions:** support iOS and Android credit-pack product IDs in RevenueCat webhook ([9894327](https://github.com/equationalapplications/clanker/commit/9894327ab79696e53e64c3841ba537e3b18f1c3f))
* **functions:** type stripe webhook rawBody request ([c02afe3](https://github.com/equationalapplications/clanker/commit/c02afe3bcef79e3c69062e2bf9ecd1a6d914d462))
* **functions:** use constant-time comparison for RevenueCat auth header ([6e7f8a9](https://github.com/equationalapplications/clanker/commit/6e7f8a935590fc306f3cfe63f5243f0577e9fef7))
* **functions:** use unquoted glob in test script for proper discovery ([0a9ed1d](https://github.com/equationalapplications/clanker/commit/0a9ed1d78c78d5d54cd5519ebbb94cfe289aefd5))
* **functions:** validate post-floor amounts, safely extract Stripe IDs, prevent error leakage ([39f2b19](https://github.com/equationalapplications/clanker/commit/39f2b19c0e8da508729b049529c0f4a9c82a63f6))
* **functions:** validate spend amount and stripe signature header ([fadad40](https://github.com/equationalapplications/clanker/commit/fadad40e61fff68c92d320b22b6037f69f5303e6))
* normalize code style and imports in functions ([2e63dee](https://github.com/equationalapplications/clanker/commit/2e63dee5164659c465163717a837eaa559e422d1))
* **stripe-webhook:** use typed invoice helpers and improve error semantics ([e5d1ee0](https://github.com/equationalapplications/clanker/commit/e5d1ee0c516b4dc7d1e7c01c86c3f3dc042f42eb))


### Features

* **firebase-functions:** move non-sensitive config to params/env instead of secrets ([5137007](https://github.com/equationalapplications/clanker/commit/5137007e58eb89fbe0d2c242ce19c7280ace8498))
* **functions:** add shared supabase admin helpers ([516488a](https://github.com/equationalapplications/clanker/commit/516488a709b70a8a9d49f80c5c0e712a1eb19b35))

## [25.2.1](https://github.com/equationalapplications/clanker/compare/v25.2.0...v25.2.1) (2026-04-05)


### Bug Fixes

* **build:** address Copilot PR review security feedback ([b2a0b6d](https://github.com/equationalapplications/clanker/commit/b2a0b6d49cde81884a3eee485e662abc4122aac5))
* **build:** extract firebase config files dynamically to temp dir ([9e6a181](https://github.com/equationalapplications/clanker/commit/9e6a18156fe9e19625ee00dccbaefbbb1e00b480))
* **config:** address second round of Copilot PR review feedback ([2ec0392](https://github.com/equationalapplications/clanker/commit/2ec0392b4d47526881ca7c11713927aa3ae67fda))
* **config:** harden base64 credential file writes ([29859ba](https://github.com/equationalapplications/clanker/commit/29859baa4f5d16d294d7143a1de577ea0f8dc7cf))

# [25.2.0](https://github.com/equationalapplications/clanker/compare/v25.1.0...v25.2.0) (2026-04-05)


### Bug Fixes

* **ci:** improve OTA update delivery and workflow clarity ([#200](https://github.com/equationalapplications/clanker/issues/200)) ([59720d4](https://github.com/equationalapplications/clanker/commit/59720d43b4bdb57398bd16b9863435ad72268283)), closes [#199](https://github.com/equationalapplications/clanker/issues/199)
* **ci:** rename job to check-merge-source for branch protection ([bd3ffaa](https://github.com/equationalapplications/clanker/commit/bd3ffaa89a1dad60a9cd489982b12672b402117a))
* **credits:** address Copilot PR review on credits sync and docs ([e481ae9](https://github.com/equationalapplications/clanker/commit/e481ae9f00446c443fe20ef4c223f45dcd991018))
* **ota:** read branch arg from argv[2] and unblock web sync button ([935b90a](https://github.com/equationalapplications/clanker/commit/935b90adef2e3e5708cb4073dada3d756c059f9d))


### Features

* character state machine, database improvements, and UI enhancements ([dcda057](https://github.com/equationalapplications/clanker/commit/dcda057ceb74c469cfa32796dfcb3aafc0f8b99d))
* character state machine, database improvements, and UI enhancements ([#201](https://github.com/equationalapplications/clanker/issues/201)) ([b72e186](https://github.com/equationalapplications/clanker/commit/b72e186804f3f9227f60b3e9d16534f1f115ea45)), closes [#200](https://github.com/equationalapplications/clanker/issues/200) [#199](https://github.com/equationalapplications/clanker/issues/199)

# [25.1.0](https://github.com/equationalapplications/clanker/compare/v25.0.0...v25.1.0) (2026-04-05)


### Features

* character state machine, database improvements, and UI enhancements ([#199](https://github.com/equationalapplications/clanker/issues/199)) ([d80e149](https://github.com/equationalapplications/clanker/commit/d80e1495fd9b285d6706b091c01584560b31cc7e))

# [25.0.0](https://github.com/equationalapplications/clanker/compare/v24.0.0...v25.0.0) (2026-04-04)


### Release

* Staging to Main ([#197](https://github.com/equationalapplications/clanker/issues/197)) ([b060832](https://github.com/equationalapplications/clanker/commit/b060832e237d5cb8783c826146a5dc1b4283af99)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB) [#194](https://github.com/equationalapplications/clanker/issues/194) [#193](https://github.com/equationalapplications/clanker/issues/193) [#193](https://github.com/equationalapplications/clanker/issues/193) [#193](https://github.com/equationalapplications/clanker/issues/193) [#195](https://github.com/equationalapplications/clanker/issues/195) [#196](https://github.com/equationalapplications/clanker/issues/196) [#192](https://github.com/equationalapplications/clanker/issues/192)


### BREAKING CHANGES

* native module change (@react-native-firebase/ai replaces
@react-native-firebase/vertexai), requires new native build

* chore: stop tracking plan.md, add to gitignore

* fix: address Copilot review comments on avatar generation and character management

- Remove unused imports (useCallback in useEditDirtyState, useSegments in _layout)
- Remove unused userId parameter from useLocalImageGeneration hook
- Add React Query cache invalidation after local image generation to keep lists/details in sync
- Guard against retry loops in useEnsureDefaultCharacter by tracking failed-creation per user
- Update stale schema migration comment to reference avatar_data instead of deleted_at
- Conditionally render 'Creating...' spinner in characters list based on isCreatingDefault state

* fix(deps): update expo to 55.0.10

* fix(hooks): use useIsMutating for reactive default character creation

- Replace module-level creationInFlight with useIsMutating for reactive UI
- Clear creationFailedForUser on success and user change
- Extract createCharacterMutationKey as shared constant
- Keep module-level flags as mutex, not UI state

Fixes stale UI across tabs and permanent failure locks.

* fix(drawer): add custom hamburger menu button with proper navigation context

- Replace default DrawerToggleButton with custom Pressable using menu icon
- Use screenOptions function form to get Drawer navigator context
- Add proper drawer toggle dispatch and accessibility labels

* fix: resolve character creation and drawer navigation issues

- Make createCharacterMutationKey user-scoped to prevent mutation state from
  leaking across account switches
- Use useIsMutating for creation guard to prevent duplicate auto-creation
  when manual create is in progress
- Reset creationInFlight flag on user change alongside creationFailedForUser
- Fix Pressable touch target (44x44 with padding/hitSlop) and accessibility
  label for drawer toggle

* fix(ios): resolve build failures with static frameworks and latest image

- Move expo-build-properties plugin to top of plugins array
- Replace forceStaticLinking with buildReactNativeFromSource for iOS
- Pin staging and production builds to latest EAS iOS image

* feat(functions): copy firebase functions from account repo

* chore: isolate functions from expo build and type checking

* chore: add firebase functions documentation and update configuration
* native module change (@react-native-firebase/ai replaces
@react-native-firebase/vertexai), requires new native build

* chore: stop tracking plan.md, add to gitignore

* fix: address Copilot review comments on avatar generation and character management

- Remove unused imports (useCallback in useEditDirtyState, useSegments in _layout)
- Remove unused userId parameter from useLocalImageGeneration hook
- Add React Query cache invalidation after local image generation to keep lists/details in sync
- Guard against retry loops in useEnsureDefaultCharacter by tracking failed-creation per user
- Update stale schema migration comment to reference avatar_data instead of deleted_at
- Conditionally render 'Creating...' spinner in characters list based on isCreatingDefault state

* fix(deps): update expo to 55.0.10

* fix(hooks): use useIsMutating for reactive default character creation

- Replace module-level creationInFlight with useIsMutating for reactive UI
- Clear creationFailedForUser on success and user change
- Extract createCharacterMutationKey as shared constant
- Keep module-level flags as mutex, not UI state

Fixes stale UI across tabs and permanent failure locks.

* fix(drawer): add custom hamburger menu button with proper navigation context

- Replace default DrawerToggleButton with custom Pressable using menu icon
- Use screenOptions function form to get Drawer navigator context
- Add proper drawer toggle dispatch and accessibility labels

* fix: resolve character creation and drawer navigation issues

- Make createCharacterMutationKey user-scoped to prevent mutation state from
  leaking across account switches
- Use useIsMutating for creation guard to prevent duplicate auto-creation
  when manual create is in progress
- Reset creationInFlight flag on user change alongside creationFailedForUser
- Fix Pressable touch target (44x44 with padding/hitSlop) and accessibility
  label for drawer toggle

* fix(ios): resolve build failures with static frameworks and latest image

- Move expo-build-properties plugin to top of plugins array
- Replace forceStaticLinking with buildReactNativeFromSource for iOS
- Pin staging and production builds to latest EAS iOS image

* feat(functions): copy firebase functions from account repo

* chore: isolate functions from expo build and type checking

* chore: add firebase functions documentation and update configuration

# [24.0.0](https://github.com/equationalapplications/clanker/compare/v23.0.0...v24.0.0) (2026-04-03)


### chore

* **release:** promote staging to production ([#192](https://github.com/equationalapplications/clanker/issues/192)) ([e5d53fb](https://github.com/equationalapplications/clanker/commit/e5d53fb366547db50b94f198aebed90db7510bda)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB) [#194](https://github.com/equationalapplications/clanker/issues/194)


### BREAKING CHANGES

* **release:** native module change (@react-native-firebase/ai replaces
@react-native-firebase/vertexai), requires new native build

* chore: stop tracking plan.md, add to gitignore

* fix: address Copilot review comments on avatar generation and character management

- Remove unused imports (useCallback in useEditDirtyState, useSegments in _layout)
- Remove unused userId parameter from useLocalImageGeneration hook
- Reload character lists/details via the character XState machine after local image generation to keep UI in sync
- Guard against retry loops in useEnsureDefaultCharacter by tracking failed-creation per user
- Update stale schema migration comment to reference avatar_data instead of deleted_at
- Conditionally render 'Creating...' spinner in characters list based on isCreatingDefault state

* fix(deps): update expo to 55.0.10

* fix(hooks): use useIsMutating for reactive default character creation

- Replace module-level creationInFlight with useIsMutating for reactive UI
- Clear creationFailedForUser on success and user change
- Extract createCharacterMutationKey as shared constant
- Keep module-level flags as mutex, not UI state

Fixes stale UI across tabs and permanent failure locks.

* fix(drawer): add custom hamburger menu button with proper navigation context

- Replace default DrawerToggleButton with custom Pressable using menu icon
- Use screenOptions function form to get Drawer navigator context
- Add proper drawer toggle dispatch and accessibility labels

* fix: resolve character creation and drawer navigation issues

- Make createCharacterMutationKey user-scoped to prevent mutation state from
  leaking across account switches
- Use useIsMutating for creation guard to prevent duplicate auto-creation
  when manual create is in progress
- Reset creationInFlight flag on user change alongside creationFailedForUser
- Fix Pressable touch target (44x44 with padding/hitSlop) and accessibility
  label for drawer toggle

* fix(ios): resolve build failures with static frameworks and latest image

- Move expo-build-properties plugin to top of plugins array
- Replace forceStaticLinking with buildReactNativeFromSource for iOS
- Pin staging and production builds to latest EAS iOS image

* feat(functions): copy firebase functions from account repo

* chore: isolate functions from expo build and type checking

* chore: add firebase functions documentation and update configuration

# [23.0.0](https://github.com/equationalapplications/clanker/compare/v22.0.0...v23.0.0) (2026-04-02)


### Bug Fixes

* drawer hamburger button, reactive default character creation, remove realtime credits subscription ([#191](https://github.com/equationalapplications/clanker/issues/191)) ([31d7e98](https://github.com/equationalapplications/clanker/commit/31d7e98ae5ce54410aba92a02b811f32a7dbbdf4)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB)


### BREAKING CHANGES

* native module change (@react-native-firebase/ai replaces
@react-native-firebase/vertexai), requires new native build

* chore: stop tracking plan.md, add to gitignore

* fix: address Copilot review comments on avatar generation and character management

- Remove unused imports (useCallback in useEditDirtyState, useSegments in _layout)
- Remove unused userId parameter from useLocalImageGeneration hook
- Reload character lists/details via the character XState machine after local image generation to keep UI in sync
- Guard against retry loops in useEnsureDefaultCharacter by tracking failed-creation per user
- Update stale schema migration comment to reference avatar_data instead of deleted_at
- Conditionally render 'Creating...' spinner in characters list based on isCreatingDefault state

* fix(deps): update expo to 55.0.10

* fix(hooks): use useIsMutating for reactive default character creation

- Replace module-level creationInFlight with useIsMutating for reactive UI
- Clear creationFailedForUser on success and user change
- Extract createCharacterMutationKey as shared constant
- Keep module-level flags as mutex, not UI state

Fixes stale UI across tabs and permanent failure locks.

* fix(drawer): add custom hamburger menu button with proper navigation context

- Replace default DrawerToggleButton with custom Pressable using menu icon
- Use screenOptions function form to get Drawer navigator context
- Add proper drawer toggle dispatch and accessibility labels

* fix: resolve character creation and drawer navigation issues

- Make createCharacterMutationKey user-scoped to prevent mutation state from
  leaking across account switches
- Use useIsMutating for creation guard to prevent duplicate auto-creation
  when manual create is in progress
- Reset creationInFlight flag on user change alongside creationFailedForUser
- Fix Pressable touch target (44x44 with padding/hitSlop) and accessibility
  label for drawer toggle

* fix(ios): resolve build failures with static frameworks and latest image

- Move expo-build-properties plugin to top of plugins array
- Replace forceStaticLinking with buildReactNativeFromSource for iOS
- Pin staging and production builds to latest EAS iOS image

* feat(functions): copy firebase functions from account repo

* chore: isolate functions from expo build and type checking

* chore: add firebase functions documentation and update configuration

# [22.0.0](https://github.com/equationalapplications/clanker/compare/v21.0.0...v22.0.0) (2026-04-02)


### Bug Fixes

* **deps:** update expo to 55.0.10 ([#190](https://github.com/equationalapplications/clanker/issues/190)) ([cda5e3f](https://github.com/equationalapplications/clanker/commit/cda5e3fd2c478f3d18ed15fb9f5644706adf8937)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB)


### BREAKING CHANGES

* **deps:** native module change (@react-native-firebase/ai replaces
@react-native-firebase/vertexai), requires new native build

* chore: stop tracking plan.md, add to gitignore

* fix: address Copilot review comments on avatar generation and character management

- Remove unused imports (useCallback in useEditDirtyState, useSegments in _layout)
- Remove unused userId parameter from useLocalImageGeneration hook
- Reload character lists/details via the character XState machine after local image generation to keep UI in sync
- Guard against retry loops in useEnsureDefaultCharacter by tracking failed-creation per user
- Update stale schema migration comment to reference avatar_data instead of deleted_at
- Conditionally render 'Creating...' spinner in characters list based on isCreatingDefault state

* fix(deps): update expo to 55.0.10

# [21.0.0](https://github.com/equationalapplications/clanker/compare/v20.0.4...v21.0.0) (2026-04-02)


* feat(characters)!: replace expo-file-system with SQLite image storage, fix tab nav, unify default character creation ([#189](https://github.com/equationalapplications/clanker/issues/189)) ([b0d7e43](https://github.com/equationalapplications/clanker/commit/b0d7e43ca2f52fa385f8dc3d75dc3075565308c6)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB)


### BREAKING CHANGES

* native module change (@react-native-firebase/ai replaces
@react-native-firebase/vertexai), requires new native build

## [20.0.4](https://github.com/equationalapplications/clanker/compare/v20.0.3...v20.0.4) (2026-04-02)


### Bug Fixes

* **vertexai:** update to gemini-2.5 models and migrate to Nano Banana image generation ([#188](https://github.com/equationalapplications/clanker/issues/188)) ([c69b367](https://github.com/equationalapplications/clanker/commit/c69b36782855f26aab2088ae568642a0392abd05)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB)

## [20.0.3](https://github.com/equationalapplications/clanker/compare/v20.0.2...v20.0.3) (2026-04-02)


### Bug Fixes

* update login button style ([#187](https://github.com/equationalapplications/clanker/issues/187)) ([00513f7](https://github.com/equationalapplications/clanker/commit/00513f714b2d85c72d692754f9f1a700d34ccff4)), closes [hi#priority](https://github.com/hi/issues/priority) [#666](https://github.com/equationalapplications/clanker/issues/666) [#ffebee](https://github.com/equationalapplications/clanker/issues/ffebee) [#ef5350](https://github.com/equationalapplications/clanker/issues/ef5350) [#c62828](https://github.com/equationalapplications/clanker/issues/c62828) [#d32f2f](https://github.com/equationalapplications/clanker/issues/d32f2f) [#e8f5e8](https://github.com/equationalapplications/clanker/issues/e8f5e8) [#2196F3](https://github.com/equationalapplications/clanker/issues/2196F3) [#eee](https://github.com/equationalapplications/clanker/issues/eee) [374151/#F9FAFB](https://github.com/equationalapplications/clanker/issues/F9FAFB)

## [20.0.2](https://github.com/equationalapplications/clanker/compare/v20.0.1...v20.0.2) (2026-04-02)


### Bug Fixes

* **auth:** ensure Google and Apple signin buttons have same height ([5b74c61](https://github.com/equationalapplications/clanker/commit/5b74c611bf0edd0d9b637bf1a2cdea7c58e4af3c))

## [20.0.1](https://github.com/equationalapplications/clanker/compare/v20.0.0...v20.0.1) (2026-04-02)


### Bug Fixes

* **auth:** round apple signin button corners to match google button ([f50e2c5](https://github.com/equationalapplications/clanker/commit/f50e2c5d1ffe8f28a1476574c955753e5db8eceb))
* **chat:** resolve keyboard covering input on android and ios ([547cd35](https://github.com/equationalapplications/clanker/commit/547cd353364abac1dfc4271476218f176edce286))
* **ui:** make checkbox visible on accept terms page ([25a2862](https://github.com/equationalapplications/clanker/commit/25a28620b1c0b344d3332c5a638790bd27aec053))

# [20.0.0](https://github.com/equationalapplications/clanker/compare/v19.0.0...v20.0.0) (2026-04-02)


* feat(auth)!: add Apple Sign-In for iOS and web ([3d98eec](https://github.com/equationalapplications/clanker/commit/3d98eeca3f2a5e0b072c2aabc6f13771dc601d19))
* feat(auth)!: add Apple Sign-In for iOS and web ([#183](https://github.com/equationalapplications/clanker/issues/183)) ([38c06b5](https://github.com/equationalapplications/clanker/commit/38c06b583b918c44321d4bbf727626d729a4ed19))


### Bug Fixes

* **android:** resolve Supabase apikey header drop and App Check race condition ([fd01d7f](https://github.com/equationalapplications/clanker/commit/fd01d7f62704cbfe8896ac108479c84d09d2297b))
* **assets:** add adaptive icon and banner images ([5a92a22](https://github.com/equationalapplications/clanker/commit/5a92a2262e92e8782035c047c96c1a190104a43c))
* **auth:** address Apple Sign-In code review feedback ([cd771ce](https://github.com/equationalapplications/clanker/commit/cd771ce1a4b530c15a036ae07d4981843da3c1ef))
* **auth:** address Copilot review comments ([1a2378e](https://github.com/equationalapplications/clanker/commit/1a2378ea37be1bbbe2d82effffff8152e54cad5c))
* **auth:** remove sensitive JWT payload from debug log ([1de09c8](https://github.com/equationalapplications/clanker/commit/1de09c835deff2a1c868fc9be5276d3c3692c1da))
* **auth:** surface apple redirect sign-in errors to user ([37ef059](https://github.com/equationalapplications/clanker/commit/37ef0595bb5c03bbba1880c9b277b3db357f248f))
* **checkout:** escape apostrophe in cancel screen to satisfy react/no-unescaped-entities ([c3d3558](https://github.com/equationalapplications/clanker/commit/c3d35582665d49f470de034dbdf32e5823142761))
* **checkout:** handle refreshSession errors and improve apostrophe readability ([b7b6aed](https://github.com/equationalapplications/clanker/commit/b7b6aed140128854ec52dafd4c7d38acb1fa4925))
* **ci:** add --platform all to production EAS build command ([3c8c735](https://github.com/equationalapplications/clanker/commit/3c8c7351ca28a6d2c90b8331468b65e44b6909ef))
* **payments:** fix JWT base64url decode, hoist Platform import, and refresh session post-purchase ([eb2cf5f](https://github.com/equationalapplications/clanker/commit/eb2cf5fcd3204a01833d27f442019665d7e85d1d))
* **payments:** use native Supabase refreshSession post-purchase and clarify autoRefreshToken comment ([5b7d86d](https://github.com/equationalapplications/clanker/commit/5b7d86d46fdc5e303e299e22390a6908c82935de))
* resolve merge conflicts for dev into staging ([4806a50](https://github.com/equationalapplications/clanker/commit/4806a500b17cdd270eb88c75d4efb7a3088709fd))
* restore CHANGELOG entries to correct chronological order after merge conflict ([98710a0](https://github.com/equationalapplications/clanker/commit/98710a0a27753abffff4eea0b888ff692c50aad0))
* **routing:** remove duplicate (app) route group and fix stale-tab web errors ([6e72f26](https://github.com/equationalapplications/clanker/commit/6e72f26dd59472da0310553f395f78aa828fbb95))
* **settings:** show real app version from package.json ([7f23865](https://github.com/equationalapplications/clanker/commit/7f238655f6fdce5f6e774a240c86f29c20fb8eb9))


### Features

* **characters:** add character list page and improve details screen ([2abf5bc](https://github.com/equationalapplications/clanker/commit/2abf5bc4eb2eb246247a6d09e1d061264cb7be2b))
* **payments:** integrate Stripe and RevenueCat for cross-platform subscriptions ([771265f](https://github.com/equationalapplications/clanker/commit/771265f8baa82a2eacc30dfc05e1ca579101cf28))
* promote dev to staging ([#179](https://github.com/equationalapplications/clanker/issues/179)) ([26b0419](https://github.com/equationalapplications/clanker/commit/26b04194468a9e13e45d000e08b83cd8406ed7b4)), closes [#177](https://github.com/equationalapplications/clanker/issues/177) [#169](https://github.com/equationalapplications/clanker/issues/169) [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)

### BREAKING CHANGES

* Upgraded react-native to 0.83.2, react/react-dom to 19.2.4,
  and all Expo packages to SDK 55. Updated native module versions for firebase,
  navigation, reanimated, screens, gesture-handler, keyboard-controller, webview,
  and worklets. Added expo-font and expo-image plugins to app.config.ts.
  Requires new native build.
* Updated expo.
* Updated expo.

# [19.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v18.0.1...v19.0.0-staging.1) (2026-04-02)

* Dev ([#169](https://github.com/equationalapplications/clanker/issues/169)) ([8f81316](https://github.com/equationalapplications/clanker/commit/8f81316108b45e1feaae3ef72a5015a7f9084a81)), closes [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)
* feat!: upgrade to Expo SDK 55 with updated dependencies ([67047b5](https://github.com/equationalapplications/clanker/commit/67047b572f618e3997163793f507aa4f63d755e6))

### Bug Fixes

* add missing error handling and userId scoping ([1d9352f](https://github.com/equationalapplications/clanker/commit/1d9352fb705b61684acaa66311c53d89222f5511))
* address second round of PR review comments ([c8240ee](https://github.com/equationalapplications/clanker/commit/c8240ee6f7b07f647f4e371f713701a47f8d26e1))
* **auth:** address Copilot PR review feedback ([1c3bc29](https://github.com/equationalapplications/clanker/commit/1c3bc297ba482c9f922a415b54f85376d69b41bf))
* **auth:** eliminate Firebase race condition and simplify auth flow ([1e6bcc0](https://github.com/equationalapplications/clanker/commit/1e6bcc020994cea1f5422dddb296b0c98adf2c00))
* **auth:** fail open on terms check error to avoid blocking users ([aafb3aa](https://github.com/equationalapplications/clanker/commit/aafb3aa2837a51946777761f39c66ba2758f4385))
* **character-sync:** use Supabase Auth UUID for cloud operations, not Firebase UID ([6d1d6d3](https://github.com/equationalapplications/clanker/commit/6d1d6d3fd4a7609c1684fb6f6674d4a9565ed4f7))
* **ci:** disable semantic-release success/fail issue comments ([bc6c140](https://github.com/equationalapplications/clanker/commit/bc6c140264da9d1020be0182e51681b1279b5f11))
* **database:** correct soft-delete filtering and migration handling ([0a44410](https://github.com/equationalapplications/clanker/commit/0a44410b0105f395dc83f523d0f971ccf8ce4edd))
* **db:** address PR review - schema migration, soft-delete, deps ([579a397](https://github.com/equationalapplications/clanker/commit/579a397b9c243eed3005621eaac524fad800a2b4))
* **offline:** address PR review issues in offline-first architecture ([5d8637e](https://github.com/equationalapplications/clanker/commit/5d8637ed4dd020e61c60c0ff2e86f59435ed0183))
* **offline:** await Storage calls and fix startup sync connectivity check ([135246e](https://github.com/equationalapplications/clanker/commit/135246e875dbd6391f5b760753e8f9b162876104))
* **offline:** improve local-first sync behavior ([347e241](https://github.com/equationalapplications/clanker/commit/347e24196bf67ac0d533dee2ac4b6baeb419d3e5))
* **payments:** fix JWT base64url decode, hoist Platform import, and refresh session post-purchase ([#175](https://github.com/equationalapplications/clanker/issues/175)) ([8715e45](https://github.com/equationalapplications/clanker/commit/8715e45a7a73a4f5b0c5fd037e5d87f8642d94bb))
* **payments:** post-review fixes for cross-platform subscription flow ([#176](https://github.com/equationalapplications/clanker/issues/176)) ([69bdeb0](https://github.com/equationalapplications/clanker/commit/69bdeb048faeb7a775fa90dce286f3e8ff822d05))
* **payments:** use platform-specific product ID for credit pack and update pricing docs ([30ef71c](https://github.com/equationalapplications/clanker/commit/30ef71c55f66f837a722ad365732159cb497c135))
* resolve linting errors and warnings ([3c49022](https://github.com/equationalapplications/clanker/commit/3c49022cce27eef832698602d1360b21ebd0df2d))
* resolve linting errors and warnings ([#172](https://github.com/equationalapplications/clanker/issues/172)) ([1881e99](https://github.com/equationalapplications/clanker/commit/1881e999b766040fbfba62d5e86617b92d156713))
* resolve merge conflicts - accept staging over main ([63de453](https://github.com/equationalapplications/clanker/commit/63de4537b5fb0bb0c63343f17848b77771ebe9cd))
* resolve merge conflicts for dev into staging ([e6a9dce](https://github.com/equationalapplications/clanker/commit/e6a9dce2fc90a30c7ad15e08f7e79d21ed481894))
* resolve merge conflicts for staging into main ([e3af772](https://github.com/equationalapplications/clanker/commit/e3af77249ba44904eea96234b5a45bce23cafd2b))
* **subscription:** bubble up DB errors and preserve full state on transient failures ([b0aa80a](https://github.com/equationalapplications/clanker/commit/b0aa80ab1aa0b2b9123fa17a0783026a0d603eb6))
* **sync:** use default Storage import and map cloud_id to local id on restore ([0093b05](https://github.com/equationalapplications/clanker/commit/0093b05b6b41c947bc7a6c3ee19dae07119d9b91))
* **terms:** replace JWT claims with direct DB query for terms acceptance ([35176f1](https://github.com/equationalapplications/clanker/commit/35176f16e6877aff93d17e6df6bbf0906dea3441))

### Features

* **characters:** add character list page and improve details screen ([2abf5bc](https://github.com/equationalapplications/clanker/commit/2abf5bc4eb2eb246247a6d09e1d061264cb7be2b))
* **payments:** integrate Stripe and RevenueCat for cross-platform subscriptions ([771265f](https://github.com/equationalapplications/clanker/commit/771265f8baa82a2eacc30dfc05e1ca579101cf28))
* promote dev to staging ([#179](https://github.com/equationalapplications/clanker/issues/179)) ([26b0419](https://github.com/equationalapplications/clanker/commit/26b04194468a9e13e45d000e08b83cd8406ed7b4)), closes [#177](https://github.com/equationalapplications/clanker/issues/177) [#169](https://github.com/equationalapplications/clanker/issues/169) [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)

### BREAKING CHANGES

* Upgraded react-native to 0.83.2, react/react-dom to 19.2.4,
  and all Expo packages to SDK 55. Updated native module versions for firebase,
  navigation, reanimated, screens, gesture-handler, keyboard-controller, webview,
  and worklets. Added expo-font and expo-image plugins to app.config.ts.
  Requires new native build.
* Updated expo.
* Updated expo.

## [18.0.1](https://github.com/equationalapplications/clanker/compare/v18.0.0...v18.0.1) (2026-03-31)

### Bug Fixes

- **ci:** add --platform all to production EAS build command ([aedc661](https://github.com/equationalapplications/clanker/commit/aedc6613795b337ab35be7d16e9e4d590cdfaec9))

# [18.0.0](https://github.com/equationalapplications/clanker/compare/v17.0.0...v18.0.0) (2026-03-31)

### Release

- staging → main (v18.0.0-staging.1) ([#177](https://github.com/equationalapplications/clanker/issues/177)) ([93249e8](https://github.com/equationalapplications/clanker/commit/93249e884faf139d1dc2609fcbc7645952288940)), closes [#169](https://github.com/equationalapplications/clanker/issues/169) [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)

### BREAKING CHANGES

- Updated expo.
- Updated expo.

# [18.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v17.0.0...v18.0.0-staging.1) (2026-03-31)

- Dev ([#169](https://github.com/equationalapplications/clanker/issues/169)) ([8f81316](https://github.com/equationalapplications/clanker/commit/8f81316108b45e1feaae3ef72a5015a7f9084a81)), closes [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)
- feat!: upgrade to Expo SDK 55 with updated dependencies ([67047b5](https://github.com/equationalapplications/clanker/commit/67047b572f618e3997163793f507aa4f63d755e6))

### Bug Fixes

- add missing error handling and userId scoping ([1d9352f](https://github.com/equationalapplications/clanker/commit/1d9352fb705b61684acaa66311c53d89222f5511))
- address second round of PR review comments ([c8240ee](https://github.com/equationalapplications/clanker/commit/c8240ee6f7b07f647f4e371f713701a47f8d26e1))
- **auth:** address Copilot PR review feedback ([1c3bc29](https://github.com/equationalapplications/clanker/commit/1c3bc297ba482c9f922a415b54f85376d69b41bf))
- **auth:** eliminate Firebase race condition and simplify auth flow ([1e6bcc0](https://github.com/equationalapplications/clanker/commit/1e6bcc020994cea1f5422dddb296b0c98adf2c00))
- **auth:** fail open on terms check error to avoid blocking users ([aafb3aa](https://github.com/equationalapplications/clanker/commit/aafb3aa2837a51946777761f39c66ba2758f4385))
- **character-sync:** use Supabase Auth UUID for cloud operations, not Firebase UID ([6d1d6d3](https://github.com/equationalapplications/clanker/commit/6d1d6d3fd4a7609c1684fb6f6674d4a9565ed4f7))
- **ci:** disable semantic-release success/fail issue comments ([bc6c140](https://github.com/equationalapplications/clanker/commit/bc6c140264da9d1020be0182e51681b1279b5f11))
- **database:** correct soft-delete filtering and migration handling ([0a44410](https://github.com/equationalapplications/clanker/commit/0a44410b0105f395dc83f523d0f971ccf8ce4edd))
- **db:** address PR review - schema migration, soft-delete, deps ([579a397](https://github.com/equationalapplications/clanker/commit/579a397b9c243eed3005621eaac524fad800a2b4))
- **offline:** address PR review issues in offline-first architecture ([5d8637e](https://github.com/equationalapplications/clanker/commit/5d8637ed4dd020e61c60c0ff2e86f59435ed0183))
- **offline:** await Storage calls and fix startup sync connectivity check ([135246e](https://github.com/equationalapplications/clanker/commit/135246e875dbd6391f5b760753e8f9b162876104))
- **offline:** improve local-first sync behavior ([347e241](https://github.com/equationalapplications/clanker/commit/347e24196bf67ac0d533dee2ac4b6baeb419d3e5))
- **payments:** fix JWT base64url decode, hoist Platform import, and refresh session post-purchase ([#175](https://github.com/equationalapplications/clanker/issues/175)) ([8715e45](https://github.com/equationalapplications/clanker/commit/8715e45a7a73a4f5b0c5fd037e5d87f8642d94bb))
- **payments:** post-review fixes for cross-platform subscription flow ([#176](https://github.com/equationalapplications/clanker/issues/176)) ([69bdeb0](https://github.com/equationalapplications/clanker/commit/69bdeb048faeb7a775fa90dce286f3e8ff822d05))
- **payments:** use platform-specific product ID for credit pack and update pricing docs ([30ef71c](https://github.com/equationalapplications/clanker/commit/30ef71c55f66f837a722ad365732159cb497c135))
- resolve linting errors and warnings ([3c49022](https://github.com/equationalapplications/clanker/commit/3c49022cce27eef832698602d1360b21ebd0df2d))
- resolve linting errors and warnings ([#172](https://github.com/equationalapplications/clanker/issues/172)) ([1881e99](https://github.com/equationalapplications/clanker/commit/1881e999b766040fbfba62d5e86617b92d156713))
- resolve merge conflicts - accept staging over main ([63de453](https://github.com/equationalapplications/clanker/commit/63de4537b5fb0bb0c63343f17848b77771ebe9cd))
- resolve merge conflicts for dev into staging ([e6a9dce](https://github.com/equationalapplications/clanker/commit/e6a9dce2fc90a30c7ad15e08f7e79d21ed481894))
- **subscription:** bubble up DB errors and preserve full state on transient failures ([b0aa80a](https://github.com/equationalapplications/clanker/commit/b0aa80ab1aa0b2b9123fa17a0783026a0d603eb6))
- **sync:** use default Storage import and map cloud_id to local id on restore ([0093b05](https://github.com/equationalapplications/clanker/commit/0093b05b6b41c947bc7a6c3ee19dae07119d9b91))
- **terms:** replace JWT claims with direct DB query for terms acceptance ([35176f1](https://github.com/equationalapplications/clanker/commit/35176f16e6877aff93d17e6df6bbf0906dea3441))

### Features

* **characters:** add character list page and improve details screen ([2abf5bc](https://github.com/equationalapplications/clanker/commit/2abf5bc4eb2eb246247a6d09e1d061264cb7be2b))
* **payments:** integrate Stripe and RevenueCat for cross-platform subscriptions ([771265f](https://github.com/equationalapplications/clanker/commit/771265f8baa82a2eacc30dfc05e1ca579101cf28))
* promote dev to staging ([#179](https://github.com/equationalapplications/clanker/issues/179)) ([26b0419](https://github.com/equationalapplications/clanker/commit/26b04194468a9e13e45d000e08b83cd8406ed7b4)), closes [#177](https://github.com/equationalapplications/clanker/issues/177) [#169](https://github.com/equationalapplications/clanker/issues/169) [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)

### BREAKING CHANGES

* Upgraded react-native to 0.83.2, react/react-dom to 19.2.4,
  and all Expo packages to SDK 55. Updated native module versions for firebase,
  navigation, reanimated, screens, gesture-handler, keyboard-controller, webview,
  and worklets. Added expo-font and expo-image plugins to app.config.ts.
  Requires new native build.
* Updated expo.
* Updated expo.

# [17.0.0-staging.2](https://github.com/equationalapplications/clanker/compare/v17.0.0-staging.1...v17.0.0-staging.2) (2026-03-25)

- Dev ([#169](https://github.com/equationalapplications/clanker/issues/169)) ([#170](https://github.com/equationalapplications/clanker/issues/170)) ([f4c8415](https://github.com/equationalapplications/clanker/commit/f4c8415b1138ab8d6004fc6e95f4d2d38162dce4)), closes [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)

### Bug Fixes

- resolve merge conflicts - accept staging over main ([63de453](https://github.com/equationalapplications/clanker/commit/63de4537b5fb0bb0c63343f17848b77771ebe9cd))

### BREAKING CHANGES

- Updated expo.
- Updated expo.

# [17.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v16.0.0...v17.0.0-staging.1) (2026-03-25)

- Dev ([#169](https://github.com/equationalapplications/clanker/issues/169)) ([8f81316](https://github.com/equationalapplications/clanker/commit/8f81316108b45e1feaae3ef72a5015a7f9084a81)), closes [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)
- feat!: upgrade to Expo SDK 55 with updated dependencies ([67047b5](https://github.com/equationalapplications/clanker/commit/67047b572f618e3997163793f507aa4f63d755e6))

### Bug Fixes

- address second round of PR review comments ([c8240ee](https://github.com/equationalapplications/clanker/commit/c8240ee6f7b07f647f4e371f713701a47f8d26e1))
- **auth:** address Copilot PR review feedback ([1c3bc29](https://github.com/equationalapplications/clanker/commit/1c3bc297ba482c9f922a415b54f85376d69b41bf))
- **auth:** eliminate Firebase race condition and simplify auth flow ([1e6bcc0](https://github.com/equationalapplications/clanker/commit/1e6bcc020994cea1f5422dddb296b0c98adf2c00))
- **auth:** fail open on terms check error to avoid blocking users ([aafb3aa](https://github.com/equationalapplications/clanker/commit/aafb3aa2837a51946777761f39c66ba2758f4385))
- **character-sync:** use Supabase Auth UUID for cloud operations, not Firebase UID ([6d1d6d3](https://github.com/equationalapplications/clanker/commit/6d1d6d3fd4a7609c1684fb6f6674d4a9565ed4f7))
- **ci:** disable semantic-release success/fail issue comments ([bc6c140](https://github.com/equationalapplications/clanker/commit/bc6c140264da9d1020be0182e51681b1279b5f11))
- **db:** address PR review - schema migration, soft-delete, deps ([579a397](https://github.com/equationalapplications/clanker/commit/579a397b9c243eed3005621eaac524fad800a2b4))
- **offline:** address PR review issues in offline-first architecture ([5d8637e](https://github.com/equationalapplications/clanker/commit/5d8637ed4dd020e61c60c0ff2e86f59435ed0183))
- **offline:** await Storage calls and fix startup sync connectivity check ([135246e](https://github.com/equationalapplications/clanker/commit/135246e875dbd6391f5b760753e8f9b162876104))
- **offline:** improve local-first sync behavior ([347e241](https://github.com/equationalapplications/clanker/commit/347e24196bf67ac0d533dee2ac4b6baeb419d3e5))
- resolve linting errors and warnings ([#172](https://github.com/equationalapplications/clanker/issues/172)) ([1881e99](https://github.com/equationalapplications/clanker/commit/1881e999b766040fbfba62d5e86617b92d156713))
- **subscription:** bubble up DB errors and preserve full state on transient failures ([b0aa80a](https://github.com/equationalapplications/clanker/commit/b0aa80ab1aa0b2b9123fa17a0783026a0d603eb6))
- **sync:** use default Storage import and map cloud_id to local id on restore ([0093b05](https://github.com/equationalapplications/clanker/commit/0093b05b6b41c947bc7a6c3ee19dae07119d9b91))
- **terms:** replace JWT claims with direct DB query for terms acceptance ([35176f1](https://github.com/equationalapplications/clanker/commit/35176f16e6877aff93d17e6df6bbf0906dea3441))

### Features

* **characters:** add character list page and improve details screen ([2abf5bc](https://github.com/equationalapplications/clanker/commit/2abf5bc4eb2eb246247a6d09e1d061264cb7be2b))

### BREAKING CHANGES

* Upgraded react-native to 0.83.2, react/react-dom to 19.2.4,
  and all Expo packages to SDK 55. Updated native module versions for firebase,
  navigation, reanimated, screens, gesture-handler, keyboard-controller, webview,
  and worklets. Added expo-font and expo-image plugins to app.config.ts.
  Requires new native build.
* Updated expo.
* Updated expo.

# [16.0.0](https://github.com/equationalapplications/clanker/compare/v15.0.0...v16.0.0) (2026-03-22)

- Dev ([#167](https://github.com/equationalapplications/clanker/issues/167)) ([bd343c7](https://github.com/equationalapplications/clanker/commit/bd343c78cab9b070cf797e96734b26019b2f921a)), closes [#166](https://github.com/equationalapplications/clanker/issues/166) [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157) [#160](https://github.com/equationalapplications/clanker/issues/160)

### Bug Fixes

- address Copilot PR review feedback ([337415e](https://github.com/equationalapplications/clanker/commit/337415e8f8960a1e1d8a6876710f210859037358))
- address second round of PR review feedback ([1606929](https://github.com/equationalapplications/clanker/commit/1606929df667979a287e1b511b8ce889d8529705))
- **auth:** correct credits query to use current_credits and yours-brightly app ([ceac290](https://github.com/equationalapplications/clanker/commit/ceac290fa61efdb3050067660103a336780a88b4))
- **auth:** disable auto-refresh and use manual token refresh via exchangeToken ([d9131d0](https://github.com/equationalapplications/clanker/commit/d9131d08f7131ef33510a920a555853aee70be7c))
- **auth:** ensure google sign-in initializes on all platforms ([6729459](https://github.com/equationalapplications/clanker/commit/6729459d2a13ab06c256275f4900c380e9263c85))
- **auth:** update getSupabaseUserSession to use real Supabase session format ([be3a5e2](https://github.com/equationalapplications/clanker/commit/be3a5e26f67c590da5cba7444bc7cc60c934759e))
- **auth:** use Firebase signInWithPopup as primary Google auth method ([d6f68de](https://github.com/equationalapplications/clanker/commit/d6f68ded74f349e947101ef6b99cec4487114dad))
- **ci:** enable semantic-release push permissions and fix token ([341a14a](https://github.com/equationalapplications/clanker/commit/341a14a9a6c17dc29334a820cd970931982bb7fa))
- **ci:** resolve GitHub Actions checkout authentication error ([24fa7f3](https://github.com/equationalapplications/clanker/commit/24fa7f3c6d015d4954d266a43f3dbd7ddc06f673))
- **ci:** resolve GitHub Actions checkout authentication error ([#164](https://github.com/equationalapplications/clanker/issues/164)) ([6543a51](https://github.com/equationalapplications/clanker/commit/6543a513ad4f54e1eb8c3ea192510f6cfdd1d5e2))
- **ci:** use consistent token for checkout and semantic-release ([8201c39](https://github.com/equationalapplications/clanker/commit/8201c39004fd41818af3d2a474f417e8f95f7930)), closes [#165](https://github.com/equationalapplications/clanker/issues/165)
- **ci:** use GH_PAT to bypass branch protection in workflows ([9c45eef](https://github.com/equationalapplications/clanker/commit/9c45eefab608edfbfa1cf8f84776a716cfb89c36))
- **ci:** use github.token only, remove GH_PAT dependency ([01e8a55](https://github.com/equationalapplications/clanker/commit/01e8a55a729d2bb4b62ff73a55a44901ca35fe3c))
- **db:** query profiles table instead of non-existent clanker table ([1fba416](https://github.com/equationalapplications/clanker/commit/1fba416ef9f31771e94be435739d4eaf2f19815e))
- **firebase:** improve app check initialization with recaptcha key validation ([f4581f7](https://github.com/equationalapplications/clanker/commit/f4581f7897897bac4805b1dd1ebc1fde1f9c71b2))
- **security:** guard debug token behind **DEV** and redact token logs ([f1720c9](https://github.com/equationalapplications/clanker/commit/f1720c9bc2b1c64f856a64aa2a272edc5e948184))

### Build System

- enable local builds ([143e059](https://github.com/equationalapplications/clanker/commit/143e0592b67c41509cebf290f0775ba7715e2394))
- enable local builds ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))
- merge dev into staging ([12cd4ad](https://github.com/equationalapplications/clanker/commit/12cd4ad92a7323433eb5463832f6806612bab07a))

### Features

- app Check ([0d592b0](https://github.com/equationalapplications/clanker/commit/0d592b0e3555723e86472e2788cc4928776be27d))

### BREAKING CHANGES

- Updated expo.
- Updated expo.

# [15.0.0-staging.2](https://github.com/equationalapplications/clanker/compare/v15.0.0-staging.1...v15.0.0-staging.2) (2026-03-22)

### Bug Fixes

- address Copilot PR review feedback ([337415e](https://github.com/equationalapplications/clanker/commit/337415e8f8960a1e1d8a6876710f210859037358))
- address second round of PR review feedback ([1606929](https://github.com/equationalapplications/clanker/commit/1606929df667979a287e1b511b8ce889d8529705))
- **auth:** correct credits query to use current_credits and yours-brightly app ([ceac290](https://github.com/equationalapplications/clanker/commit/ceac290fa61efdb3050067660103a336780a88b4))
- **auth:** disable auto-refresh and use manual token refresh via exchangeToken ([d9131d0](https://github.com/equationalapplications/clanker/commit/d9131d08f7131ef33510a920a555853aee70be7c))
- **auth:** ensure google sign-in initializes on all platforms ([6729459](https://github.com/equationalapplications/clanker/commit/6729459d2a13ab06c256275f4900c380e9263c85))
- **auth:** update getSupabaseUserSession to use real Supabase session format ([be3a5e2](https://github.com/equationalapplications/clanker/commit/be3a5e26f67c590da5cba7444bc7cc60c934759e))
- **auth:** use Firebase signInWithPopup as primary Google auth method ([d6f68de](https://github.com/equationalapplications/clanker/commit/d6f68ded74f349e947101ef6b99cec4487114dad))
- **ci:** enable semantic-release push permissions and fix token ([341a14a](https://github.com/equationalapplications/clanker/commit/341a14a9a6c17dc29334a820cd970931982bb7fa))
- **ci:** resolve GitHub Actions checkout authentication error ([24fa7f3](https://github.com/equationalapplications/clanker/commit/24fa7f3c6d015d4954d266a43f3dbd7ddc06f673))
- **ci:** resolve GitHub Actions checkout authentication error ([#164](https://github.com/equationalapplications/clanker/issues/164)) ([6543a51](https://github.com/equationalapplications/clanker/commit/6543a513ad4f54e1eb8c3ea192510f6cfdd1d5e2))
- **ci:** use consistent token for checkout and semantic-release ([8201c39](https://github.com/equationalapplications/clanker/commit/8201c39004fd41818af3d2a474f417e8f95f7930)), closes [#165](https://github.com/equationalapplications/clanker/issues/165)
- **ci:** use GH_PAT to bypass branch protection in workflows ([9c45eef](https://github.com/equationalapplications/clanker/commit/9c45eefab608edfbfa1cf8f84776a716cfb89c36))
- **ci:** use github.token only, remove GH_PAT dependency ([01e8a55](https://github.com/equationalapplications/clanker/commit/01e8a55a729d2bb4b62ff73a55a44901ca35fe3c))
- **db:** query profiles table instead of non-existent clanker table ([1fba416](https://github.com/equationalapplications/clanker/commit/1fba416ef9f31771e94be435739d4eaf2f19815e))
- **firebase:** improve app check initialization with recaptcha key validation ([f4581f7](https://github.com/equationalapplications/clanker/commit/f4581f7897897bac4805b1dd1ebc1fde1f9c71b2))
- **security:** guard debug token behind **DEV** and redact token logs ([f1720c9](https://github.com/equationalapplications/clanker/commit/f1720c9bc2b1c64f856a64aa2a272edc5e948184))

### Features

- app Check ([0d592b0](https://github.com/equationalapplications/clanker/commit/0d592b0e3555723e86472e2788cc4928776be27d))

# [14.0.0](https://github.com/equationalapplications/clanker/compare/v13.0.0...v14.0.0) (2025-10-25)

### Build System

- Enable local builds with Firebase configs from environment variables ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))
- Align EAS config with modern environment variables for cloud and local builds.
- Update GitHub Actions workflows for `semantic-release`.

### Features

- **Auth:** Align Firebase authentication with latest RNFirebase docs.
- **Auth:** Implement unified logout flow (Supabase + Firebase + Google).

### BREAKING CHANGES

- **Build:** Local builds now require `GOOGLE_SERVICES_JSON_BASE64` and `GOOGLE_SERVICE_INFO_PLIST_BASE64` to be set in a `.env` file.
- **Auth:** The authentication flow has been updated, which may affect existing sessions.

# [13.0.0](https://github.com/equationalapplications/clanker/compare/v12.0.0...v13.0.0) (2025-10-25)

_This version was part of a branch restructuring and does not contain new features._

# [12.0.0](https://github.com/equationalapplications/clanker/compare/v11.0.0...v12.0.0) (2025-10-19)

### Code Refactoring

- remove RevenueCat and migrate fully to Stripe ([ca41fae](https://github.com/equationalapplications/clanker/commit/ca41fae7eb02c5b77424e011f637f3b7742abed0))

### BREAKING CHANGES

- Remove RevenueCat integration, all subscriptions now use Stripe directly.

# [11.0.0](https://github.com/equationalapplications/clanker/compare/v10.0.0...v11.0.0) (2025-10-19)

### Bug Fixes

- remove duplicate entries ([69dae6e](https://github.com/equationalapplications/clanker/commit/69dae6e1f5197455b108ef7aefd34d311c8c610c))
- adapt login for navigation ([ab48679](https://github.com/equationalapplications/clanker/commit/ab4867976a67f89a5d92263b5fbee9e7ffba42a4))
- add android intentFilter for facebook auth ([4f04dc7](https://github.com/equationalapplications/clanker/commit/4f04dc7570a2723db59f877fbdeb5bcfd7511524))
- add character to state ([b7d009f](https://github.com/equationalapplications/clanker/commit/b7d009f421114db65edd0a7b08723982687ad96e))
- add checks for null ([85f0f31](https://github.com/equationalapplications/clanker/commit/85f0f31f974f9e30bf82607a881614a62b8d1112))
- add comma after prefix ([c7f0ae0](https://github.com/equationalapplications/clanker/commit/c7f0ae04e8442c3693fa60e6f481bc99a45de67a))
- add default url for avatar ([ded70e9](https://github.com/equationalapplications/clanker/commit/ded70e96c8956d7f15900a4710c73749407e1495))
- add facebook scheme ([2fef716](https://github.com/equationalapplications/clanker/commit/2fef716c09e9e44e51c9a305c87f492b3fd70614))
- add id and userId to useEffect dep array ([ed1c9f1](https://github.com/equationalapplications/clanker/commit/ed1c9f18fabc8d75370f435ab75aa04682357182))
- add key to navigation groups ([b2721aa](https://github.com/equationalapplications/clanker/commit/b2721aae5965db1c1f3d09c7429ea045589f1b53))
- add linking for signin and paywall ([01c3be7](https://github.com/equationalapplications/clanker/commit/01c3be78aec8cea253b90aafdc1938b5390c1d39))
- add navigate to signin ([26447f5](https://github.com/equationalapplications/clanker/commit/26447f5abaef5468d8a70cdb9f70f7822ddfdb2b))
- add peer dependency for google auth ([f995e68](https://github.com/equationalapplications/clanker/commit/f995e682924a3197b674389806f59f680cdcad6a))
- add question mark to customerInfo properties ([ca01384](https://github.com/equationalapplications/clanker/commit/ca01384bceb34013e2f45c4a120db9ab71a79414))
- add state to TextInput to avoid jerky UI ([d729034](https://github.com/equationalapplications/clanker/commit/d72903481cc92b6d5cf013eaf2bd54562f990132))
- add uid to useAuthUser key ([3d00a9b](https://github.com/equationalapplications/clanker/commit/3d00a9bade7f55a79c5348a65eecf3261a608210))
- add uid to useAuthUser key ([05c9fda](https://github.com/equationalapplications/clanker/commit/05c9fda05227379bd56457c80fc3abfb220687a0))
- add user to useEffect dependency array ([38a2a89](https://github.com/equationalapplications/clanker/commit/38a2a897167f53a1c77fe403879085ad89ca9a58))
- **auth:** fix auth flow ([fc8542b](https://github.com/equationalapplications/clanker/commit/fc8542bc20be7d283f2405fb485be2ec85908d17))
- **auth:** fix auth flow ([47ca474](https://github.com/equationalapplications/clanker/commit/47ca474c6ac663179ac89b747f5d8ebe30635317))
- call hooks in function ([bf32eb2](https://github.com/equationalapplications/clanker/commit/bf32eb218486ab71fb808f5771e8944bd7851c64))
- check ( credits <= 0 && !isPremium ) ([d7b710a](https://github.com/equationalapplications/clanker/commit/d7b710aaf43c37d117accac836f5773b613a83db))
- check if refetch is null in useEffect ([cd224dd](https://github.com/equationalapplications/clanker/commit/cd224dd39bc8bb4c8b3163cbab9957cf4227d4c0))
- combine colors properly for display on Andoid ([45c08fe](https://github.com/equationalapplications/clanker/commit/45c08fefa06115bd1b4e44dcfc0d6902a35b7edb))
- compare with uid ([e00def4](https://github.com/equationalapplications/clanker/commit/e00def4961b453aa88cc88368ddd5ee5cf39ce69))
- correct display name ([7f003ce](https://github.com/equationalapplications/clanker/commit/7f003ce8ce75d2b60a83b5db7f144ed2fd25f967))
- correct object shape of colorsDark ([0167a2c](https://github.com/equationalapplications/clanker/commit/0167a2c208c4babbc3519b6a80f7981796615c2b))
- correct the collection path ([f84d948](https://github.com/equationalapplications/clanker/commit/f84d948157e7f5343fec11a4783307367f2a1ef0))
- correct user_characters ([c21f40f](https://github.com/equationalapplications/clanker/commit/c21f40f42d19c7d449b57f6e834469304ae50f6d))
- correct variable names ([5852c8c](https://github.com/equationalapplications/clanker/commit/5852c8cdd351e8a8fc1fb712ab3b3079eb23f99f))
- do not remove createdAt ([b627c3e](https://github.com/equationalapplications/clanker/commit/b627c3e2992727ce8ce1b29fa38f10d044df7694))
- **fics:** fixs chat ([135b001](https://github.com/equationalapplications/clanker/commit/135b001f833b9deecdede083cb4d2a58523d8f66))
- **fics:** fixs chat ([00702dc](https://github.com/equationalapplications/clanker/commit/00702dc9b0dd4faab77d7232918f54209324a3da))
- fix accept term ([054bb29](https://github.com/equationalapplications/clanker/commit/054bb29d752afa159d9256298ae68559f6a5b38c))
- fix accept term ([1500daf](https://github.com/equationalapplications/clanker/commit/1500daf8fa2a7c2691ae8f62e42b6b4973407805))
- fix accept terms ([bdcb6f4](https://github.com/equationalapplications/clanker/commit/bdcb6f420e713811fe2b729c14182d14da98e9e5))
- fix accept terms ([cd865c1](https://github.com/equationalapplications/clanker/commit/cd865c1dc8c2243cfaa55a9e2bda6d99c93e7fa5))
- fix android google signin ([43c354d](https://github.com/equationalapplications/clanker/commit/43c354dea27b68b7fd4d2f9984034d75b2829957))
- fix auth flow ([2a23a86](https://github.com/equationalapplications/clanker/commit/2a23a8692af2b11e6d01db619c87d16ba209a2c3))
- fix auth flow ([fca8b4d](https://github.com/equationalapplications/clanker/commit/fca8b4d453f811269df9e8b63e83caeab8b535c6))
- fix charachters navigation ([58a2692](https://github.com/equationalapplications/clanker/commit/58a2692ac54f6e428fbe10b0805125f372c5595a))
- fix charachters navigation ([5a6d82b](https://github.com/equationalapplications/clanker/commit/5a6d82b516feb1cbef26f62ee775f69975a4e90e))
- fix expo deps ([ace4e7a](https://github.com/equationalapplications/clanker/commit/ace4e7a330200be8f95411ccc760efb57af3b52c))
- fix expo deps ([32d1a78](https://github.com/equationalapplications/clanker/commit/32d1a78301d55b12e2f9525e78931bba95fdf4a4))
- fix imports. update packages ([973d134](https://github.com/equationalapplications/clanker/commit/973d134f5c84041dd45a7c1027ee59673221edd3))
- fix nav ([b0b3723](https://github.com/equationalapplications/clanker/commit/b0b3723e61ad59f14e4e4b7920e8ad117a31e6a9))
- fix nav ([c4789bf](https://github.com/equationalapplications/clanker/commit/c4789bffbba88a5a911ee4f8ae3d2ed590e60097))
- fix navigation ([1648e1b](https://github.com/equationalapplications/clanker/commit/1648e1b82b3d4f532919c44fc294bb68e77f7515))
- fix navigation ([ceeb6be](https://github.com/equationalapplications/clanker/commit/ceeb6bea2b61c5bfc93d9b45bbac9c9bd3c4125e))
- fix web auth ([a25b6b5](https://github.com/equationalapplications/clanker/commit/a25b6b52540907ee1a1ba23529ddf4acae645fbe))
- gitignore ([0350b7d](https://github.com/equationalapplications/clanker/commit/0350b7df4701d83d8a16ac6ea4818d9e56d43f5d))
- id and userId null default ([a77d78c](https://github.com/equationalapplications/clanker/commit/a77d78c44a18841e7c2e7e17c88ccf48dea0d8cd))
- imageIsLoading ([8062d77](https://github.com/equationalapplications/clanker/commit/8062d770121165923ae2f9bdfd7454563edb7d3e))
- implement updateDoc ([aac9449](https://github.com/equationalapplications/clanker/commit/aac9449b7b3d3aeb4015dbe903b6e2ccb6d2af10))
- import expo-random ([4ee6044](https://github.com/equationalapplications/clanker/commit/4ee6044212fc49f6d230ba763f5806b8feffb8ea))
- invalidateQueries("isPremium") after purchase ([3626799](https://github.com/equationalapplications/clanker/commit/36267997bc9d5ef46d01ee47c17e90d4e3eeef53))
- ios build ([5ce2067](https://github.com/equationalapplications/clanker/commit/5ce2067d0a1c40786c1a76698a92b79ec1ec4784))
- isEraseModal intially false ([3ee5b15](https://github.com/equationalapplications/clanker/commit/3ee5b15894a13c1d12aaf4e3706c1df1cea40494))
- make SignIn the initial route ([9394198](https://github.com/equationalapplications/clanker/commit/9394198ef959ea43e1851a51cc7b0b5430b0b029))
- nav ([09e75f6](https://github.com/equationalapplications/clanker/commit/09e75f68f5e310e012419539fc276f6d1d267d65))
- nav ([25ef2d1](https://github.com/equationalapplications/clanker/commit/25ef2d1149cdbf27ec56c76bccd4619a747e1dca))
- navigate with navigation.getParent() ([e89e587](https://github.com/equationalapplications/clanker/commit/e89e587d7fa6e25c9aa85cf4142082b5925d07da))
- null collesssing ([27f3de8](https://github.com/equationalapplications/clanker/commit/27f3de883152a47b02eeb4600abc1768b9bc599f))
- onConfirmDeleteAccount order of functions ([0690dfa](https://github.com/equationalapplications/clanker/commit/0690dfa2ac107f28f7a0cd19a68a847ef4e8ac1d))
- onPressSignOut queryClient.clear() ([de14697](https://github.com/equationalapplications/clanker/commit/de146976c1a4237307f559355729b999efe75936))
- persist auth ([2a37cb7](https://github.com/equationalapplications/clanker/commit/2a37cb75ff75f6680a9e2d098d62ddc81aa095ff))
- persist auth ([4ef542d](https://github.com/equationalapplications/clanker/commit/4ef542da18d1910e05af73d49df48edcc8384685))
- profiles, characters, messages ([dddf85f](https://github.com/equationalapplications/clanker/commit/dddf85fb72dfd29c2d1eb7cf77ca7ef6afabea88))
- profiles, characters, messages ([62ad0d6](https://github.com/equationalapplications/clanker/commit/62ad0d6d11d03ebea8fbfc7212fbcb628e4919ca))
- remove auth loading state. format 2 space indentation ([bfa3543](https://github.com/equationalapplications/clanker/commit/bfa35435df1f38df955ce53fd10e13c016ea8f9c))
- remove auth loading state. format 2 space indentation ([15f7753](https://github.com/equationalapplications/clanker/commit/15f77534fa878383c2fb00d1b825678d85b4b198))
- remove duplicate key ([fdcccdd](https://github.com/equationalapplications/clanker/commit/fdcccddb6c2873277d7568babdf5800dddb32bb5))
- remove firestore ([bf96200](https://github.com/equationalapplications/clanker/commit/bf96200a0ffafd554e3e6d02e9b9135827f20e74))
- remove firestore ([6bc7f59](https://github.com/equationalapplications/clanker/commit/6bc7f5940f312f350152fd1f95a6e488bcbb8f4b))
- remove incorrect expo-build-properties ([132ccfc](https://github.com/equationalapplications/clanker/commit/132ccfca3117a824ba8842c2c57448f1a93eeacf))
- remove invalidateQueries ([d666bc6](https://github.com/equationalapplications/clanker/commit/d666bc642c81854a37241816d8711fe896faea41))
- remove navigation in useEffect for user changes ([184a5c0](https://github.com/equationalapplications/clanker/commit/184a5c05199469f25a0b4e830d68ba9571bb9a4b))
- remove optimistic update ([fd4d728](https://github.com/equationalapplications/clanker/commit/fd4d728167e696935246c879a17664ab138288ed))
- remove setUser. replace with return null ([1763ed0](https://github.com/equationalapplications/clanker/commit/1763ed0ea0a618e8de076af67fc4134b06810026))
- remove unneeded createaccount screen ([f877e55](https://github.com/equationalapplications/clanker/commit/f877e556824d7417f8eb2375ec88bb1f9a0dfe55))
- retry: 3, staleTime: 1 hour ([1fce836](https://github.com/equationalapplications/clanker/commit/1fce8368da7b3fee9eba563a3a9708028ac44c98))
- return data ([6049b4f](https://github.com/equationalapplications/clanker/commit/6049b4fa8bd4deaee9fb43dbb72514d0398be0a0))
- roll back EAS changes ([bdf0918](https://github.com/equationalapplications/clanker/commit/bdf09186971170297a9b1ceb344920d84febf0bb))
- roll back expo-linking ([8eb7cb2](https://github.com/equationalapplications/clanker/commit/8eb7cb2ffd7ed83be8eceda3bc2e66c549bbfd0e))
- roll back to default file ([db66554](https://github.com/equationalapplications/clanker/commit/db66554f6b6a8f611bbf5d26228107f0d7cafef6))
- scale adaptive-icon to 512 x 512 ([69f6ca1](https://github.com/equationalapplications/clanker/commit/69f6ca104be165bb2957f0fdc0d2261fee7196b4))
- scale image layer to fit ([d6651ab](https://github.com/equationalapplications/clanker/commit/d6651abf98997a3b2ab91417e6c391e9fe0165a3))
- scheme remove array ([889d8a4](https://github.com/equationalapplications/clanker/commit/889d8a47a5b2e3acb8425468143b8a4b0037709e))
- scrollview style ([28f10d4](https://github.com/equationalapplications/clanker/commit/28f10d4eeb0f5748394bba76610a3b6f0c3c1bfb))
- scrollview style ([c09e58d](https://github.com/equationalapplications/clanker/commit/c09e58d16bef3e7d3ab686de43fd636bd84cf0c4))
- show indicator then sign out when deleting user ([ee46cd9](https://github.com/equationalapplications/clanker/commit/ee46cd9ca7dd749718fdfe0300fbbac226ea4596))
- show loading indicator conditions ([7c4c692](https://github.com/equationalapplications/clanker/commit/7c4c69206e710b30cb21a1b68935e97840fcde46))
- sort and then remove createdAt ([14490f1](https://github.com/equationalapplications/clanker/commit/14490f122c63d9ca2459b95eaaa12c0ad24d57a8))
- sort messages by createAt ([af4039a](https://github.com/equationalapplications/clanker/commit/af4039ae273dc01585d7d8948fc6015fc5ebed2b))
- subscribe to firestore messages ([cf9034c](https://github.com/equationalapplications/clanker/commit/cf9034c63fd77c7dac2822c20a6a968a392d37fb))
- **supabase:** fix supabase login ([9d9661f](https://github.com/equationalapplications/clanker/commit/9d9661f43a70f5f51d87959867d21a1cbac41d32))
- **supabase:** fix supabase login ([5c6097f](https://github.com/equationalapplications/clanker/commit/5c6097f0b76398bfb136e6c9cdcb398010052116))
- temp disable billing button ([193b2dd](https://github.com/equationalapplications/clanker/commit/193b2ddb26d68805cec7fa2e9659d8b2d2c38814))
- **terms:** accpet terms ([1c24548](https://github.com/equationalapplications/clanker/commit/1c245482abb2fb76c2f5c529bcb8a00c7b70a6d1))
- **terms:** accpet terms ([e692661](https://github.com/equationalapplications/clanker/commit/e692661f0308cb0335228e434c8322df8531e46d))
- the last commit changed metro config ([eed31b5](https://github.com/equationalapplications/clanker/commit/eed31b5d94961b498a4076bf96d989c922bb6184))
- **types:** small focused tsc fixes ([1b923e2](https://github.com/equationalapplications/clanker/commit/1b923e23ecea8ff128e6e3279e9b87d4e6d05e3d))
- **types:** small focused tsc fixes ([a2151f5](https://github.com/equationalapplications/clanker/commit/a2151f5edae7e1c475183452c5385c2ac0aeb113))
- typo ([e8ae7bd](https://github.com/equationalapplications/clanker/commit/e8ae7bd614723aeeadd3fe8a4f3990b600c1cbbe))
- update gitignore ([f536318](https://github.com/equationalapplications/clanker/commit/f53631818a5b61833c886f8c4f2f16584a7978c4))
- update gitignore ([88a2025](https://github.com/equationalapplications/clanker/commit/88a2025306f031593ef40da4071ec5eb8625d550))
- update RevenueCat Api naming ([c55d619](https://github.com/equationalapplications/clanker/commit/c55d6192569cce34a0576531b6cab525d6de25e2))
- update RootTabParamList ([0259d14](https://github.com/equationalapplications/clanker/commit/0259d14988495c20f33713cb8518331564abbebb))
- update state when character data changes ([2ca5920](https://github.com/equationalapplications/clanker/commit/2ca5920f78147038a465acc6d590a6878768b2d3))
- update title and icon ([dff20b6](https://github.com/equationalapplications/clanker/commit/dff20b648bb62ccda5ab49abc4d72d2a28ea9af6))
- updateCharacter during useEffect ([82650bf](https://github.com/equationalapplications/clanker/commit/82650bf456606059b2f7fa053a36eb9bb6966e12))
- use {uri: url} for avatar image source ([dab5deb](https://github.com/equationalapplications/clanker/commit/dab5deb4b93b5dae5ab6519022570ed35635ecae))
- use default TypeScript config ([9c9eaf8](https://github.com/equationalapplications/clanker/commit/9c9eaf860d7e2b81eaf24ad79147a04622342a0a))
- use defaultCharacter in the final array of useEffect ([a1dce36](https://github.com/equationalapplications/clanker/commit/a1dce36ee4ce83909727009e6f59e1038e571021))
- use expo doctor to update expo-linking ([9e6a814](https://github.com/equationalapplications/clanker/commit/9e6a81499f3a8651835db7738c5fddbda4c4e315))
- use fetch to get customerInfo on web ([7fb1658](https://github.com/equationalapplications/clanker/commit/7fb1658297f3c110d06f2cde167e55148a60dd33))
- use firebase signInWithCredential ([5812e3d](https://github.com/equationalapplications/clanker/commit/5812e3de7446e6fcd70609aeaeaf9a9819691b5e))
- use onChangeLoading Props for isLoading ([5161520](https://github.com/equationalapplications/clanker/commit/5161520b504daaff73eb6fdcf6d274150cebf681))
- use queryClient.clear() ([a681a83](https://github.com/equationalapplications/clanker/commit/a681a833b7db2594443c0ff3429da4adc4b807cf))
- use subscriber info instead of offerings for "web" ([bdbfbcf](https://github.com/equationalapplications/clanker/commit/bdbfbcf07ac1a56b9f97018ca362b648a2c26988))
- use Text from Paper for Styled Text ([d4e580a](https://github.com/equationalapplications/clanker/commit/d4e580afeceb1d3043ba37e26292313cf0f9a550))
- use useUser hook to get user ([013a340](https://github.com/equationalapplications/clanker/commit/013a3408c97b6bf3bb1e4c0e82f515de29c07826))
- use useUser to get user ([a712746](https://github.com/equationalapplications/clanker/commit/a7127460b24cf00a171368d5308163334d296d54))
- user interface remove "| null" for strings ([8d46bc3](https://github.com/equationalapplications/clanker/commit/8d46bc3fcc13696f4db235e2a53078b9b4cb2449))
- with the ?. optional properties added ([bb7c83c](https://github.com/equationalapplications/clanker/commit/bb7c83c63ce1423937714f7d1efd900b7707c73c))
- wrap app in QueryClientProvider ([d530ccd](https://github.com/equationalapplications/clanker/commit/d530ccd0e0250e42a3d4d83a34ffb8e716f30eb3))

### Build System

- npx expo install expo-secure-store ([e4bbfc9](https://github.com/equationalapplications/clanker/commit/e4bbfc90c62c482c054e22fbe429e032b69acafe))

### chore

- add new expo extra properties for Constants ([4f23d17](https://github.com/equationalapplications/clanker/commit/4f23d1726a941d9a8de34653f60f513b160f0163))

### Code Refactoring

- **expo 54 - google signin:** upgrade all packages and remove expo-auth-session ([8a55b92](https://github.com/equationalapplications/clanker/commit/8a55b9265706146f3a596fb4102bb767cfb067b8))
- **expo 54 - google signin:** upgrade all packages and remove expo-auth-session ([0330b04](https://github.com/equationalapplications/clanker/commit/0330b04eb7fd08fb9b2df3d6120c4e0b6781d901))
- **react router:** implement react router ([44c2ff3](https://github.com/equationalapplications/clanker/commit/44c2ff3a68abf6e36b7fb6f66072a873990da9b0))
- **react router:** implement react router ([0b43578](https://github.com/equationalapplications/clanker/commit/0b43578499faefe2a0dcbeb60b667cb2fb59f95a))

### Features

- add app icon ([69bf9bf](https://github.com/equationalapplications/clanker/commit/69bf9bfa2cdc297bc0af60da460c038c2816e205))
- add paywall screen with purchases ([5bf5698](https://github.com/equationalapplications/clanker/commit/5bf56985774d1804fac1d4a5d9618f5405907227))
- implement hybrid Firebase-Supabase authentication with multi-tenant RBAC ([a16ab19](https://github.com/equationalapplications/clanker/commit/a16ab19df6cc1f09a918b671b123d4fbbc4962eb))
- and many more...

### BREAKING CHANGES

- **react router:** install packages
- **expo 54 - google signin:** requires rebuild
- changes to app.config.ts require rebuild
- and many more...

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
