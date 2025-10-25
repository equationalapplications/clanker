# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# [14.0.0](https://github.com/equationalapplications/clanker/compare/v13.0.0...v14.0.0) (2025-10-25)

### Build System

-   Enable local builds with Firebase configs from environment variables ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))
-   Align EAS config with modern environment variables for cloud and local builds.
-   Update GitHub Actions workflows for `semantic-release`.

### Features

-   **Auth:** Align Firebase authentication with latest RNFirebase docs.
-   **Auth:** Implement unified logout flow (Supabase + Firebase + Google).

### BREAKING CHANGES

-   **Build:** Local builds now require `GOOGLE_SERVICES_JSON_BASE64` and `GOOGLE_SERVICE_INFO_PLIST_BASE64` to be set in a `.env` file.
-   **Auth:** The authentication flow has been updated, which may affect existing sessions.

# [13.0.0](https://github.com/equationalapplications/clanker/compare/v12.0.0...v13.0.0) (2025-10-25)

*This version was part of a branch restructuring and does not contain new features.*

# [12.0.0](https://github.com/equationalapplications/clanker/compare/v11.0.0...v12.0.0) (2025-10-19)

### Code Refactoring

-   remove RevenueCat and migrate fully to Stripe ([ca41fae](https://github.com/equationalapplications/clanker/commit/ca41fae7eb02c5b77424e011f637f3b7742abed0))

### BREAKING CHANGES

-   Remove RevenueCat integration, all subscriptions now use Stripe directly.

# [11.0.0](https://github.com/equationalapplications/clanker/compare/v10.0.0...v11.0.0) (2025-10-19)

### Bug Fixes

-   remove duplicate entries ([69dae6e](https://github.com/equationalapplications/clanker/commit/69dae6e1f5197455b108ef7aefd34d311c8c610c))
-   adapt login for navigation ([ab48679](https://github.com/equationalapplications/clanker/commit/ab4867976a67f89a5d92263b5fbee9e7ffba42a4))
-   add android intentFilter for facebook auth ([4f04dc7](https://github.com/equationalapplications/clanker/commit/4f04dc7570a2723db59f877fbdeb5bcfd7511524))
-   add character to state ([b7d009f](https://github.com/equationalapplications/clanker/commit/b7d009f421114db65edd0a7b08723982687ad96e))
-   add checks for null ([85f0f31](https://github.com/equationalapplications/clanker/commit/85f0f31f974f9e30bf82607a881614a62b8d1112))
-   add comma after prefix ([c7f0ae0](https://github.com/equationalapplications/clanker/commit/c7f0ae04e8442c3693fa60e6f481bc99a45de67a))
-   add default url for avatar ([ded70e9](https://github.com/equationalapplications/clanker/commit/ded70e96c8956d7f15900a4710c73749407e1495))
-   add facebook scheme ([2fef716](https://github.com/equationalapplications/clanker/commit/2fef716c09e9e44e51c9a305c87f492b3fd70614))
-   add id and userId to useEffect dep array ([ed1c9f1](https://github.com/equationalapplications/clanker/commit/ed1c9f18fabc8d75370f435ab75aa04682357182))
-   add key to navigation groups ([b2721aa](https://github.com/equationalapplications/clanker/commit/b2721aae5965db1c1f3d09c7429ea045589f1b53))
-   add linking for signin and paywall ([01c3be7](https://github.com/equationalapplications/clanker/commit/01c3be78aec8cea253b90aafdc1938b5390c1d39))
-   add navigate to signin ([26447f5](https://github.com/equationalapplications/clanker/commit/26447f5abaef5468d8a70cdb9f70f7822ddfdb2b))
-   add peer dependency for google auth ([f995e68](https://github.com/equationalapplications/clanker/commit/f995e682924a3197b674389806f59f680cdcad6a))
-   add question mark to customerInfo properties ([ca01384](https://github.com/equationalapplications/clanker/commit/ca01384bceb34013e2f45c4a120db9ab71a79414))
-   add state to TextInput to avoid jerky UI ([d729034](https://github.com/equationalapplications/clanker/commit/d72903481cc92b6d5cf013eaf2bd54562f990132))
-   add uid to useAuthUser key ([3d00a9b](https://github.com/equationalapplications/clanker/commit/3d00a9bade7f55a79c5348a65eecf3261a608210))
-   add uid to useAuthUser key ([05c9fda](https://github.com/equationalapplications/clanker/commit/05c9fda05227379bd56457c80fc3abfb220687a0))
-   add user to useEffect dependency array ([38a2a89](https://github.com/equationalapplications/clanker/commit/38a2a897167f53a1c77fe403879085ad89ca9a58))
-   **auth:** fix auth flow ([fc8542b](https://github.com/equationalapplications/clanker/commit/fc8542bc20be7d283f2405fb485be2ec85908d17))
-   **auth:** fix auth flow ([47ca474](https://github.com/equationalapplications/clanker/commit/47ca474c6ac663179ac89b747f5d8ebe30635317))
-   call hooks in function ([bf32eb2](https://github.com/equationalapplications/clanker/commit/bf32eb218486ab71fb808f5771e8944bd7851c64))
-   check ( credits <= 0 && !isPremium ) ([d7b710a](https://github.com/equationalapplications/clanker/commit/d7b710aaf43c37d117accac836f5773b613a83db))
-   check if refetch is null in useEffect ([cd224dd](https://github.com/equationalapplications/clanker/commit/cd224dd39bc8bb4c8b3163cbab9957cf4227d4c0))
-   combine colors properly for display on Andoid ([45c08fe](https://github.com/equationalapplications/clanker/commit/45c08fefa06115bd1b4e44dcfc0d6902a35b7edb))
-   compare with uid ([e00def4](https://github.com/equationalapplications/clanker/commit/e00def4961b453aa88cc88368ddd5ee5cf39ce69))
-   correct display name ([7f003ce](https://github.com/equationalapplications/clanker/commit/7f003ce8ce75d2b60a83b5db7f144ed2fd25f967))
-   correct object shape of colorsDark ([0167a2c](https://github.com/equationalapplications/clanker/commit/0167a2c208c4babbc3519b6a80f7981796615c2b))
-   correct the collection path ([f84d948](https://github.com/equationalapplications/clanker/commit/f84d948157e7f5343fec11a4783307367f2a1ef0))
-   correct user_characters ([c21f40f](https://github.com/equationalapplications/clanker/commit/c21f40f42d19c7d449b57f6e834469304ae50f6d))
-   correct variable names ([5852c8c](https://github.com/equationalapplications/clanker/commit/5852c8cdd351e8a8fc1fb712ab3b3079eb23f99f))
-   do not remove createdAt ([b627c3e](https://github.com/equationalapplications/clanker/commit/b627c3e2992727ce8ce1b29fa38f10d044df7694))
-   **fics:** fixs chat ([135b001](https://github.com/equationalapplications/clanker/commit/135b001f833b9deecdede083cb4d2a58523d8f66))
-   **fics:** fixs chat ([00702dc](https://github.com/equationalapplications/clanker/commit/00702dc9b0dd4faab77d7232918f54209324a3da))
-   fix accept term ([054bb29](https://github.com/equationalapplications/clanker/commit/054bb29d752afa159d9256298ae68559f6a5b38c))
-   fix accept term ([1500daf](https://github.com/equationalapplications/clanker/commit/1500daf8fa2a7c2691ae8f62e42b6b4973407805))
-   fix accept terms ([bdcb6f4](https://github.com/equationalapplications/clanker/commit/bdcb6f420e713811fe2b729c14182d14da98e9e5))
-   fix accept terms ([cd865c1](https://github.com/equationalapplications/clanker/commit/cd865c1dc8c2243cfaa55a9e2bda6d99c93e7fa5))
-   fix android google signin ([43c354d](https://github.com/equationalapplications/clanker/commit/43c354dea27b68b7fd4d2f9984034d75b2829957))
-   fix auth flow ([2a23a86](https://github.com/equationalapplications/clanker/commit/2a23a8692af2b11e6d01db619c87d16ba209a2c3))
-   fix auth flow ([fca8b4d](https://github.com/equationalapplications/clanker/commit/fca8b4d453f811269df9e8b63e83caeab8b535c6))
-   fix charachters navigation ([58a2692](https://github.com/equationalapplications/clanker/commit/58a2692ac54f6e428fbe10b0805125f372c5595a))
-   fix charachters navigation ([5a6d82b](https://github.com/equationalapplications/clanker/commit/5a6d82b516feb1cbef26f62ee775f69975a4e90e))
-   fix expo deps ([ace4e7a](https://github.com/equationalapplications/clanker/commit/ace4e7a330200be8f95411ccc760efb57af3b52c))
-   fix expo deps ([32d1a78](https://github.com/equationalapplications/clanker/commit/32d1a78301d55b12e2f9525e78931bba95fdf4a4))
-   fix imports. update packages ([973d134](https://github.com/equationalapplications/clanker/commit/973d134f5c84041dd45a7c1027ee59673221edd3))
-   fix nav ([b0b3723](https://github.com/equationalapplications/clanker/commit/b0b3723e61ad59f14e4e4b7920e8ad117a31e6a9))
-   fix nav ([c4789bf](https://github.com/equationalapplications/clanker/commit/c4789bffbba88a5a911ee4f8ae3d2ed590e60097))
-   fix navigation ([1648e1b](https://github.com/equationalapplications/clanker/commit/1648e1b82b3d4f532919c44fc294bb68e77f7515))
-   fix navigation ([ceeb6be](https://github.com/equationalapplications/clanker/commit/ceeb6bea2b61c5bfc93d9b45bbac9c9bd3c4125e))
-   fix web auth ([a25b6b5](https://github.com/equationalapplications/clanker/commit/a25b6b52540907ee1a1ba23529ddf4acae645fbe))
-   gitignore ([0350b7d](https://github.com/equationalapplications/clanker/commit/0350b7df4701d83d8a16ac6ea4818d9e56d43f5d))
-   id and userId null default ([a77d78c](https://github.com/equationalapplications/clanker/commit/a77d78c44a18841e7c2e7e17c88ccf48dea0d8cd))
-   imageIsLoading ([8062d77](https://github.com/equationalapplications/clanker/commit/8062d770121165923ae2f9bdfd7454563edb7d3e))
-   implement updateDoc ([aac9449](https://github.com/equationalapplications/clanker/commit/aac9449b7b3d3aeb4015dbe903b6e2ccb6d2af10))
-   import expo-random ([4ee6044](https://github.com/equationalapplications/clanker/commit/4ee6044212fc49f6d230ba763f5806b8feffb8ea))
-   invalidateQueries("isPremium") after purchase ([3626799](https://github.com/equationalapplications/clanker/commit/36267997bc9d5ef46d01ee47c17e90d4e3eeef53))
-   ios build ([5ce2067](https://github.com/equationalapplications/clanker/commit/5ce2067d0a1c40786c1a76698a92b79ec1ec4784))
-   isEraseModal intially false ([3ee5b15](https://github.com/equationalapplications/clanker/commit/3ee5b15894a13c1d12aaf4e3706c1df1cea40494))
-   make SignIn the initial route ([9394198](https://github.com/equationalapplications/clanker/commit/9394198ef959ea43e1851a51cc7b0b5430b0b029))
-   nav ([09e75f6](https://github.com/equationalapplications/clanker/commit/09e75f68f5e310e012419539fc276f6d1d267d65))
-   nav ([25ef2d1](https://github.com/equationalapplications/clanker/commit/25ef2d1149cdbf27ec56c76bccd4619a747e1dca))
-   navigate with navigation.getParent() ([e89e587](https://github.com/equationalapplications/clanker/commit/e89e587d7fa6e25c9aa85cf4142082b5925d07da))
-   null collesssing ([27f3de8](https://github.com/equationalapplications/clanker/commit/27f3de883152a47b02eeb4600abc1768b9bc599f))
-   onConfirmDeleteAccount order of functions ([0690dfa](https://github.com/equationalapplications/clanker/commit/0690dfa2ac107f28f7a0cd19a68a847ef4e8ac1d))
-   onPressSignOut queryClient.clear() ([de14697](https://github.com/equationalapplications/clanker/commit/de146976c1a4237307f559355729b999efe75936))
-   persist auth ([2a37cb7](https://github.com/equationalapplications/clanker/commit/2a37cb75ff75f6680a9e2d098d62ddc81aa095ff))
-   persist auth ([4ef542d](https://github.com/equationalapplications/clanker/commit/4ef542da18d1910e05af73d49df48edcc8384685))
-   profiles, characters, messages ([dddf85f](https://github.com/equationalapplications/clanker/commit/dddf85fb72dfd29c2d1eb7cf77ca7ef6afabea88))
-   profiles, characters, messages ([62ad0d6](https://github.com/equationalapplications/clanker/commit/62ad0d6d11d03ebea8fbfc7212fbcb628e4919ca))
-   remove auth loading state. format 2 space indentation ([bfa3543](https://github.com/equationalapplications/clanker/commit/bfa35435df1f38df955ce53fd10e13c016ea8f9c))
-   remove auth loading state. format 2 space indentation ([15f7753](https://github.com/equationalapplications/clanker/commit/15f77534fa878383c2fb00d1b825678d85b4b198))
-   remove duplicate key ([fdcccdd](https://github.com/equationalapplications/clanker/commit/fdcccddb6c2873277d7568babdf5800dddb32bb5))
-   remove firestore ([bf96200](https://github.com/equationalapplications/clanker/commit/bf96200a0ffafd554e3e6d02e9b9135827f20e74))
-   remove firestore ([6bc7f59](https://github.com/equationalapplications/clanker/commit/6bc7f5940f312f350152fd1f95a6e488bcbb8f4b))
-   remove incorrect expo-build-properties ([132ccfc](https://github.com/equationalapplications/clanker/commit/132ccfca3117a824ba8842c2c57448f1a93eeacf))
-   remove invalidateQueries ([d666bc6](https://github.com/equationalapplications/clanker/commit/d666bc642c81854a37241816d8711fe896faea41))
-   remove navigation in useEffect for user changes ([184a5c0](https://github.com/equationalapplications/clanker/commit/184a5c05199469f25a0b4e830d68ba9571bb9a4b))
-   remove optimistic update ([fd4d728](https://github.com/equationalapplications/clanker/commit/fd4d728167e696935246c879a17664ab138288ed))
-   remove setUser. replace with return null ([1763ed0](https://github.com/equationalapplications/clanker/commit/1763ed0ea0a618e8de076af67fc4134b06810026))
-   remove unneeded createaccount screen ([f877e55](https://github.com/equationalapplications/clanker/commit/f877e556824d7417f8eb2375ec88bb1f9a0dfe55))
-   retry: 3, staleTime: 1 hour ([1fce836](https://github.com/equationalapplications/clanker/commit/1fce8368da7b3fee9eba563a3a9708028ac44c98))
-   return data ([6049b4f](https://github.com/equationalapplications/clanker/commit/6049b4fa8bd4deaee9fb43dbb72514d0398be0a0))
-   roll back EAS changes ([bdf0918](https://github.com/equationalapplications/clanker/commit/bdf09186971170297a9b1ceb344920d84febf0bb))
-   roll back expo-linking ([8eb7cb2](https://github.com/equationalapplications/clanker/commit/8eb7cb2ffd7ed83be8eceda3bc2e66c549bbfd0e))
-   roll back to default file ([db66554](https://github.com/equationalapplications/clanker/commit/db66554f6b6a8f611bbf5d26228107f0d7cafef6))
-   scale adaptive-icon to 512 x 512 ([69f6ca1](https://github.com/equationalapplications/clanker/commit/69f6ca104be165bb2957f0fdc0d2261fee7196b4))
-   scale image layer to fit ([d6651ab](https://github.com/equationalapplications/clanker/commit/d6651abf98997a3b2ab91417e6c391e9fe0165a3))
-   scheme remove array ([889d8a4](https://github.com/equationalapplications/clanker/commit/889d8a47a5b2e3acb8425468143b8a4b0037709e))
-   scrollview style ([28f10d4](https://github.com/equationalapplications/clanker/commit/28f10d4eeb0f5748394bba76610a3b6f0c3c1bfb))
-   scrollview style ([c09e58d](https://github.com/equationalapplications/clanker/commit/c09e58d16bef3e7d3ab686de43fd636bd84cf0c4))
-   show indicator then sign out when deleting user ([ee46cd9](https://github.com/equationalapplications/clanker/commit/ee46cd9ca7dd749718fdfe0300fbbac226ea4596))
-   show loading indicator conditions ([7c4c692](https://github.com/equationalapplications/clanker/commit/7c4c69206e710b30cb21a1b68935e97840fcde46))
-   sort and then remove createdAt ([14490f1](https://github.com/equationalapplications/clanker/commit/14490f122c63d9ca2459b95eaaa12c0ad24d57a8))
-   sort messages by createAt ([af4039a](https://github.com/equationalapplications/clanker/commit/af4039ae273dc01585d7d8948fc6015fc5ebed2b))
-   subscribe to firestore messages ([cf9034c](https://github.com/equationalapplications/clanker/commit/cf9034c63fd77c7dac2822c20a6a968a392d37fb))
-   **supabase:** fix supabase login ([9d9661f](https://github.com/equationalapplications/clanker/commit/9d9661f43a70f5f51d87959867d21a1cbac41d32))
-   **supabase:** fix supabase login ([5c6097f](https://github.com/equationalapplications/clanker/commit/5c6097f0b76398bfb136e6c9cdcb398010052116))
-   temp disable billing button ([193b2dd](https://github.com/equationalapplications/clanker/commit/193b2ddb26d68805cec7fa2e9659d8b2d2c38814))
-   **terms:** accpet terms ([1c24548](https://github.com/equationalapplications/clanker/commit/1c245482abb2fb76c2f5c529bcb8a00c7b70a6d1))
-   **terms:** accpet terms ([e692661](https://github.com/equationalapplications/clanker/commit/e692661f0308cb0335228e434c8322df8531e46d))
-   the last commit changed metro config ([eed31b5](https://github.com/equationalapplications/clanker/commit/eed31b5d94961b498a4076bf96d989c922bb6184))
-   **types:** small focused tsc fixes ([1b923e2](https://github.com/equationalapplications/clanker/commit/1b923e23ecea8ff128e6e3279e9b87d4e6d05e3d))
-   **types:** small focused tsc fixes ([a2151f5](https://github.com/equationalapplications/clanker/commit/a2151f5edae7e1c475183452c5385c2ac0aeb113))
-   typo ([e8ae7bd](https://github.com/equationalapplications/clanker/commit/e8ae7bd614723aeeadd3fe8a4f3990b600c1cbbe))
-   update gitignore ([f536318](https://github.com/equationalapplications/clanker/commit/f53631818a5b61833c886f8c4f2f16584a7978c4))
-   update gitignore ([88a2025](https://github.com/equationalapplications/clanker/commit/88a2025306f031593ef40da4071ec5eb8625d550))
-   update RevenueCat Api naming ([c55d619](https://github.com/equationalapplications/clanker/commit/c55d6192569cce34a0576531b6cab525d6de25e2))
-   update RootTabParamList ([0259d14](https://github.com/equationalapplications/clanker/commit/0259d14988495c20f33713cb8518331564abbebb))
-   update state when character data changes ([2ca5920](https://github.com/equationalapplications/clanker/commit/2ca5920f78147038a465acc6d590a6878768b2d3))
-   update title and icon ([dff20b6](https://github.com/equationalapplications/clanker/commit/dff20b648bb62ccda5ab49abc4d72d2a28ea9af6))
-   updateCharacter during useEffect ([82650bf](https://github.com/equationalapplications/clanker/commit/82650bf456606059b2f7fa053a36eb9bb6966e12))
-   use {uri: url} for avatar image source ([dab5deb](https://github.com/equationalapplications/clanker/commit/dab5deb4b93b5dae5ab6519022570ed35635ecae))
-   use default TypeScript config ([9c9eaf8](https://github.com/equationalapplications/clanker/commit/9c9eaf860d7e2b81eaf24ad79147a04622342a0a))
-   use defaultCharacter in the final array of useEffect ([a1dce36](https://github.com/equationalapplications/clanker/commit/a1dce36ee4ce83909727009e6f59e1038e571021))
-   use expo doctor to update expo-linking ([9e6a814](https://github.com/equationalapplications/clanker/commit/9e6a81499f3a8651835db7738c5fddbda4c4e315))
-   use fetch to get customerInfo on web ([7fb1658](https://github.com/equationalapplications/clanker/commit/7fb1658297f3c110d06f2cde167e55148a60dd33))
-   use firebase signInWithCredential ([5812e3d](https://github.com/equationalapplications/clanker/commit/5812e3de7446e6fcd70609aeaeaf9a9819691b5e))
-   use onChangeLoading Props for isLoading ([5161520](https://github.com/equationalapplications/clanker/commit/5161520b504daaff73eb6fdcf6d274150cebf681))
-   use queryClient.clear() ([a681a83](https://github.com/equationalapplications/clanker/commit/a681a833b7db2594443c0ff3429da4adc4b807cf))
-   use subscriber info instead of offerings for "web" ([bdbfbcf](https://github.com/equationalapplications/clanker/commit/bdbfbcf07ac1a56b9f97018ca362b648a2c26988))
-   use Text from Paper for Styled Text ([d4e580a](https://github.com/equationalapplications/clanker/commit/d4e580afeceb1d3043ba37e26292313cf0f9a550))
-   use useUser hook to get user ([013a340](https://github.com/equationalapplications/clanker/commit/013a3408c97b6bf3bb1e4c0e82f515de29c07826))
-   use useUser to get user ([a712746](https://github.com/equationalapplications/clanker/commit/a7127460b24cf00a171368d5308163334d296d54))
-   user interface remove "| null" for strings ([8d46bc3](https://github.com/equationalapplications/clanker/commit/8d46bc3fcc13696f4db235e2a53078b9b4cb2449))
-   with the ?. optional properties added ([bb7c83c](https://github.com/equationalapplications/clanker/commit/bb7c83c63ce1423937714f7d1efd900b7707c73c))
-   wrap app in QueryClientProvider ([d530ccd](https://github.com/equationalapplications/clanker/commit/d530ccd0e0250e42a3d4d83a34ffb8e716f30eb3))

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

-   add app icon ([69bf9bf](https://github.com/equationalapplications/clanker/commit/69bf9bfa2cdc297bc0af60da460c038c2816e205))
-   add paywall screen with purchases ([5bf5698](https://github.com/equationalapplications/clanker/commit/5bf56985774d1804fac1d4a5d9618f5405907227))
-   implement hybrid Firebase-Supabase authentication with multi-tenant RBAC ([a16ab19](https://github.com/equationalapplications/clanker/commit/a16ab19df6cc1f09a918b671b123d4fbbc4962eb))
-   and many more...

### BREAKING CHANGES

-   **react router:** install packages
-   **expo 54 - google signin:** requires rebuild
-   changes to app.config.ts require rebuild
-   and many more...
