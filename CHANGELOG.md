# [14.0.0](https://github.com/equationalapplications/clanker/compare/v13.0.0...v14.0.0) (2025-10-25)


### chore

* **release:** promote staging to production v14.0.0 ([#158](https://github.com/equationalapplications/clanker/issues/158)) ([52ca686](https://github.com/equationalapplications/clanker/commit/52ca68631ff865b8f475f91000a2f9d819b2b60d)), closes [#154](https://github.com/equationalapplications/clanker/issues/154) [#157](https://github.com/equationalapplications/clanker/issues/157)


### BREAKING CHANGES

* **release:** Updated expo.
* **release:** Updated expo.

* chore(release): set `package.json` to 13.0.0-staging.1 [skip ci]

# [13.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v12.0.0...v13.0.0-staging.1) (2025-10-25)

### Build System

* enable local builds ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))

### BREAKING CHANGES

* Updated expo.

* build: eas build fixes

align EAS config with modern environment variables

Updates eas.json and Firebase documentation to
use EAS Environment Variables for cloud builds, replacing the legacy `secrets.file` method.

-
Removes `secrets.file` from all build profiles in `eas.json`.
- Adds the `environment` key to all
build profiles for clarity.
- Updates `docs/FIREBASE_SETUP.md` to detail the new, separate
workflows for cloud builds (using `eas env:create`) and local builds (using base64 strings in
`.env`).

This aligns the project with the latest Expo recommendations for managing secrets and
build environments

* build: fix build using google services

* ci: release bumps version on staging and main

* chore(release): set `package.json` to 14.0.0-staging.1 [skip ci]

# [14.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v13.0.0...v14.0.0-staging.1) (2025-10-25)

### Build System

* enable local builds ([143e059](https://github.com/equationalapplications/clanker/commit/143e0592b67c41509cebf290f0775ba7715e2394))
* enable local builds ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))
* merge dev into staging ([12cd4ad](https://github.com/equationalapplications/clanker/commit/12cd4ad92a7323433eb5463832f6806612bab07a))

### BREAKING CHANGES

* Firebase configuration now requires environment variables
* Updated expo.
* Updated expo.

# [14.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v13.0.0...v14.0.0-staging.1) (2025-10-25)


### Build System

* enable local builds ([143e059](https://github.com/equationalapplications/clanker/commit/143e0592b67c41509cebf290f0775ba7715e2394))
* enable local builds ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))
* merge dev into staging ([12cd4ad](https://github.com/equationalapplications/clanker/commit/12cd4ad92a7323433eb5463832f6806612bab07a))


### BREAKING CHANGES

* Firebase configuration now requires environment variables
* Updated expo.
* Updated expo.

# [13.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v12.0.0...v13.0.0-staging.1) (2025-10-25)

### Build System

- enable local builds ([#154](https://github.com/equationalapplications/clanker/issues/154)) ([3f96559](https://github.com/equationalapplications/clanker/commit/3f965591eb4f256a9c242680aa89868fe08236e4))

### BREAKING CHANGES

- Updated expo.

# [12.0.0](https://github.com/equationalapplications/clanker/compare/v11.0.0...v12.0.0) (2025-10-19)

- Dev ([#150](https://github.com/equationalapplications/clanker/issues/150)) ([3e80ec3](https://github.com/equationalapplications/clanker/commit/3e80ec369e51ff9484c14d98a35fafdec3b7e300))
- Dev ([#151](https://github.com/equationalapplications/clanker/issues/151)) ([11c874c](https://github.com/equationalapplications/clanker/commit/11c874c6a8c5381c937229d7bf88d996b02d2414))

### Code Refactoring

- remove RevenueCat and migrate fully to Stripe ([ca41fae](https://github.com/equationalapplications/clanker/commit/ca41fae7eb02c5b77424e011f637f3b7742abed0))

### BREAKING CHANGES

- Remove RevenueCat integration, all subscriptions now use Stripe directly

- ci: use PAT for semantic-release on staging branch

* Add GH_PAT token to checkout step to enable bypass of branch protection
* Configure semantic-release to use GH_PAT for pushing version commits
* Add git author/committer config for semantic-release bot
* Matches the production workflow configuration

- Remove RevenueCat integration, all subscriptions now use Stripe directly
- Remove RevenueCat integration, all subscriptions now use Stripe directly

# [11.0.0-staging.2](https://github.com/equationalapplications/clanker/compare/v11.0.0-staging.1...v11.0.0-staging.2) (2025-10-19)

### Code Refactoring

- remove RevenueCat and migrate fully to Stripe ([ca41fae](https://github.com/equationalapplications/clanker/commit/ca41fae7eb02c5b77424e011f637f3b7742abed0))

### BREAKING CHANGES

- Remove RevenueCat integration, all subscriptions now use Stripe directly

# [11.0.0-staging.1](https://github.com/equationalapplications/clanker/compare/v10.0.0...v11.0.0-staging.1) (2025-10-19)

- Dev ([#150](https://github.com/equationalapplications/clanker/issues/150)) ([3e80ec3](https://github.com/equationalapplications/clanker/commit/3e80ec369e51ff9484c14d98a35fafdec3b7e300))
- Dev ([#151](https://github.com/equationalapplications/clanker/issues/151)) ([11c874c](https://github.com/equationalapplications/clanker/commit/11c874c6a8c5381c937229d7bf88d996b02d2414))

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

- add android intentFilters ([5ad2f52](https://github.com/equationalapplications/clanker/commit/5ad2f525b8bb73cc08c1f234f54892b1609cd0a1))
- add app icon ([69bf9bf](https://github.com/equationalapplications/clanker/commit/69bf9bfa2cdc297bc0af60da460c038c2816e205))
- add appChatUrl ([a4a9784](https://github.com/equationalapplications/clanker/commit/a4a9784ecc2afe15b6fdfab85c9d221c76c77f7a))
- add Avatar and name to top of chat ([0dc859d](https://github.com/equationalapplications/clanker/commit/0dc859d17c1a507b3b64525c7f52f8494b91b82a))
- add billing button ([6f90040](https://github.com/equationalapplications/clanker/commit/6f90040a8cd19772429f48af38d3593ad0d0c51d))
- add Button component from paper login template ([ef0da4b](https://github.com/equationalapplications/clanker/commit/ef0da4ba45b7c7524aa6914700927aef2c9b037f))
- add callstack login template ([ff484f6](https://github.com/equationalapplications/clanker/commit/ff484f6dd4e72898b82a763adfc51e54be7cab1a))
- add const scheme ([cf56486](https://github.com/equationalapplications/clanker/commit/cf56486cace71032a184cb7dc4380c2c18e759ad))
- add constant from env for googleIosClientId ([604c352](https://github.com/equationalapplications/clanker/commit/604c352750084e29edb3d0f588d1f6e9c962c80d))
- add constant googleIosClientId ([c231bfe](https://github.com/equationalapplications/clanker/commit/c231bfe11f710f021aadb8ec58da53162760b5f3))
- add default avatar url ([1c01d4b](https://github.com/equationalapplications/clanker/commit/1c01d4b574a240d2083a4c6ca417f7d287881b3a))
- add deps for login and redux ([c5e34bf](https://github.com/equationalapplications/clanker/commit/c5e34bf521e4d2acb27b862bb7f51c308269e4e3))
- add disabled prop ([3051425](https://github.com/equationalapplications/clanker/commit/30514259dd6b9e8b3625844f8e7771fb02070e71))
- add erase memory ([9c16ce9](https://github.com/equationalapplications/clanker/commit/9c16ce905ed3e07f86d88afe5b56058e6c42020b))
- add ErrorBoundary ([92a960c](https://github.com/equationalapplications/clanker/commit/92a960c19fc7d492510aa781b0f7e9e98cd422f5))
- add eslint and prettier ([e418564](https://github.com/equationalapplications/clanker/commit/e41856421af2e228c217c8ea06f5ab6b214158f1))
- add expo-dev-client ([b850585](https://github.com/equationalapplications/clanker/commit/b850585a9ef3df76b597f4d66ce28a918970f741))
- add facebook login button ([53b9da4](https://github.com/equationalapplications/clanker/commit/53b9da477ba0635f7610a90f08855461986b0492))
- add firebase collection strings to extra: ([3ec415e](https://github.com/equationalapplications/clanker/commit/3ec415eccb95fad311794d0c9e87055ee5dfc768))
- add firebase libraries ([4b98629](https://github.com/equationalapplications/clanker/commit/4b986290434e5c63bf2ea7d8abf47d5d0d29106e))
- add get image button ([331b4e3](https://github.com/equationalapplications/clanker/commit/331b4e3fb19da3ebc525347308baa115360306b7))
- add gifted chat ([d8f55a1](https://github.com/equationalapplications/clanker/commit/d8f55a12e3cb74dbe1489cbb82eb82d1b1694a60))
- add golden color scheme ([6a72b30](https://github.com/equationalapplications/clanker/commit/6a72b300962b10ede2406ef8ffa6ee2dead6c35e))
- add google services files for android and ios ([e374c3b](https://github.com/equationalapplications/clanker/commit/e374c3bbf09ba3cdb5932b8e634956b0aa933d05))
- add GoogleAuthProvider ([d9d1384](https://github.com/equationalapplications/clanker/commit/d9d138458eca7ee0ae335d0b82161baf8f155604))
- add linking paths for tab screens ([8265f4f](https://github.com/equationalapplications/clanker/commit/8265f4f66ff9af2245ef768ecca9d790e317129c))
- add loading indicator for image ([384623c](https://github.com/equationalapplications/clanker/commit/384623c08eaf4f18abd9367118bc7bf59640d61b))
- add Logo component. display on SignIn ([ca0eaa4](https://github.com/equationalapplications/clanker/commit/ca0eaa465fafc356195f68da6142a86398907bab))
- add mulitline TextInput ([9df6d8b](https://github.com/equationalapplications/clanker/commit/9df6d8b2e7f5bedb8cda6aa135b823dcad481c6c))
- add multiline 3 ([66f76bd](https://github.com/equationalapplications/clanker/commit/66f76bda72251bedfd7de8246099d76746d15667))
- add navigation state persistance ([e825311](https://github.com/equationalapplications/clanker/commit/e825311398f6c02c7c0d80c776912cef892425fb))
- add openai function ([4d7e592](https://github.com/equationalapplications/clanker/commit/4d7e592e58658999dd33063956964790d33281f6))
- add paywall screen with purchases ([5bf5698](https://github.com/equationalapplications/clanker/commit/5bf56985774d1804fac1d4a5d9618f5405907227))
- add protected navigation routes ([15cc5b1](https://github.com/equationalapplications/clanker/commit/15cc5b1847a7135a7d5e2e1ee226966043127771))
- add PurchasesProvider.tsx ([5692ee0](https://github.com/equationalapplications/clanker/commit/5692ee087ee6aa529c3c87c048274944c5169e7d))
- add PurchaseSuccess screen ([f8457dd](https://github.com/equationalapplications/clanker/commit/f8457dda2c80fd3047648df1179a8d073752a159))
- add react navigation and deps ([801ba04](https://github.com/equationalapplications/clanker/commit/801ba04cc30d9d1b0a8cda50433f14e374f72028))
- add react query firebase ([a18d37b](https://github.com/equationalapplications/clanker/commit/a18d37bc4984fa10cef075b6830c95120fc1f18e))
- add react-native-fbsdk-next ([59f1d58](https://github.com/equationalapplications/clanker/commit/59f1d58180538df8b0ee336a38615b00860df571))
- add revenueCatSubscribers to constants ([13a1b21](https://github.com/equationalapplications/clanker/commit/13a1b215d1fd5dbd768e9f9e455138ed10df1dd6))
- add root navigator ([f54b064](https://github.com/equationalapplications/clanker/commit/f54b0642e3e8186029d708bc00e911f669ea2769))
- add setDefaultCharacter function ([f2f4242](https://github.com/equationalapplications/clanker/commit/f2f424219f76d2bf1fba29f9217bb022bd1059ac))
- add signin with FacebookAuthProvider ([bdeab7c](https://github.com/equationalapplications/clanker/commit/bdeab7c37e2c58bc3ff0ca5ad00fdce93bdb7f53))
- add styling to chat ([cefcc92](https://github.com/equationalapplications/clanker/commit/cefcc920190d3022c3a4e41342ea9ff84876b43e))
- add support for web ([fc51c36](https://github.com/equationalapplications/clanker/commit/fc51c36ced9e0d17efe7eb23580bc6facbc852aa))
- add Terms and Conditions and Privacy Policy ([1c9b97c](https://github.com/equationalapplications/clanker/commit/1c9b97ca6a1db668ef80a5209fc754c596d0a981))
- add type interface for the REST API ([cbd3bdc](https://github.com/equationalapplications/clanker/commit/cbd3bdcb12d18e989de6378f915f4b989de5ad5f))
- can edit character ([80a9e45](https://github.com/equationalapplications/clanker/commit/80a9e450ad38bc61a8df42b38c3f62a4d584dc96))
- conditionally show SubscriptionBillingInfoButton or Subscribe button ([6d0fe73](https://github.com/equationalapplications/clanker/commit/6d0fe7352fc09a341f8d3c6f21672b35484a7808))
- creat SubscriptionBillingInfoButton ([0a9db12](https://github.com/equationalapplications/clanker/commit/0a9db12c3a7ae22c8ec3f7e0282e248c1a0f6550))
- create AcceptTerms component ([ebc31df](https://github.com/equationalapplications/clanker/commit/ebc31dfda6ea45208d67c692683d726a0ca60386))
- create AcceptTerms screen ([d998d2a](https://github.com/equationalapplications/clanker/commit/d998d2a6403e1065892dbfb3a7df64d15ad1eee8))
- create AcceptTerms Screen ([fb0aa6d](https://github.com/equationalapplications/clanker/commit/fb0aa6d08d953ffdbac365278533dbb9a07bf5b6))
- create CharacterStackNavigator ([666a3ca](https://github.com/equationalapplications/clanker/commit/666a3ca2db4664c3e4d15817130b1f2b96f20395))
- create ConfirmationModal component ([9a97dea](https://github.com/equationalapplications/clanker/commit/9a97dea4eeb50b84fe9aed32a236fe90cf4dd290))
- create createNewCharacter function ([d607b0b](https://github.com/equationalapplications/clanker/commit/d607b0b3b5c99318616fcc380e626085194cdc4f))
- create EditCharacter screen ([e973076](https://github.com/equationalapplications/clanker/commit/e973076905f3197ac4f6e6b22a9a514c0d21953e))
- create FAB button to add new character ([f1ad549](https://github.com/equationalapplications/clanker/commit/f1ad549b35a9a62f4e7a3745a6b9d6db673496f4))
- create getIsPremium function ([d149a47](https://github.com/equationalapplications/clanker/commit/d149a472b0b94af95a9baa59d7e511dda7de9a21))
- create makePackaePurchase utilty function ([e7bedc3](https://github.com/equationalapplications/clanker/commit/e7bedc3842abc312019bb2a1d7cd9952d0aa08cb))
- create multi-character chat ([6e2caf7](https://github.com/equationalapplications/clanker/commit/6e2caf7f12f970a3df88de91705aa53947d56718))
- create postStripeReceipt function ([e50723d](https://github.com/equationalapplications/clanker/commit/e50723ddc0f466cd97c2797f2e821b87eeefe8f5))
- create reusable deleteUser function ([d92f4e4](https://github.com/equationalapplications/clanker/commit/d92f4e43bc5db26a9b60647bf7d1dc13be5eef42))
- create reusable deleteUser function ([eb0058a](https://github.com/equationalapplications/clanker/commit/eb0058a6d645e68706ee07525a7026b4dcc02b85))
- create secureStore utility ([df36020](https://github.com/equationalapplications/clanker/commit/df36020946c513da41d4e88849f33f9b36800873))
- create setIsPremium utility function to use firebase function ([a00633c](https://github.com/equationalapplications/clanker/commit/a00633c22f2378d23c9a05ab293e0b87dad5b31e))
- create ShareCharacterButton ([291688c](https://github.com/equationalapplications/clanker/commit/291688cbcfda24e69bdf3164ba035da5e75d6b13))
- create styled LoadingIndicator ([b6173c2](https://github.com/equationalapplications/clanker/commit/b6173c2356cc5643501357fdebf32fa08d4b3c75))
- create TitleText component. add it to SignIn ([cb27e6b](https://github.com/equationalapplications/clanker/commit/cb27e6b63ab905c7dac88fe1ce22a7adc1789160))
- create updateIsPremium to optimistically update isPremium ([68935e1](https://github.com/equationalapplications/clanker/commit/68935e14d1cc1f9ff99800b38fc1719a39e1379e))
- create updateMessages function ([4196cf8](https://github.com/equationalapplications/clanker/commit/4196cf83b0ea5a1fe00f32a1fb1fb0ba1231e39f))
- create useCharacter hook ([5c4070b](https://github.com/equationalapplications/clanker/commit/5c4070bfa49eef9b52f3029ba5c3336ea8dc2ab2))
- create useCharacterlist hook ([c547d6f](https://github.com/equationalapplications/clanker/commit/c547d6f5dfea5c0495e2eb723586aa0abdbdb798))
- create useCustomerInfo hook ([18bd616](https://github.com/equationalapplications/clanker/commit/18bd6166e1046f1ebc734008bb50771c897bc04a))
- create useDefaultCharacter hook ([737e927](https://github.com/equationalapplications/clanker/commit/737e927b83a343c7a48dc2b5da307e8a43d6d2f3))
- create useIsPremium hook ([df1f271](https://github.com/equationalapplications/clanker/commit/df1f271419cb39439c6a5b2263b5e5684833d56b))
- create useMessages hook ([f0fb58c](https://github.com/equationalapplications/clanker/commit/f0fb58c06847019a1c09dab8efe36a4857e74506))
- create usePostStripeReceipt hook ([fc63c23](https://github.com/equationalapplications/clanker/commit/fc63c23e9ea9a05f03e596631c09480f35a7f04f))
- create usePurchasesOfferings hook ([9e84075](https://github.com/equationalapplications/clanker/commit/9e84075bd48c2df96c47097a02ca72f447c68b0a))
- create useUser hook ([fc93bb5](https://github.com/equationalapplications/clanker/commit/fc93bb5b6428906238884b3f5dc6dfd3af43a205))
- create useUserPublic hook ([85899d1](https://github.com/equationalapplications/clanker/commit/85899d11445ce51685555a19c7e41995cd1fa4dd))
- create useUserPublic hook ([0ad9d9c](https://github.com/equationalapplications/clanker/commit/0ad9d9cf7c4a605215c0eb4a2fbc19c1887321ad))
- disable provider login buttons until request ready ([31c7742](https://github.com/equationalapplications/clanker/commit/31c7742959f9b67bb8e78a51a4e43ca708da3ff4))
- display credits on subscribe page ([a3f97a2](https://github.com/equationalapplications/clanker/commit/a3f97a295ac506bf36d93e2c7ead4257633b32bf))
- display credits on subscribe page ([759d7f3](https://github.com/equationalapplications/clanker/commit/759d7f36ebcd3ed5b30a30a160d662ca28df1967))
- display list of buttons for characters ([b786d9a](https://github.com/equationalapplications/clanker/commit/b786d9a9968683ba190f3eaef3e4794665d8fc92))
- display path that was not found ([cf5671c](https://github.com/equationalapplications/clanker/commit/cf5671c7afa6c8dff37636d4716b4532b0528c1d))
- don't show 2nd header ([3992e3d](https://github.com/equationalapplications/clanker/commit/3992e3da6dab8f4d095d3c1fd1126e0b9ecc53c1))
- export firestore ([132e9b5](https://github.com/equationalapplications/clanker/commit/132e9b50099cc2ff325c027bb4ee5a5b0ec40a8e))
- firebase init firestore ([8083905](https://github.com/equationalapplications/clanker/commit/8083905cf7a176a06422d6487b2408448fec7d70))
- firebase init functions ([ca9cd91](https://github.com/equationalapplications/clanker/commit/ca9cd914cadd6f802b6f72d9fc678c49876d4a77))
- if credits <= 0 navigate to "Subscribe" ([131d974](https://github.com/equationalapplications/clanker/commit/131d974b3c09bd25af017c5a95c89697680a33e3))
- if isPremium, show crown instead of credits ([bfeb75d](https://github.com/equationalapplications/clanker/commit/bfeb75d5892dc5bcec3327f2ac41d4a82c1d240d))
- if onCancel is null, just display "Okay" button ([16ad122](https://github.com/equationalapplications/clanker/commit/16ad1223904ba31cca4ad2fe23887bc27134b375))
- if out of credits navigate to "Subscribe" ([5a3480e](https://github.com/equationalapplications/clanker/commit/5a3480e0fc0804daba38a9f550b0e3bbcb03ba30))
- implement comprehensive terms acceptance system ([c573ffc](https://github.com/equationalapplications/clanker/commit/c573ffc83134386d939d06c45fd07f1b6b40a6fd))
- implement comprehensive terms acceptance system ([f94cd59](https://github.com/equationalapplications/clanker/commit/f94cd59c85ae73d19920c01bcadf86f115fa23b9))
- implement hybrid Firebase-Supabase authentication with multi-tenant RBAC ([a16ab19](https://github.com/equationalapplications/clanker/commit/a16ab19df6cc1f09a918b671b123d4fbbc4962eb))
- implement hybrid Firebase-Supabase authentication with multi-tenant RBAC ([c2da8cd](https://github.com/equationalapplications/clanker/commit/c2da8cd5e63e5ce12b03a29a4d965b9ddfdc7af9))
- install @react-navigation/native-stack ([103188c](https://github.com/equationalapplications/clanker/commit/103188c7cf348846e8e8193551260e11096c706c))
- install dev deps ([a540ded](https://github.com/equationalapplications/clanker/commit/a540ded40f3b2f2b9d17fa1bc7a5aaef9576641d))
- install expo-clipboard ([8cf9771](https://github.com/equationalapplications/clanker/commit/8cf9771d1a1afaa8446c18415fcd6b342762c181))
- install husky and commit lint ([e3ca41b](https://github.com/equationalapplications/clanker/commit/e3ca41be9abe5406101d00967a654a9b57eb6848))
- install husky and commit lint ([2465000](https://github.com/equationalapplications/clanker/commit/24650003ebf301acc58f76e89c09ab441217e2fd))
- install react-query firebase ([50791cd](https://github.com/equationalapplications/clanker/commit/50791cd72980990cdac1eeb7d9b8c5f9442105bf))
- integrate terms acceptance modal with existing Terms screen ([12273f6](https://github.com/equationalapplications/clanker/commit/12273f66bd570dc633e0b0d61867fc6c7e3f235b))
- integrate terms acceptance modal with existing Terms screen ([f982397](https://github.com/equationalapplications/clanker/commit/f9823978a1bb6292ac405a8696539a5bb0fda4e7))
- lint ([7959354](https://github.com/equationalapplications/clanker/commit/7959354d5ace72fe3009598fee4892d7e012e97a))
- lint ([3709f06](https://github.com/equationalapplications/clanker/commit/3709f06450b791e0b2acf595426d747ae4848fbe))
- make avatar smaller ([d150844](https://github.com/equationalapplications/clanker/commit/d15084412d8d497cd9c51af8ff31bd7117948730))
- make ConfirmationModal layout responsive ([7022363](https://github.com/equationalapplications/clanker/commit/7022363141c75e32089a4a470a6f863a6e15ee1e))
- navigate to AcceptTerms if !hasAcceptedTermsDate ([47b7c16](https://github.com/equationalapplications/clanker/commit/47b7c16b387aa05f063b30f28dacd52becfb005b))
- npx eas-cli build:configure ([faea4a8](https://github.com/equationalapplications/clanker/commit/faea4a8b7a82c988a20323e3e6c2e12224089b61))
- npx expo install expo-build-properties ([90de24f](https://github.com/equationalapplications/clanker/commit/90de24fef727e72822b2d4d89433512ab4bf0710))
- post web Stripe receipt ([5c71e6c](https://github.com/equationalapplications/clanker/commit/5c71e6c10ab3d43c775ea7e1125596fd15548dc7))
- remove 'make default' button ([7fa183b](https://github.com/equationalapplications/clanker/commit/7fa183b3d09ff740f1ebe68b4b5aca2cb77b2b14))
- remove border. chage colors ([f7ad371](https://github.com/equationalapplications/clanker/commit/f7ad371e2579d171f9ed4502772d1cb9fb80f9d2))
- remove defaultCharacter chat ([834623d](https://github.com/equationalapplications/clanker/commit/834623d930efb7dbceb5c42a8117a361f5800dc1))
- restore tabs ([7233546](https://github.com/equationalapplications/clanker/commit/723354662eeaac65c9845d200a8ce040f2598299))
- restore tabs ([4f370cf](https://github.com/equationalapplications/clanker/commit/4f370cf5f67adcc4b5f0c6bdc43d74e908dc2f0f))
- show confirmation modals ([f0f8473](https://github.com/equationalapplications/clanker/commit/f0f847350410da8ac7ae636713b1f52286ed9d5d))
- show credits in badge on header ([464a829](https://github.com/equationalapplications/clanker/commit/464a8295e6ec453ba1b89b78da8688a0f2ca2347))
- show credits on profile ([fdb2b3b](https://github.com/equationalapplications/clanker/commit/fdb2b3b350e0e0f522f61e552f82f4c990adc104))
- show right header navigation icon ([5cf0773](https://github.com/equationalapplications/clanker/commit/5cf0773dcdd6999a73adfd4f6d55cd4c624c9997))
- show text if character is private ([daf5a60](https://github.com/equationalapplications/clanker/commit/daf5a602466fb1c6526701cea81688694ab501e1))
- show user avatar ([9dc61f2](https://github.com/equationalapplications/clanker/commit/9dc61f2ad178d4780c0b3603dd0cb2f8e069137a))
- sqlite character message ([fc0855b](https://github.com/equationalapplications/clanker/commit/fc0855bf631d3fca733ff4a14aef5608836136d0))
- sqlite character message ([f1a8443](https://github.com/equationalapplications/clanker/commit/f1a84431aba8229ba902a9a32e15caa20be54ec1))
- **supabase:** add supabase ([27d27fe](https://github.com/equationalapplications/clanker/commit/27d27fe881b33764689c353cb33fe4eb5e7a4f12))
- **supabase:** add supabase ([832e550](https://github.com/equationalapplications/clanker/commit/832e550bcba1600c4168e43c7fb8d7c5bf017588))
- support for auto dark / light mode ([2fd9524](https://github.com/equationalapplications/clanker/commit/2fd9524ebdd63f343e21bcd79489719f3e6ca870))
- **terms/privacy:** centralize terms and privacy configs; update screens and modal ([8a76cb7](https://github.com/equationalapplications/clanker/commit/8a76cb7e6203070b2384350875bcd0cb049cd4bf))
- **terms/privacy:** centralize terms and privacy configs; update screens and modal ([40a7711](https://github.com/equationalapplications/clanker/commit/40a7711e946b2a19138aee66070b4990f41dc33e))
- title "Settings". add logout button ([98db1a4](https://github.com/equationalapplications/clanker/commit/98db1a466dcfd566b182570d27b73bdc29290bd7))
- title "Subscribe". remove EditScreenInfo ([a56c779](https://github.com/equationalapplications/clanker/commit/a56c77942cde45952f878bbc64870b35b2dc3703))
- title modal as "Subscribe" ([854dee1](https://github.com/equationalapplications/clanker/commit/854dee1d5c931ffc004f82b61332174b5bad2f48))
- transactions ([503eeed](https://github.com/equationalapplications/clanker/commit/503eeed729fd43db38bb2c8a354fcb76dddad10f))
- transactions ([ceb31ec](https://github.com/equationalapplications/clanker/commit/ceb31ec8746fbcd40bcc2c13449c1ccd7b60c8ce))
- update privacy policy ([9d9ac8a](https://github.com/equationalapplications/clanker/commit/9d9ac8a6976e79c0df6e8ff8762094c25ad10d48))
- update terms and privacy. run lint ([c6439e2](https://github.com/equationalapplications/clanker/commit/c6439e269acc37e50620acebf040eb1d89e2887a))
- use contained buttons ([43a9c96](https://github.com/equationalapplications/clanker/commit/43a9c96948dbe629eb14de54c50531dd9dec17f0))
- use CustomDefaultTheme ([5390d39](https://github.com/equationalapplications/clanker/commit/5390d39edd71e2eed368cfe150a8987d3272faaa))
- use CustomFallback with ErrorBoundary ([e3ad637](https://github.com/equationalapplications/clanker/commit/e3ad637224d6a875c449570d64889632cb013738))
- use deepLink to navigate after auth ([4d5f654](https://github.com/equationalapplications/clanker/commit/4d5f654358a3cabbab399425684868914366abf7))
- use protected routes ([cd4c7ff](https://github.com/equationalapplications/clanker/commit/cd4c7ff772530392e58b29b26dfc697d44e066a6))
- use protected routes ([5a63081](https://github.com/equationalapplications/clanker/commit/5a6308153a25c550b88f17d44a60b6f28032b5d9))
- use react-query for fetching data ([6fac1c9](https://github.com/equationalapplications/clanker/commit/6fac1c9ffad327b1d631500f72a7624ee762cab7))
- use react-query for fetching data ([bc2f2a7](https://github.com/equationalapplications/clanker/commit/bc2f2a7a6627f7447e3f3db6b918c8f9ec8a2a3e))
- use react-query for fetching data ([e8fb53d](https://github.com/equationalapplications/clanker/commit/e8fb53df05d774742e86488a6fab4acafb388c00))
- use react-query for fetching data ([a87795c](https://github.com/equationalapplications/clanker/commit/a87795c13f56695a609f4a0ef0a87b568ea86beb))
- use react-query for mutating data ([6928663](https://github.com/equationalapplications/clanker/commit/6928663646b54f74b890d671a5eea2fb301ba0cf))
- use setIsPremium for entitlement from RevenueCat ([78efec0](https://github.com/equationalapplications/clanker/commit/78efec0e07930f6e2578ac146613537a29a99b89))
- use transparent adaptive icon background ([d2faa58](https://github.com/equationalapplications/clanker/commit/d2faa58f78b0bd37c4dc9a53b3e726e3782e9bcd))
- use uid for Purchases appUserID ([7e64bbc](https://github.com/equationalapplications/clanker/commit/7e64bbc638f4925151e76474068b9a1bd07613a2))
- useAuthSignInWithCredential ([5515751](https://github.com/equationalapplications/clanker/commit/5515751a50efd06f0a7092c49e71aa35d375f3d0))
- useAuthSignInWithCredential ([2c73b39](https://github.com/equationalapplications/clanker/commit/2c73b39c5016ab72615669efb94c872461bf29e3))
- warmup browser, use google redirectUri ([34b6b9e](https://github.com/equationalapplications/clanker/commit/34b6b9edf04bb9b4b0cd7ceb1984f288c61fa63b))

### BREAKING CHANGES

- Remove RevenueCat integration, all subscriptions now use Stripe directly

- ci: use PAT for semantic-release on staging branch

* Add GH_PAT token to checkout step to enable bypass of branch protection
* Configure semantic-release to use GH_PAT for pushing version commits
* Add git author/committer config for semantic-release bot
* Matches the production workflow configuration

- Remove RevenueCat integration, all subscriptions now use Stripe directly
- **react router:** install packages
- **react router:** install packages
- **expo 54 - google signin:** requires rebuild
- **expo 54 - google signin:** requires rebuild
- changes to app.config.ts require rebuild
- changes to app config ts require rebuild
- this library requires a rebuild of dev client
- expo secure store will require a rebuild and changes to app.config.ts
- changes to app.config.ts require rebuilding app and incrementing runtime version
- changes to app.config.ts require rebuild
- changes to metro config changes build
- scheme is needed when creating a development build
- new version of expo-linking and updated app scheme

# [10.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v9.0.0...v10.0.0) (2023-05-14)

### Features

- add google services files for android and ios ([fe7775f](https://github.com/equationalapplications/yoursbrightlyai/commit/fe7775fd071e21d9f584c1a87711d5699b97df75))

### BREAKING CHANGES

- changes to app.config.ts require rebuild

# [10.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v9.0.0...v10.0.0-staging.1) (2023-05-14)

### Features

- add google services files for android and ios ([fe7775f](https://github.com/equationalapplications/yoursbrightlyai/commit/fe7775fd071e21d9f584c1a87711d5699b97df75))

### BREAKING CHANGES

- changes to app.config.ts require rebuild

# [9.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.3.1...v9.0.0) (2023-05-14)

### Features

- add constant from env for googleIosClientId ([b2b8f55](https://github.com/equationalapplications/yoursbrightlyai/commit/b2b8f550720b7a3fd90b03823314c17396776d6e))
- add constant googleIosClientId ([7df4e7f](https://github.com/equationalapplications/yoursbrightlyai/commit/7df4e7f1072c67f4f85269dc000e5eb9c5d0fda5))

### BREAKING CHANGES

- changes to app config ts require rebuild

# [9.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.3.1...v9.0.0-staging.1) (2023-05-14)

### Features

- add constant from env for googleIosClientId ([b2b8f55](https://github.com/equationalapplications/yoursbrightlyai/commit/b2b8f550720b7a3fd90b03823314c17396776d6e))
- add constant googleIosClientId ([7df4e7f](https://github.com/equationalapplications/yoursbrightlyai/commit/7df4e7f1072c67f4f85269dc000e5eb9c5d0fda5))

### BREAKING CHANGES

- changes to app config ts require rebuild

## [8.3.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.3.0...v8.3.1) (2023-04-24)

### Bug Fixes

- roll back EAS changes ([d92dacf](https://github.com/equationalapplications/yoursbrightlyai/commit/d92dacf0fd8f3d7830ce50fed7a423d0b83982e9))

## [8.3.1-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.3.0...v8.3.1-staging.1) (2023-04-23)

### Bug Fixes

- roll back EAS changes ([d92dacf](https://github.com/equationalapplications/yoursbrightlyai/commit/d92dacf0fd8f3d7830ce50fed7a423d0b83982e9))

# [8.3.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.2.0...v8.3.0) (2023-04-23)

### Features

- show text if character is private ([35414c3](https://github.com/equationalapplications/yoursbrightlyai/commit/35414c3470997b87e1c3e6b684b17e76dcb63589))

# [8.3.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.2.0...v8.3.0-staging.1) (2023-04-23)

### Features

- show text if character is private ([35414c3](https://github.com/equationalapplications/yoursbrightlyai/commit/35414c3470997b87e1c3e6b684b17e76dcb63589))

# [8.2.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.1.0...v8.2.0) (2023-04-23)

### Features

- make avatar smaller ([80dfeab](https://github.com/equationalapplications/yoursbrightlyai/commit/80dfeab37546b06ae55a633f466285a4b3e8c60b))

# [8.2.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.1.0...v8.2.0-staging.1) (2023-04-23)

### Features

- make avatar smaller ([80dfeab](https://github.com/equationalapplications/yoursbrightlyai/commit/80dfeab37546b06ae55a633f466285a4b3e8c60b))

# [8.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.0.0...v8.1.0) (2023-04-23)

### Features

- add Avatar and name to top of chat ([b88478e](https://github.com/equationalapplications/yoursbrightlyai/commit/b88478ef302fe289490dca64c195bfacfda7c057))

# [8.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v8.0.0...v8.1.0-staging.1) (2023-04-23)

### Features

- add Avatar and name to top of chat ([b88478e](https://github.com/equationalapplications/yoursbrightlyai/commit/b88478ef302fe289490dca64c195bfacfda7c057))

# [8.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.5.0...v8.0.0) (2023-04-23)

### Bug Fixes

- add id and userId to useEffect dep array ([7a0feb7](https://github.com/equationalapplications/yoursbrightlyai/commit/7a0feb77e6c2d3fcec77526c3a44f72a3db23340))

### Features

- add appChatUrl ([e863080](https://github.com/equationalapplications/yoursbrightlyai/commit/e8630800f8fe1161edb7f4fbcafe19861676322d))
- add navigation state persistance ([375a95c](https://github.com/equationalapplications/yoursbrightlyai/commit/375a95c0c3fe841c04bafc6497642456107b0472))
- create ShareCharacterButton ([d589839](https://github.com/equationalapplications/yoursbrightlyai/commit/d58983960dcca23afbfe139af34ea75e6f6876de))
- install expo-clipboard ([644e216](https://github.com/equationalapplications/yoursbrightlyai/commit/644e216384a87454a6b0187c05219f27fa4345b4))
- remove defaultCharacter chat ([ffd52cb](https://github.com/equationalapplications/yoursbrightlyai/commit/ffd52cb646481d06dd14f7fe1ca1670a394ccc03))
- use deepLink to navigate after auth ([7d00d43](https://github.com/equationalapplications/yoursbrightlyai/commit/7d00d43a67aafd09e9593e4a13295f059b44accb))

### BREAKING CHANGES

- this library requires a rebuild of dev client

# [8.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.5.0...v8.0.0-staging.1) (2023-04-23)

### Bug Fixes

- add id and userId to useEffect dep array ([7a0feb7](https://github.com/equationalapplications/yoursbrightlyai/commit/7a0feb77e6c2d3fcec77526c3a44f72a3db23340))

### Features

- add appChatUrl ([e863080](https://github.com/equationalapplications/yoursbrightlyai/commit/e8630800f8fe1161edb7f4fbcafe19861676322d))
- add navigation state persistance ([375a95c](https://github.com/equationalapplications/yoursbrightlyai/commit/375a95c0c3fe841c04bafc6497642456107b0472))
- create ShareCharacterButton ([d589839](https://github.com/equationalapplications/yoursbrightlyai/commit/d58983960dcca23afbfe139af34ea75e6f6876de))
- install expo-clipboard ([644e216](https://github.com/equationalapplications/yoursbrightlyai/commit/644e216384a87454a6b0187c05219f27fa4345b4))
- remove defaultCharacter chat ([ffd52cb](https://github.com/equationalapplications/yoursbrightlyai/commit/ffd52cb646481d06dd14f7fe1ca1670a394ccc03))
- use deepLink to navigate after auth ([7d00d43](https://github.com/equationalapplications/yoursbrightlyai/commit/7d00d43a67aafd09e9593e4a13295f059b44accb))

### BREAKING CHANGES

- this library requires a rebuild of dev client

# [7.5.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.4.0...v7.5.0) (2023-04-16)

### Bug Fixes

- id and userId null default ([c614def](https://github.com/equationalapplications/yoursbrightlyai/commit/c614def4c2e80e03ef469cb0219b3691d47ad3ec))
- navigate with navigation.getParent() ([9594457](https://github.com/equationalapplications/yoursbrightlyai/commit/9594457d0034619e0b5b978b8769d3a577faa584))

### Features

- create multi-character chat ([36a4f6c](https://github.com/equationalapplications/yoursbrightlyai/commit/36a4f6c16020c5bcff391500bd0766d2b3318e6b))
- don't show 2nd header ([bbfc113](https://github.com/equationalapplications/yoursbrightlyai/commit/bbfc1130c0d3eb6cc6a96d4a8240a27ab77c90f3))
- remove 'make default' button ([99a425e](https://github.com/equationalapplications/yoursbrightlyai/commit/99a425ed1e4956f169df3ca77cd89e1a5443dbd2))

# [7.5.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.4.0...v7.5.0-staging.1) (2023-04-16)

### Bug Fixes

- id and userId null default ([c614def](https://github.com/equationalapplications/yoursbrightlyai/commit/c614def4c2e80e03ef469cb0219b3691d47ad3ec))
- navigate with navigation.getParent() ([9594457](https://github.com/equationalapplications/yoursbrightlyai/commit/9594457d0034619e0b5b978b8769d3a577faa584))

### Features

- create multi-character chat ([36a4f6c](https://github.com/equationalapplications/yoursbrightlyai/commit/36a4f6c16020c5bcff391500bd0766d2b3318e6b))
- don't show 2nd header ([bbfc113](https://github.com/equationalapplications/yoursbrightlyai/commit/bbfc1130c0d3eb6cc6a96d4a8240a27ab77c90f3))
- remove 'make default' button ([99a425e](https://github.com/equationalapplications/yoursbrightlyai/commit/99a425ed1e4956f169df3ca77cd89e1a5443dbd2))

# [7.4.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.3.0...v7.4.0) (2023-04-13)

### Bug Fixes

- add checks for null ([2eb876a](https://github.com/equationalapplications/yoursbrightlyai/commit/2eb876a72e7ff8a0429e2e7bec0606b1c7ad76ec))
- check if refetch is null in useEffect ([b3fdd7e](https://github.com/equationalapplications/yoursbrightlyai/commit/b3fdd7e4afed3e4bd12629a70dc2481db2c7a6a4))
- return data ([bd339de](https://github.com/equationalapplications/yoursbrightlyai/commit/bd339de91d4781f4e7fd7f1deaeb058ed8eb87ef))
- update RootTabParamList ([1f29cdd](https://github.com/equationalapplications/yoursbrightlyai/commit/1f29cddecdec5cb845cfbfa76671e22d9f8bbb36))
- use useUser hook to get user ([9a33b3f](https://github.com/equationalapplications/yoursbrightlyai/commit/9a33b3f2e88cbb97beb3c6a0c63ecb109510fa2b))

### Features

- add disabled prop ([1f2b67f](https://github.com/equationalapplications/yoursbrightlyai/commit/1f2b67f649f9ba391f00fa9b58012df8a875b15d))
- add setDefaultCharacter function ([4b37221](https://github.com/equationalapplications/yoursbrightlyai/commit/4b3722137f1ed207056440e1b6d0ffe368a9ed74))
- create CharacterStackNavigator ([830d8fe](https://github.com/equationalapplications/yoursbrightlyai/commit/830d8fe64037730125e80ed6853a9d4da05e4fa6))
- create createNewCharacter function ([30a52e8](https://github.com/equationalapplications/yoursbrightlyai/commit/30a52e85e0e53619ce1d9b9378d17294278db8da))
- create EditCharacter screen ([edcc430](https://github.com/equationalapplications/yoursbrightlyai/commit/edcc43073af318a37639f96817cbef1c0b13a61a))
- create FAB button to add new character ([eac254d](https://github.com/equationalapplications/yoursbrightlyai/commit/eac254d38e1457a18d7394a07120d9d8de1ef77a))
- create useCharacter hook ([43a65e9](https://github.com/equationalapplications/yoursbrightlyai/commit/43a65e99e9575e25b47199f529432821a0386a39))
- create useCharacterlist hook ([7eb4285](https://github.com/equationalapplications/yoursbrightlyai/commit/7eb4285f799f96b47ea8d314bae624c0ac9fe409))
- display list of buttons for characters ([94fb1ca](https://github.com/equationalapplications/yoursbrightlyai/commit/94fb1ca93e33bdb34a99406dbcc544c17f188f4d))
- use CustomFallback with ErrorBoundary ([4f48978](https://github.com/equationalapplications/yoursbrightlyai/commit/4f4897895b83f2650fb6ee6da24db3a0167810db))

# [7.4.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.3.0...v7.4.0-staging.1) (2023-04-13)

### Bug Fixes

- add checks for null ([2eb876a](https://github.com/equationalapplications/yoursbrightlyai/commit/2eb876a72e7ff8a0429e2e7bec0606b1c7ad76ec))
- check if refetch is null in useEffect ([b3fdd7e](https://github.com/equationalapplications/yoursbrightlyai/commit/b3fdd7e4afed3e4bd12629a70dc2481db2c7a6a4))
- return data ([bd339de](https://github.com/equationalapplications/yoursbrightlyai/commit/bd339de91d4781f4e7fd7f1deaeb058ed8eb87ef))
- update RootTabParamList ([1f29cdd](https://github.com/equationalapplications/yoursbrightlyai/commit/1f29cddecdec5cb845cfbfa76671e22d9f8bbb36))
- use useUser hook to get user ([9a33b3f](https://github.com/equationalapplications/yoursbrightlyai/commit/9a33b3f2e88cbb97beb3c6a0c63ecb109510fa2b))

### Features

- add disabled prop ([1f2b67f](https://github.com/equationalapplications/yoursbrightlyai/commit/1f2b67f649f9ba391f00fa9b58012df8a875b15d))
- add setDefaultCharacter function ([4b37221](https://github.com/equationalapplications/yoursbrightlyai/commit/4b3722137f1ed207056440e1b6d0ffe368a9ed74))
- create CharacterStackNavigator ([830d8fe](https://github.com/equationalapplications/yoursbrightlyai/commit/830d8fe64037730125e80ed6853a9d4da05e4fa6))
- create createNewCharacter function ([30a52e8](https://github.com/equationalapplications/yoursbrightlyai/commit/30a52e85e0e53619ce1d9b9378d17294278db8da))
- create EditCharacter screen ([edcc430](https://github.com/equationalapplications/yoursbrightlyai/commit/edcc43073af318a37639f96817cbef1c0b13a61a))
- create FAB button to add new character ([eac254d](https://github.com/equationalapplications/yoursbrightlyai/commit/eac254d38e1457a18d7394a07120d9d8de1ef77a))
- create useCharacter hook ([43a65e9](https://github.com/equationalapplications/yoursbrightlyai/commit/43a65e99e9575e25b47199f529432821a0386a39))
- create useCharacterlist hook ([7eb4285](https://github.com/equationalapplications/yoursbrightlyai/commit/7eb4285f799f96b47ea8d314bae624c0ac9fe409))
- display list of buttons for characters ([94fb1ca](https://github.com/equationalapplications/yoursbrightlyai/commit/94fb1ca93e33bdb34a99406dbcc544c17f188f4d))
- use CustomFallback with ErrorBoundary ([4f48978](https://github.com/equationalapplications/yoursbrightlyai/commit/4f4897895b83f2650fb6ee6da24db3a0167810db))

# [7.3.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.2.0...v7.3.0) (2023-04-12)

### Bug Fixes

- invalidateQueries("isPremium") after purchase ([e501cda](https://github.com/equationalapplications/yoursbrightlyai/commit/e501cda8107681df8ab68d627952fac011566b34))
- remove invalidateQueries ([dabad24](https://github.com/equationalapplications/yoursbrightlyai/commit/dabad24f9e252daa694a926d972ce04fc6e94797))
- retry: 3, staleTime: 1 hour ([c87e76e](https://github.com/equationalapplications/yoursbrightlyai/commit/c87e76e239b7065f67739479df6329869b1ef5b4))
- update RevenueCat Api naming ([7244ffc](https://github.com/equationalapplications/yoursbrightlyai/commit/7244ffcc6cbc160496b441583530ffda3baa310b))

### Features

- create getIsPremium function ([8141acd](https://github.com/equationalapplications/yoursbrightlyai/commit/8141acd19667196f47dd61c048892e179cbfd162))
- create postStripeReceipt function ([e8c7437](https://github.com/equationalapplications/yoursbrightlyai/commit/e8c74374db1e129386c5db7c1d2ed19422888566))
- create usePostStripeReceipt hook ([cd740f3](https://github.com/equationalapplications/yoursbrightlyai/commit/cd740f3487c1c41de1fe3762e1ed23d51f2f5112))
- post web Stripe receipt ([3a1f667](https://github.com/equationalapplications/yoursbrightlyai/commit/3a1f6670beb67d7877dabc33299e94270c345b36))

# [7.3.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.2.0...v7.3.0-staging.1) (2023-04-12)

### Bug Fixes

- invalidateQueries("isPremium") after purchase ([e501cda](https://github.com/equationalapplications/yoursbrightlyai/commit/e501cda8107681df8ab68d627952fac011566b34))
- remove invalidateQueries ([dabad24](https://github.com/equationalapplications/yoursbrightlyai/commit/dabad24f9e252daa694a926d972ce04fc6e94797))
- retry: 3, staleTime: 1 hour ([c87e76e](https://github.com/equationalapplications/yoursbrightlyai/commit/c87e76e239b7065f67739479df6329869b1ef5b4))
- update RevenueCat Api naming ([7244ffc](https://github.com/equationalapplications/yoursbrightlyai/commit/7244ffcc6cbc160496b441583530ffda3baa310b))

### Features

- create getIsPremium function ([8141acd](https://github.com/equationalapplications/yoursbrightlyai/commit/8141acd19667196f47dd61c048892e179cbfd162))
- create postStripeReceipt function ([e8c7437](https://github.com/equationalapplications/yoursbrightlyai/commit/e8c74374db1e129386c5db7c1d2ed19422888566))
- create usePostStripeReceipt hook ([cd740f3](https://github.com/equationalapplications/yoursbrightlyai/commit/cd740f3487c1c41de1fe3762e1ed23d51f2f5112))
- post web Stripe receipt ([3a1f667](https://github.com/equationalapplications/yoursbrightlyai/commit/3a1f6670beb67d7877dabc33299e94270c345b36))

# [7.2.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.1.0...v7.2.0) (2023-04-08)

### Bug Fixes

- null collesssing ([7bba420](https://github.com/equationalapplications/yoursbrightlyai/commit/7bba420a0d88275ba127f055d6e291fd43d6eb66))
- onConfirmDeleteAccount order of functions ([6929283](https://github.com/equationalapplications/yoursbrightlyai/commit/69292836e2a9bb412aa3600912d80ea4b68cf0dc))
- onPressSignOut queryClient.clear() ([3d22079](https://github.com/equationalapplications/yoursbrightlyai/commit/3d220797fc27e44c1962bb27fb8e09dba960f859))
- remove optimistic update ([128ebcf](https://github.com/equationalapplications/yoursbrightlyai/commit/128ebcf161664b73c0f274b3a137b39b17dad5d8))
- show loading indicator conditions ([f2ef304](https://github.com/equationalapplications/yoursbrightlyai/commit/f2ef3049cef31f22d335e5f2b74d137fce5c1ee5))
- use queryClient.clear() ([8963e84](https://github.com/equationalapplications/yoursbrightlyai/commit/8963e84b601abdb842e5d32c5d39f29d8c0d1aed))
- wrap app in QueryClientProvider ([69dcfe5](https://github.com/equationalapplications/yoursbrightlyai/commit/69dcfe56bca5f0ecef84abea09b78a1396e55b46))

### Features

- add type interface for the REST API ([27080f4](https://github.com/equationalapplications/yoursbrightlyai/commit/27080f40c31a1610ecaccee0e0c15b136dcd7881))
- create reusable deleteUser function ([9a5bea3](https://github.com/equationalapplications/yoursbrightlyai/commit/9a5bea3ef8916a1d07bdf49c666e46d66c310646))
- create reusable deleteUser function ([5701a63](https://github.com/equationalapplications/yoursbrightlyai/commit/5701a635c708ee1b3ccd7b13e0900bd2ea10eb03))
- create updateIsPremium to optimistically update isPremium ([4b9a687](https://github.com/equationalapplications/yoursbrightlyai/commit/4b9a687841b96b5733b6e58ae9fbdd04974f16f9))
- use react-query for fetching data ([6fa94de](https://github.com/equationalapplications/yoursbrightlyai/commit/6fa94de9211d6cec3f20d3e876522bd5652bc77f))
- use react-query for fetching data ([bca9aab](https://github.com/equationalapplications/yoursbrightlyai/commit/bca9aab32d2e8b526327f37f385a73f51bace6f6))
- use react-query for fetching data ([d67860a](https://github.com/equationalapplications/yoursbrightlyai/commit/d67860ac524051c61b5370ab88afb1b684ab093d))
- use react-query for fetching data ([d8b3a98](https://github.com/equationalapplications/yoursbrightlyai/commit/d8b3a9824d714e787ad06d04cd965fb52f7347a3))
- use react-query for mutating data ([66aac24](https://github.com/equationalapplications/yoursbrightlyai/commit/66aac2410a902debb247ad4a38ce0929ce13ff11))

# [7.2.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.1.0...v7.2.0-staging.1) (2023-04-08)

### Bug Fixes

- null collesssing ([7bba420](https://github.com/equationalapplications/yoursbrightlyai/commit/7bba420a0d88275ba127f055d6e291fd43d6eb66))
- onConfirmDeleteAccount order of functions ([6929283](https://github.com/equationalapplications/yoursbrightlyai/commit/69292836e2a9bb412aa3600912d80ea4b68cf0dc))
- onPressSignOut queryClient.clear() ([3d22079](https://github.com/equationalapplications/yoursbrightlyai/commit/3d220797fc27e44c1962bb27fb8e09dba960f859))
- remove optimistic update ([128ebcf](https://github.com/equationalapplications/yoursbrightlyai/commit/128ebcf161664b73c0f274b3a137b39b17dad5d8))
- show loading indicator conditions ([f2ef304](https://github.com/equationalapplications/yoursbrightlyai/commit/f2ef3049cef31f22d335e5f2b74d137fce5c1ee5))
- use queryClient.clear() ([8963e84](https://github.com/equationalapplications/yoursbrightlyai/commit/8963e84b601abdb842e5d32c5d39f29d8c0d1aed))
- wrap app in QueryClientProvider ([69dcfe5](https://github.com/equationalapplications/yoursbrightlyai/commit/69dcfe56bca5f0ecef84abea09b78a1396e55b46))

### Features

- add type interface for the REST API ([27080f4](https://github.com/equationalapplications/yoursbrightlyai/commit/27080f40c31a1610ecaccee0e0c15b136dcd7881))
- create reusable deleteUser function ([9a5bea3](https://github.com/equationalapplications/yoursbrightlyai/commit/9a5bea3ef8916a1d07bdf49c666e46d66c310646))
- create reusable deleteUser function ([5701a63](https://github.com/equationalapplications/yoursbrightlyai/commit/5701a635c708ee1b3ccd7b13e0900bd2ea10eb03))
- create updateIsPremium to optimistically update isPremium ([4b9a687](https://github.com/equationalapplications/yoursbrightlyai/commit/4b9a687841b96b5733b6e58ae9fbdd04974f16f9))
- use react-query for fetching data ([6fa94de](https://github.com/equationalapplications/yoursbrightlyai/commit/6fa94de9211d6cec3f20d3e876522bd5652bc77f))
- use react-query for fetching data ([bca9aab](https://github.com/equationalapplications/yoursbrightlyai/commit/bca9aab32d2e8b526327f37f385a73f51bace6f6))
- use react-query for fetching data ([d67860a](https://github.com/equationalapplications/yoursbrightlyai/commit/d67860ac524051c61b5370ab88afb1b684ab093d))
- use react-query for fetching data ([d8b3a98](https://github.com/equationalapplications/yoursbrightlyai/commit/d8b3a9824d714e787ad06d04cd965fb52f7347a3))
- use react-query for mutating data ([66aac24](https://github.com/equationalapplications/yoursbrightlyai/commit/66aac2410a902debb247ad4a38ce0929ce13ff11))

# [7.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.0.0...v7.1.0) (2023-04-03)

### Bug Fixes

- add user to useEffect dependency array ([847654c](https://github.com/equationalapplications/yoursbrightlyai/commit/847654c7ddabe816393d91e910b06804dd62fade))

### Features

- create AcceptTerms component ([f1c90a9](https://github.com/equationalapplications/yoursbrightlyai/commit/f1c90a9e1e754fffccbbb638f3a56dc37cd87509))
- create AcceptTerms screen ([86a15a0](https://github.com/equationalapplications/yoursbrightlyai/commit/86a15a049bf4b7e13ce1d5e8c29805b5d501a460))
- create AcceptTerms Screen ([cefe7cf](https://github.com/equationalapplications/yoursbrightlyai/commit/cefe7cfcf37190d29754e8c64c4507a564f1a8a9))
- navigate to AcceptTerms if !hasAcceptedTermsDate ([3ee23bd](https://github.com/equationalapplications/yoursbrightlyai/commit/3ee23bd00473809273ec13bf850834eeca562215))

# [7.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v7.0.0...v7.1.0-staging.1) (2023-04-03)

### Bug Fixes

- add user to useEffect dependency array ([847654c](https://github.com/equationalapplications/yoursbrightlyai/commit/847654c7ddabe816393d91e910b06804dd62fade))

### Features

- create AcceptTerms component ([f1c90a9](https://github.com/equationalapplications/yoursbrightlyai/commit/f1c90a9e1e754fffccbbb638f3a56dc37cd87509))
- create AcceptTerms screen ([86a15a0](https://github.com/equationalapplications/yoursbrightlyai/commit/86a15a049bf4b7e13ce1d5e8c29805b5d501a460))
- create AcceptTerms Screen ([cefe7cf](https://github.com/equationalapplications/yoursbrightlyai/commit/cefe7cfcf37190d29754e8c64c4507a564f1a8a9))
- navigate to AcceptTerms if !hasAcceptedTermsDate ([3ee23bd](https://github.com/equationalapplications/yoursbrightlyai/commit/3ee23bd00473809273ec13bf850834eeca562215))

# [7.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.4.0...v7.0.0) (2023-03-31)

### Bug Fixes

- correct user_characters ([052d895](https://github.com/equationalapplications/yoursbrightlyai/commit/052d89518b42afd6ce036a4353e52791b16f87fc))
- isEraseModal intially false ([c139bbb](https://github.com/equationalapplications/yoursbrightlyai/commit/c139bbb1250ecd4f8fadf94a8c866f761b6bd258))
- show indicator then sign out when deleting user ([3154fbb](https://github.com/equationalapplications/yoursbrightlyai/commit/3154fbbad314ec88309fc08cabfec97f71331d33))
- use onChangeLoading Props for isLoading ([9347901](https://github.com/equationalapplications/yoursbrightlyai/commit/9347901d2bd27a08f33844ab116f6ae96087ae76))

### Build System

- npx expo install expo-secure-store ([dbcd3a1](https://github.com/equationalapplications/yoursbrightlyai/commit/dbcd3a1491edebac9b60f93805a81c3d61e09369))

### Features

- create secureStore utility ([bf57fb2](https://github.com/equationalapplications/yoursbrightlyai/commit/bf57fb282df6fec730ce1ffe98376aeb800b9fd1))
- if onCancel is null, just display "Okay" button ([dc80ed3](https://github.com/equationalapplications/yoursbrightlyai/commit/dc80ed34913c5d65789e4f2a6f2bc6a27891bc34))
- show confirmation modals ([36a4e71](https://github.com/equationalapplications/yoursbrightlyai/commit/36a4e718038217b086a75a1914a9fd32f9e49e14))

### BREAKING CHANGES

- expo secure store will require a rebuild and changes to app.config.ts

# [7.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.4.0...v7.0.0-staging.1) (2023-03-31)

### Bug Fixes

- correct user_characters ([052d895](https://github.com/equationalapplications/yoursbrightlyai/commit/052d89518b42afd6ce036a4353e52791b16f87fc))
- isEraseModal intially false ([c139bbb](https://github.com/equationalapplications/yoursbrightlyai/commit/c139bbb1250ecd4f8fadf94a8c866f761b6bd258))
- show indicator then sign out when deleting user ([3154fbb](https://github.com/equationalapplications/yoursbrightlyai/commit/3154fbbad314ec88309fc08cabfec97f71331d33))
- use onChangeLoading Props for isLoading ([9347901](https://github.com/equationalapplications/yoursbrightlyai/commit/9347901d2bd27a08f33844ab116f6ae96087ae76))

### Build System

- npx expo install expo-secure-store ([dbcd3a1](https://github.com/equationalapplications/yoursbrightlyai/commit/dbcd3a1491edebac9b60f93805a81c3d61e09369))

### Features

- create secureStore utility ([bf57fb2](https://github.com/equationalapplications/yoursbrightlyai/commit/bf57fb282df6fec730ce1ffe98376aeb800b9fd1))
- if onCancel is null, just display "Okay" button ([dc80ed3](https://github.com/equationalapplications/yoursbrightlyai/commit/dc80ed34913c5d65789e4f2a6f2bc6a27891bc34))
- show confirmation modals ([36a4e71](https://github.com/equationalapplications/yoursbrightlyai/commit/36a4e718038217b086a75a1914a9fd32f9e49e14))

### BREAKING CHANGES

- expo secure store will require a rebuild and changes to app.config.ts

# [6.4.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.3.0...v6.4.0) (2023-03-31)

### Bug Fixes

- check ( credits <= 0 && !isPremium ) ([31ecc4c](https://github.com/equationalapplications/yoursbrightlyai/commit/31ecc4cb0709da1ef6864dea0d8a024acfcba374))
- use subscriber info instead of offerings for "web" ([4db1f3f](https://github.com/equationalapplications/yoursbrightlyai/commit/4db1f3ffc74ac6c75bb96a1fcef1360a4977ee97))

### Features

- add const scheme ([f93250b](https://github.com/equationalapplications/yoursbrightlyai/commit/f93250b24db8bcb65f48b3fb9dde3c3d83e6e00f))
- add revenueCatSubscribers to constants ([604f996](https://github.com/equationalapplications/yoursbrightlyai/commit/604f996bc1fb3ee7d13ea4a99226fd4da2f73a6c))
- create setIsPremium utility function to use firebase function ([1dd0feb](https://github.com/equationalapplications/yoursbrightlyai/commit/1dd0febc896877125cc9bdcb20f211927ebeeeed))
- create useIsPremium hook ([6e84b97](https://github.com/equationalapplications/yoursbrightlyai/commit/6e84b975f28e3b7ba5b3dcd7f666abe04248c3c2))
- display path that was not found ([f89dcdc](https://github.com/equationalapplications/yoursbrightlyai/commit/f89dcdcffcc5d5d16ab94a6d8a567ba391199564))
- make ConfirmationModal layout responsive ([1c3e33d](https://github.com/equationalapplications/yoursbrightlyai/commit/1c3e33de037e7c3f556159bb98ddd21a2e2a1ba8))
- use setIsPremium for entitlement from RevenueCat ([b919c91](https://github.com/equationalapplications/yoursbrightlyai/commit/b919c91478bda9b365d85996d6c486640d15bf39))
- warmup browser, use google redirectUri ([57e47ce](https://github.com/equationalapplications/yoursbrightlyai/commit/57e47ce5d5eeb6985f8a89fb886d646236b27529))

# [6.4.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.3.0...v6.4.0-staging.1) (2023-03-31)

### Bug Fixes

- check ( credits <= 0 && !isPremium ) ([31ecc4c](https://github.com/equationalapplications/yoursbrightlyai/commit/31ecc4cb0709da1ef6864dea0d8a024acfcba374))
- use subscriber info instead of offerings for "web" ([4db1f3f](https://github.com/equationalapplications/yoursbrightlyai/commit/4db1f3ffc74ac6c75bb96a1fcef1360a4977ee97))

### Features

- add const scheme ([f93250b](https://github.com/equationalapplications/yoursbrightlyai/commit/f93250b24db8bcb65f48b3fb9dde3c3d83e6e00f))
- add revenueCatSubscribers to constants ([604f996](https://github.com/equationalapplications/yoursbrightlyai/commit/604f996bc1fb3ee7d13ea4a99226fd4da2f73a6c))
- create setIsPremium utility function to use firebase function ([1dd0feb](https://github.com/equationalapplications/yoursbrightlyai/commit/1dd0febc896877125cc9bdcb20f211927ebeeeed))
- create useIsPremium hook ([6e84b97](https://github.com/equationalapplications/yoursbrightlyai/commit/6e84b975f28e3b7ba5b3dcd7f666abe04248c3c2))
- display path that was not found ([f89dcdc](https://github.com/equationalapplications/yoursbrightlyai/commit/f89dcdcffcc5d5d16ab94a6d8a567ba391199564))
- make ConfirmationModal layout responsive ([1c3e33d](https://github.com/equationalapplications/yoursbrightlyai/commit/1c3e33de037e7c3f556159bb98ddd21a2e2a1ba8))
- use setIsPremium for entitlement from RevenueCat ([b919c91](https://github.com/equationalapplications/yoursbrightlyai/commit/b919c91478bda9b365d85996d6c486640d15bf39))
- warmup browser, use google redirectUri ([57e47ce](https://github.com/equationalapplications/yoursbrightlyai/commit/57e47ce5d5eeb6985f8a89fb886d646236b27529))

# [6.3.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.2.0...v6.3.0) (2023-03-29)

### Features

- conditionally show SubscriptionBillingInfoButton or Subscribe button ([e38c97d](https://github.com/equationalapplications/yoursbrightlyai/commit/e38c97d1d471099c92478e6faf77598cb587312b))
- creat SubscriptionBillingInfoButton ([df5740e](https://github.com/equationalapplications/yoursbrightlyai/commit/df5740e1aed9e4328584aa1274d12b6e191e7469))
- create ConfirmationModal component ([ba664b9](https://github.com/equationalapplications/yoursbrightlyai/commit/ba664b9c1cea31c81b17a0c923052be32a0e5388))
- if isPremium, show crown instead of credits ([e7fbd9f](https://github.com/equationalapplications/yoursbrightlyai/commit/e7fbd9f849cf1902a9313df795a67f8a19fc976b))

# [6.3.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.2.0...v6.3.0-staging.1) (2023-03-29)

### Features

- conditionally show SubscriptionBillingInfoButton or Subscribe button ([e38c97d](https://github.com/equationalapplications/yoursbrightlyai/commit/e38c97d1d471099c92478e6faf77598cb587312b))
- creat SubscriptionBillingInfoButton ([df5740e](https://github.com/equationalapplications/yoursbrightlyai/commit/df5740e1aed9e4328584aa1274d12b6e191e7469))
- create ConfirmationModal component ([ba664b9](https://github.com/equationalapplications/yoursbrightlyai/commit/ba664b9c1cea31c81b17a0c923052be32a0e5388))
- if isPremium, show crown instead of credits ([e7fbd9f](https://github.com/equationalapplications/yoursbrightlyai/commit/e7fbd9f849cf1902a9313df795a67f8a19fc976b))

# [6.2.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.3...v6.2.0) (2023-03-29)

### Features

- display credits on subscribe page ([d01d4e5](https://github.com/equationalapplications/yoursbrightlyai/commit/d01d4e524028208f392da7639e2faf574424d808))
- display credits on subscribe page ([f9ced83](https://github.com/equationalapplications/yoursbrightlyai/commit/f9ced838c2dd6dc4dea363f571f6d55c305e8567))
- if credits <= 0 navigate to "Subscribe" ([97bf6aa](https://github.com/equationalapplications/yoursbrightlyai/commit/97bf6aacd058f78f23330f799a2f0bd52b486c11))
- if out of credits navigate to "Subscribe" ([2eba3dd](https://github.com/equationalapplications/yoursbrightlyai/commit/2eba3ddf3c7a61b6a55018c4968061ed7e711206))

# [6.2.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.3-staging.1...v6.2.0-staging.1) (2023-03-29)

### Features

- display credits on subscribe page ([d01d4e5](https://github.com/equationalapplications/yoursbrightlyai/commit/d01d4e524028208f392da7639e2faf574424d808))
- display credits on subscribe page ([f9ced83](https://github.com/equationalapplications/yoursbrightlyai/commit/f9ced838c2dd6dc4dea363f571f6d55c305e8567))
- if credits <= 0 navigate to "Subscribe" ([97bf6aa](https://github.com/equationalapplications/yoursbrightlyai/commit/97bf6aacd058f78f23330f799a2f0bd52b486c11))
- if out of credits navigate to "Subscribe" ([2eba3dd](https://github.com/equationalapplications/yoursbrightlyai/commit/2eba3ddf3c7a61b6a55018c4968061ed7e711206))

## [6.1.3](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.2...v6.1.3) (2023-03-29)

### Bug Fixes

- correct object shape of colorsDark ([4532375](https://github.com/equationalapplications/yoursbrightlyai/commit/45323751de059ff76d83af119e659f57c5323781))
- use Text from Paper for Styled Text ([3047c15](https://github.com/equationalapplications/yoursbrightlyai/commit/3047c15dd58a7cb59d35500a837b393e913076d3))

## [6.1.3-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.2...v6.1.3-staging.1) (2023-03-29)

### Bug Fixes

- correct object shape of colorsDark ([4532375](https://github.com/equationalapplications/yoursbrightlyai/commit/45323751de059ff76d83af119e659f57c5323781))
- use Text from Paper for Styled Text ([3047c15](https://github.com/equationalapplications/yoursbrightlyai/commit/3047c15dd58a7cb59d35500a837b393e913076d3))

## [6.1.2](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.1...v6.1.2) (2023-03-29)

### Bug Fixes

- combine colors properly for display on Andoid ([fd5ca75](https://github.com/equationalapplications/yoursbrightlyai/commit/fd5ca75ed19b43930a06127941459e963dde3232))

## [6.1.2-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.1...v6.1.2-staging.1) (2023-03-29)

### Bug Fixes

- combine colors properly for display on Andoid ([fd5ca75](https://github.com/equationalapplications/yoursbrightlyai/commit/fd5ca75ed19b43930a06127941459e963dde3232))

## [6.1.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.0...v6.1.1) (2023-03-29)

### Bug Fixes

- temp disable billing button ([b18cb24](https://github.com/equationalapplications/yoursbrightlyai/commit/b18cb24eb36b33bb8e3adc7a364a0d694330c720))

## [6.1.1-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.1.0...v6.1.1-staging.1) (2023-03-29)

### Bug Fixes

- temp disable billing button ([b18cb24](https://github.com/equationalapplications/yoursbrightlyai/commit/b18cb24eb36b33bb8e3adc7a364a0d694330c720))

# [6.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.0.1...v6.1.0) (2023-03-28)

### Features

- create styled LoadingIndicator ([13d0238](https://github.com/equationalapplications/yoursbrightlyai/commit/13d0238f573d098ce4c46d61a93965e620e9fa6f))

# [6.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.0.1...v6.1.0-staging.1) (2023-03-28)

### Features

- create styled LoadingIndicator ([13d0238](https://github.com/equationalapplications/yoursbrightlyai/commit/13d0238f573d098ce4c46d61a93965e620e9fa6f))

## [6.0.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.0.0...v6.0.1) (2023-03-27)

### Bug Fixes

- with the ?. optional properties added ([ed33b57](https://github.com/equationalapplications/yoursbrightlyai/commit/ed33b5735badf1a3025d11727043147c366d18eb))

## [6.0.1-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.0.0...v6.0.1-staging.1) (2023-03-27)

### Bug Fixes

- with the ?. optional properties added ([ed33b57](https://github.com/equationalapplications/yoursbrightlyai/commit/ed33b5735badf1a3025d11727043147c366d18eb))

# [6.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.1.1...v6.0.0) (2023-03-26)

### Bug Fixes

- add question mark to customerInfo properties ([3af1d6a](https://github.com/equationalapplications/yoursbrightlyai/commit/3af1d6acde662c0ed3e9ddee544ba953e2d830a2))
- use fetch to get customerInfo on web ([6ee3488](https://github.com/equationalapplications/yoursbrightlyai/commit/6ee3488176256d52f087e1531e886d58b15c1fa3))

### chore

- add new expo extra properties for Constants ([ac90dc3](https://github.com/equationalapplications/yoursbrightlyai/commit/ac90dc38d8532327b902d114c65bf42dccab5578))

### Features

- add billing button ([4670a18](https://github.com/equationalapplications/yoursbrightlyai/commit/4670a18f64bb956f3c4bb16853c075528ad16618))
- add PurchasesProvider.tsx ([41e0c26](https://github.com/equationalapplications/yoursbrightlyai/commit/41e0c261c551a3ef0762f7e181aa3eabe3595068))
- add PurchaseSuccess screen ([bba77f0](https://github.com/equationalapplications/yoursbrightlyai/commit/bba77f02098bd8bf39b129c996ec594eccc4c8ba))
- create makePackaePurchase utilty function ([944759f](https://github.com/equationalapplications/yoursbrightlyai/commit/944759fca8a2582c133d585775d452a0085614e6))
- create useCustomerInfo hook ([d0e787f](https://github.com/equationalapplications/yoursbrightlyai/commit/d0e787f8da26080ae5a65cd2a5f3df01ebd96d7b))
- create usePurchasesOfferings hook ([48653cb](https://github.com/equationalapplications/yoursbrightlyai/commit/48653cb7c5b0cbcda273d64ca92f9193da013263))

### BREAKING CHANGES

- changes to app.config.ts require rebuilding app and incrementing runtime version

# [6.0.0-staging.3](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.0.0-staging.2...v6.0.0-staging.3) (2023-03-26)

### Features

- add billing button ([4670a18](https://github.com/equationalapplications/yoursbrightlyai/commit/4670a18f64bb956f3c4bb16853c075528ad16618))
- add PurchaseSuccess screen ([bba77f0](https://github.com/equationalapplications/yoursbrightlyai/commit/bba77f02098bd8bf39b129c996ec594eccc4c8ba))
- create makePackaePurchase utilty function ([944759f](https://github.com/equationalapplications/yoursbrightlyai/commit/944759fca8a2582c133d585775d452a0085614e6))
- create useCustomerInfo hook ([d0e787f](https://github.com/equationalapplications/yoursbrightlyai/commit/d0e787f8da26080ae5a65cd2a5f3df01ebd96d7b))
- create usePurchasesOfferings hook ([48653cb](https://github.com/equationalapplications/yoursbrightlyai/commit/48653cb7c5b0cbcda273d64ca92f9193da013263))

# [6.0.0-staging.2](https://github.com/equationalapplications/yoursbrightlyai/compare/v6.0.0-staging.1...v6.0.0-staging.2) (2023-03-21)

### Bug Fixes

- add question mark to customerInfo properties ([3af1d6a](https://github.com/equationalapplications/yoursbrightlyai/commit/3af1d6acde662c0ed3e9ddee544ba953e2d830a2))
- use fetch to get customerInfo on web ([6ee3488](https://github.com/equationalapplications/yoursbrightlyai/commit/6ee3488176256d52f087e1531e886d58b15c1fa3))

# [6.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.1.1...v6.0.0-staging.1) (2023-03-19)

### chore

- add new expo extra properties for Constants ([ac90dc3](https://github.com/equationalapplications/yoursbrightlyai/commit/ac90dc38d8532327b902d114c65bf42dccab5578))

### Features

- add PurchasesProvider.tsx ([41e0c26](https://github.com/equationalapplications/yoursbrightlyai/commit/41e0c261c551a3ef0762f7e181aa3eabe3595068))

### BREAKING CHANGES

- changes to app.config.ts require rebuilding app and incrementing runtime version

## [5.1.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.1.0...v5.1.1) (2023-03-17)

### Bug Fixes

- add default url for avatar ([6adf0a0](https://github.com/equationalapplications/yoursbrightlyai/commit/6adf0a0b5917f9a934326e45962ad9644ec23062))

## [5.1.1-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.1.0...v5.1.1-staging.1) (2023-03-17)

### Bug Fixes

- add default url for avatar ([6adf0a0](https://github.com/equationalapplications/yoursbrightlyai/commit/6adf0a0b5917f9a934326e45962ad9644ec23062))

# [5.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.0.1...v5.1.0) (2023-03-17)

### Bug Fixes

- correct variable names ([0213dce](https://github.com/equationalapplications/yoursbrightlyai/commit/0213dce7d713398d8cba57f3e666fdf3fb039c8c))
- use defaultCharacter in the final array of useEffect ([0d095fd](https://github.com/equationalapplications/yoursbrightlyai/commit/0d095fd78f768dadfe416c7fea522a3e668d39b5))

### Features

- create useUserPublic hook ([61f24b1](https://github.com/equationalapplications/yoursbrightlyai/commit/61f24b1ed8a6eb7fd5330d73fd2e0c7cc062b58a))
- create useUserPublic hook ([e2eb80a](https://github.com/equationalapplications/yoursbrightlyai/commit/e2eb80ae1612d28975ef089c8e67c269c97d83db))

# [5.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.0.1...v5.1.0-staging.1) (2023-03-17)

### Bug Fixes

- correct variable names ([0213dce](https://github.com/equationalapplications/yoursbrightlyai/commit/0213dce7d713398d8cba57f3e666fdf3fb039c8c))
- use defaultCharacter in the final array of useEffect ([0d095fd](https://github.com/equationalapplications/yoursbrightlyai/commit/0d095fd78f768dadfe416c7fea522a3e668d39b5))

### Features

- create useUserPublic hook ([61f24b1](https://github.com/equationalapplications/yoursbrightlyai/commit/61f24b1ed8a6eb7fd5330d73fd2e0c7cc062b58a))
- create useUserPublic hook ([e2eb80a](https://github.com/equationalapplications/yoursbrightlyai/commit/e2eb80ae1612d28975ef089c8e67c269c97d83db))

## [5.0.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.0.0...v5.0.1) (2023-03-16)

### Bug Fixes

- add navigate to signin ([b75e10a](https://github.com/equationalapplications/yoursbrightlyai/commit/b75e10af4043bd8971611daf0ce91e05046182fe))
- remove navigation in useEffect for user changes ([9d02507](https://github.com/equationalapplications/yoursbrightlyai/commit/9d025073ebd9572d76ef12b38f5c92318f9d8d8f))
- remove setUser. replace with return null ([aa28f89](https://github.com/equationalapplications/yoursbrightlyai/commit/aa28f8931024cd05437f97d900cca1692287c8ce))

## [5.0.1-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v5.0.0...v5.0.1-staging.1) (2023-03-16)

### Bug Fixes

- add navigate to signin ([b75e10a](https://github.com/equationalapplications/yoursbrightlyai/commit/b75e10af4043bd8971611daf0ce91e05046182fe))
- remove navigation in useEffect for user changes ([9d02507](https://github.com/equationalapplications/yoursbrightlyai/commit/9d025073ebd9572d76ef12b38f5c92318f9d8d8f))
- remove setUser. replace with return null ([aa28f89](https://github.com/equationalapplications/yoursbrightlyai/commit/aa28f8931024cd05437f97d900cca1692287c8ce))

# [5.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.2.0...v5.0.0) (2023-03-16)

### Bug Fixes

- add character to state ([16a0cc7](https://github.com/equationalapplications/yoursbrightlyai/commit/16a0cc704fa4dff9687737985ba03d506bd24aef))
- correct the collection path ([df5f19d](https://github.com/equationalapplications/yoursbrightlyai/commit/df5f19dddfc9d8ef7cbec75a0708eaecbe98dde1))
- do not remove createdAt ([d8a8274](https://github.com/equationalapplications/yoursbrightlyai/commit/d8a82745335c33f39dab313fcd240bb5012ca211))
- imageIsLoading ([1d7a002](https://github.com/equationalapplications/yoursbrightlyai/commit/1d7a002d2250f57211beb672bc47ccf677085ae9))
- implement updateDoc ([bce657a](https://github.com/equationalapplications/yoursbrightlyai/commit/bce657a38ed6171016d3b12c6a45e9fcf72bfed3))
- sort and then remove createdAt ([b5fadc0](https://github.com/equationalapplications/yoursbrightlyai/commit/b5fadc0a6fa6f5918ae48c94059ff36b07eefa0a))
- typo ([cd38a9a](https://github.com/equationalapplications/yoursbrightlyai/commit/cd38a9a8d28a54f44fc6a398a5bb34db8aa2202d))
- use useUser to get user ([c3b9da9](https://github.com/equationalapplications/yoursbrightlyai/commit/c3b9da90c6907781c120ecc53566c6212a8f721f))
- user interface remove "| null" for strings ([561442b](https://github.com/equationalapplications/yoursbrightlyai/commit/561442b09b8ae02ff2c6ce39784b4b534dc601e3))

### Features

- add firebase collection strings to extra: ([6550d71](https://github.com/equationalapplications/yoursbrightlyai/commit/6550d71e4d3a14b573b58c5c374f0caaeefc45d3))
- create updateMessages function ([aacd965](https://github.com/equationalapplications/yoursbrightlyai/commit/aacd9655095f8dcf5fba24f8fe8fef5be7e02086))
- create useDefaultCharacter hook ([d391a65](https://github.com/equationalapplications/yoursbrightlyai/commit/d391a659c4e134c6020109bfce12eea24f498404))
- create useMessages hook ([f8a6fad](https://github.com/equationalapplications/yoursbrightlyai/commit/f8a6fad02bf29a9158a93619c480e2adcde5d450))
- create useUser hook ([bc2e7dd](https://github.com/equationalapplications/yoursbrightlyai/commit/bc2e7dd64343cc9aa9daf9411f0bc7bd71eca460))
- show credits in badge on header ([f180d0e](https://github.com/equationalapplications/yoursbrightlyai/commit/f180d0eded559dbbc20dec1a55c78143584d8acf))
- show credits on profile ([b553dad](https://github.com/equationalapplications/yoursbrightlyai/commit/b553dad20d95dd77e4d200671b2ad9d72b1a924a))
- show right header navigation icon ([2de7708](https://github.com/equationalapplications/yoursbrightlyai/commit/2de7708f47d43ca5cb8840cab0f12900e2b674c4))

### BREAKING CHANGES

- changes to app.config.ts require rebuild

# [5.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.2.0...v5.0.0-staging.1) (2023-03-16)

### Bug Fixes

- add character to state ([16a0cc7](https://github.com/equationalapplications/yoursbrightlyai/commit/16a0cc704fa4dff9687737985ba03d506bd24aef))
- correct the collection path ([df5f19d](https://github.com/equationalapplications/yoursbrightlyai/commit/df5f19dddfc9d8ef7cbec75a0708eaecbe98dde1))
- do not remove createdAt ([d8a8274](https://github.com/equationalapplications/yoursbrightlyai/commit/d8a82745335c33f39dab313fcd240bb5012ca211))
- imageIsLoading ([1d7a002](https://github.com/equationalapplications/yoursbrightlyai/commit/1d7a002d2250f57211beb672bc47ccf677085ae9))
- implement updateDoc ([bce657a](https://github.com/equationalapplications/yoursbrightlyai/commit/bce657a38ed6171016d3b12c6a45e9fcf72bfed3))
- sort and then remove createdAt ([b5fadc0](https://github.com/equationalapplications/yoursbrightlyai/commit/b5fadc0a6fa6f5918ae48c94059ff36b07eefa0a))
- typo ([cd38a9a](https://github.com/equationalapplications/yoursbrightlyai/commit/cd38a9a8d28a54f44fc6a398a5bb34db8aa2202d))
- use useUser to get user ([c3b9da9](https://github.com/equationalapplications/yoursbrightlyai/commit/c3b9da90c6907781c120ecc53566c6212a8f721f))
- user interface remove "| null" for strings ([561442b](https://github.com/equationalapplications/yoursbrightlyai/commit/561442b09b8ae02ff2c6ce39784b4b534dc601e3))

### Features

- add firebase collection strings to extra: ([6550d71](https://github.com/equationalapplications/yoursbrightlyai/commit/6550d71e4d3a14b573b58c5c374f0caaeefc45d3))
- create updateMessages function ([aacd965](https://github.com/equationalapplications/yoursbrightlyai/commit/aacd9655095f8dcf5fba24f8fe8fef5be7e02086))
- create useDefaultCharacter hook ([d391a65](https://github.com/equationalapplications/yoursbrightlyai/commit/d391a659c4e134c6020109bfce12eea24f498404))
- create useMessages hook ([f8a6fad](https://github.com/equationalapplications/yoursbrightlyai/commit/f8a6fad02bf29a9158a93619c480e2adcde5d450))
- create useUser hook ([bc2e7dd](https://github.com/equationalapplications/yoursbrightlyai/commit/bc2e7dd64343cc9aa9daf9411f0bc7bd71eca460))
- show credits in badge on header ([f180d0e](https://github.com/equationalapplications/yoursbrightlyai/commit/f180d0eded559dbbc20dec1a55c78143584d8acf))
- show credits on profile ([b553dad](https://github.com/equationalapplications/yoursbrightlyai/commit/b553dad20d95dd77e4d200671b2ad9d72b1a924a))
- show right header navigation icon ([2de7708](https://github.com/equationalapplications/yoursbrightlyai/commit/2de7708f47d43ca5cb8840cab0f12900e2b674c4))

### BREAKING CHANGES

- changes to app.config.ts require rebuild

# [4.2.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.1.0...v4.2.0) (2023-03-14)

### Features

- add styling to chat ([52736ac](https://github.com/equationalapplications/yoursbrightlyai/commit/52736acf699660f93e021fa20e67c41a4e346020))
- remove border. chage colors ([2929ce1](https://github.com/equationalapplications/yoursbrightlyai/commit/2929ce1ac5aa41568fe65b0403d0ce1d6c84242f))

# [4.2.0-staging.2](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.2.0-staging.1...v4.2.0-staging.2) (2023-03-14)

### Features

- remove border. chage colors ([2929ce1](https://github.com/equationalapplications/yoursbrightlyai/commit/2929ce1ac5aa41568fe65b0403d0ce1d6c84242f))

# [4.2.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.1.0...v4.2.0-staging.1) (2023-03-14)

### Features

- add styling to chat ([52736ac](https://github.com/equationalapplications/yoursbrightlyai/commit/52736acf699660f93e021fa20e67c41a4e346020))

# [4.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.0.0...v4.1.0) (2023-03-13)

### Bug Fixes

- add comma after prefix ([4cfd1c7](https://github.com/equationalapplications/yoursbrightlyai/commit/4cfd1c740424d3ecf83543c24ff6df3a3138b964))
- add key to navigation groups ([12193b3](https://github.com/equationalapplications/yoursbrightlyai/commit/12193b35e936407b479b6bebc7c87ee675e8f62f))
- add uid to useAuthUser key ([0bb9e8d](https://github.com/equationalapplications/yoursbrightlyai/commit/0bb9e8d86932054fb0c9db33f459e1a2a2798fbe))
- add uid to useAuthUser key ([1d69fed](https://github.com/equationalapplications/yoursbrightlyai/commit/1d69fedf1058601bbeb6e834a720fd4eee91f4bd))

### Features

- add default avatar url ([e7c23e1](https://github.com/equationalapplications/yoursbrightlyai/commit/e7c23e1ca6474015ca21da2b4e320ed8569b56db))
- add linking paths for tab screens ([f0d1e25](https://github.com/equationalapplications/yoursbrightlyai/commit/f0d1e25be77f71c1f880ba601b0c256867482b19))
- useAuthSignInWithCredential ([7f75370](https://github.com/equationalapplications/yoursbrightlyai/commit/7f753707a7f920f73f413818a2d43f9410bfaeef))

# [4.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v4.0.0...v4.1.0-staging.1) (2023-03-13)

### Bug Fixes

- add comma after prefix ([4cfd1c7](https://github.com/equationalapplications/yoursbrightlyai/commit/4cfd1c740424d3ecf83543c24ff6df3a3138b964))
- add key to navigation groups ([12193b3](https://github.com/equationalapplications/yoursbrightlyai/commit/12193b35e936407b479b6bebc7c87ee675e8f62f))
- add uid to useAuthUser key ([0bb9e8d](https://github.com/equationalapplications/yoursbrightlyai/commit/0bb9e8d86932054fb0c9db33f459e1a2a2798fbe))
- add uid to useAuthUser key ([1d69fed](https://github.com/equationalapplications/yoursbrightlyai/commit/1d69fedf1058601bbeb6e834a720fd4eee91f4bd))

### Features

- add default avatar url ([e7c23e1](https://github.com/equationalapplications/yoursbrightlyai/commit/e7c23e1ca6474015ca21da2b4e320ed8569b56db))
- add linking paths for tab screens ([f0d1e25](https://github.com/equationalapplications/yoursbrightlyai/commit/f0d1e25be77f71c1f880ba601b0c256867482b19))
- useAuthSignInWithCredential ([7f75370](https://github.com/equationalapplications/yoursbrightlyai/commit/7f753707a7f920f73f413818a2d43f9410bfaeef))

# [4.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v3.2.0...v4.0.0) (2023-03-12)

### Bug Fixes

- the last commit changed metro config ([53041af](https://github.com/equationalapplications/yoursbrightlyai/commit/53041afb5b930110fdb18bc878f9e464992e4b2e))
- use {uri: url} for avatar image source ([8f38a32](https://github.com/equationalapplications/yoursbrightlyai/commit/8f38a32430dd1ec140b2db504863d6d21b0cbbb4))
- use firebase signInWithCredential ([fcd480b](https://github.com/equationalapplications/yoursbrightlyai/commit/fcd480bc3ea8a66f8881d2b70abe5ea557c493b3))

### BREAKING CHANGES

- changes to metro config changes build

# [4.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v3.2.0...v4.0.0-staging.1) (2023-03-12)

### Bug Fixes

- the last commit changed metro config ([53041af](https://github.com/equationalapplications/yoursbrightlyai/commit/53041afb5b930110fdb18bc878f9e464992e4b2e))
- use {uri: url} for avatar image source ([8f38a32](https://github.com/equationalapplications/yoursbrightlyai/commit/8f38a32430dd1ec140b2db504863d6d21b0cbbb4))
- use firebase signInWithCredential ([fcd480b](https://github.com/equationalapplications/yoursbrightlyai/commit/fcd480bc3ea8a66f8881d2b70abe5ea557c493b3))

### BREAKING CHANGES

- changes to metro config changes build

# [3.2.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v3.1.0...v3.2.0) (2023-03-11)

### Bug Fixes

- update state when character data changes ([8715ecb](https://github.com/equationalapplications/yoursbrightlyai/commit/8715ecbcde6946f60829360a042c73567b1bd346))
- updateCharacter during useEffect ([c06371c](https://github.com/equationalapplications/yoursbrightlyai/commit/c06371c67c495cd889e1cedc4ac8a54454ce5f66))

### Features

- add loading indicator for image ([c440232](https://github.com/equationalapplications/yoursbrightlyai/commit/c440232fe686d07215977479816c93fadc350606))

# [3.2.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v3.1.0...v3.2.0-staging.1) (2023-03-11)

### Bug Fixes

- update state when character data changes ([8715ecb](https://github.com/equationalapplications/yoursbrightlyai/commit/8715ecbcde6946f60829360a042c73567b1bd346))
- updateCharacter during useEffect ([c06371c](https://github.com/equationalapplications/yoursbrightlyai/commit/c06371c67c495cd889e1cedc4ac8a54454ce5f66))

### Features

- add loading indicator for image ([c440232](https://github.com/equationalapplications/yoursbrightlyai/commit/c440232fe686d07215977479816c93fadc350606))

# [3.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v3.0.0...v3.1.0) (2023-03-10)

### Bug Fixes

- use default TypeScript config ([5f77334](https://github.com/equationalapplications/yoursbrightlyai/commit/5f77334e0ab107c75efd55a68125b87cb4c63e9b))

### Features

- use CustomDefaultTheme ([e63e063](https://github.com/equationalapplications/yoursbrightlyai/commit/e63e063a8feae6715d6898a1e69737546d1e02f1))

# [3.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v3.0.0...v3.1.0-staging.1) (2023-03-10)

### Bug Fixes

- use default TypeScript config ([5f77334](https://github.com/equationalapplications/yoursbrightlyai/commit/5f77334e0ab107c75efd55a68125b87cb4c63e9b))

### Features

- use CustomDefaultTheme ([e63e063](https://github.com/equationalapplications/yoursbrightlyai/commit/e63e063a8feae6715d6898a1e69737546d1e02f1))

# [3.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v2.1.0...v3.0.0) (2023-03-08)

### Bug Fixes

- add android intentFilter for facebook auth ([c3aa83d](https://github.com/equationalapplications/yoursbrightlyai/commit/c3aa83de4e80aa0c75db09530de50836dc6e4945))

### BREAKING CHANGES

- scheme is needed when creating a development build

# [3.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v2.1.0...v3.0.0-staging.1) (2023-03-08)

### Bug Fixes

- add android intentFilter for facebook auth ([c3aa83d](https://github.com/equationalapplications/yoursbrightlyai/commit/c3aa83de4e80aa0c75db09530de50836dc6e4945))

### BREAKING CHANGES

- scheme is needed when creating a development build

# [2.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v2.0.0...v2.1.0) (2023-03-07)

### Bug Fixes

- roll back expo-linking ([529ffa2](https://github.com/equationalapplications/yoursbrightlyai/commit/529ffa209dcda60074cc47dd4b95ae30f06bdb5c))
- roll back to default file ([e421c51](https://github.com/equationalapplications/yoursbrightlyai/commit/e421c51ff4331ab3a1573db2d3d386410b0a7937))
- scheme remove array ([97e3ff2](https://github.com/equationalapplications/yoursbrightlyai/commit/97e3ff23ceafe5eaf21d7ed6261c14317c82f90f))
- use expo doctor to update expo-linking ([6b0ebce](https://github.com/equationalapplications/yoursbrightlyai/commit/6b0ebce2024b85f7c5fab445081c44cf53550cdf))

### Features

- add android intentFilters ([0aedfa7](https://github.com/equationalapplications/yoursbrightlyai/commit/0aedfa7b7c57b4aebf324e3bde96a40eff517518))
- add multiline 3 ([fa48379](https://github.com/equationalapplications/yoursbrightlyai/commit/fa4837918eb362ea1452ad5b8f2c364d0d9359ae))
- disable provider login buttons until request ready ([f389cd3](https://github.com/equationalapplications/yoursbrightlyai/commit/f389cd3b087e31cdd29f61a8a93386b6476faea4))

# [2.1.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v2.0.0...v2.1.0-staging.1) (2023-03-07)

### Bug Fixes

- roll back expo-linking ([529ffa2](https://github.com/equationalapplications/yoursbrightlyai/commit/529ffa209dcda60074cc47dd4b95ae30f06bdb5c))
- roll back to default file ([e421c51](https://github.com/equationalapplications/yoursbrightlyai/commit/e421c51ff4331ab3a1573db2d3d386410b0a7937))
- scheme remove array ([97e3ff2](https://github.com/equationalapplications/yoursbrightlyai/commit/97e3ff23ceafe5eaf21d7ed6261c14317c82f90f))
- use expo doctor to update expo-linking ([6b0ebce](https://github.com/equationalapplications/yoursbrightlyai/commit/6b0ebce2024b85f7c5fab445081c44cf53550cdf))

### Features

- add android intentFilters ([0aedfa7](https://github.com/equationalapplications/yoursbrightlyai/commit/0aedfa7b7c57b4aebf324e3bde96a40eff517518))
- add multiline 3 ([fa48379](https://github.com/equationalapplications/yoursbrightlyai/commit/fa4837918eb362ea1452ad5b8f2c364d0d9359ae))
- disable provider login buttons until request ready ([f389cd3](https://github.com/equationalapplications/yoursbrightlyai/commit/f389cd3b087e31cdd29f61a8a93386b6476faea4))

# [2.0.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.15.0...v2.0.0) (2023-03-05)

### Bug Fixes

- add facebook scheme ([288b743](https://github.com/equationalapplications/yoursbrightlyai/commit/288b7438d12d2a6198835bee3183de55cf8fa2a3))

### BREAKING CHANGES

- new version of expo-linking and updated app scheme

# [2.0.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.15.0...v2.0.0-staging.1) (2023-03-05)

### Bug Fixes

- add facebook scheme ([288b743](https://github.com/equationalapplications/yoursbrightlyai/commit/288b7438d12d2a6198835bee3183de55cf8fa2a3))

### BREAKING CHANGES

- new version of expo-linking and updated app scheme

# [1.15.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.14.0...v1.15.0) (2023-03-05)

### Bug Fixes

- add state to TextInput to avoid jerky UI ([3875dc4](https://github.com/equationalapplications/yoursbrightlyai/commit/3875dc44364df9da81afbaf8af8c8add1da822cb))
- call hooks in function ([2f6620c](https://github.com/equationalapplications/yoursbrightlyai/commit/2f6620ceb5c031fe23577c9a340d53ffbeba32f8))
- scrollview style ([09a2281](https://github.com/equationalapplications/yoursbrightlyai/commit/09a22810706ccc7f0b107d38c37834751dd22afa))
- scrollview style ([06b1f08](https://github.com/equationalapplications/yoursbrightlyai/commit/06b1f08ef9ec3bc290e58bef8bf30706bebce790))

### Features

- add erase memory ([4d9cd9f](https://github.com/equationalapplications/yoursbrightlyai/commit/4d9cd9fe86ea1b0717cf3d36c785630f76a801fc))
- add mulitline TextInput ([8258f9d](https://github.com/equationalapplications/yoursbrightlyai/commit/8258f9d1470178fecfa288f21a64b1010cd6fc6c))
- update privacy policy ([fb16100](https://github.com/equationalapplications/yoursbrightlyai/commit/fb16100731cfde88625c7c3955d9fcd4fce0f516))
- use contained buttons ([9575d54](https://github.com/equationalapplications/yoursbrightlyai/commit/9575d54e37f0eb8cf5e06edcf1aca6c021f579dc))

# [1.15.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.14.0...v1.15.0-staging.1) (2023-03-05)

### Bug Fixes

- add state to TextInput to avoid jerky UI ([3875dc4](https://github.com/equationalapplications/yoursbrightlyai/commit/3875dc44364df9da81afbaf8af8c8add1da822cb))
- call hooks in function ([2f6620c](https://github.com/equationalapplications/yoursbrightlyai/commit/2f6620ceb5c031fe23577c9a340d53ffbeba32f8))
- scrollview style ([09a2281](https://github.com/equationalapplications/yoursbrightlyai/commit/09a22810706ccc7f0b107d38c37834751dd22afa))
- scrollview style ([06b1f08](https://github.com/equationalapplications/yoursbrightlyai/commit/06b1f08ef9ec3bc290e58bef8bf30706bebce790))

### Features

- add erase memory ([4d9cd9f](https://github.com/equationalapplications/yoursbrightlyai/commit/4d9cd9fe86ea1b0717cf3d36c785630f76a801fc))
- add mulitline TextInput ([8258f9d](https://github.com/equationalapplications/yoursbrightlyai/commit/8258f9d1470178fecfa288f21a64b1010cd6fc6c))
- update privacy policy ([fb16100](https://github.com/equationalapplications/yoursbrightlyai/commit/fb16100731cfde88625c7c3955d9fcd4fce0f516))
- use contained buttons ([9575d54](https://github.com/equationalapplications/yoursbrightlyai/commit/9575d54e37f0eb8cf5e06edcf1aca6c021f579dc))

# [1.14.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.13.0...v1.14.0) (2023-03-01)

### Features

- add get image button ([3a1e11c](https://github.com/equationalapplications/yoursbrightlyai/commit/3a1e11ce78e2453bda44e8fc9a1de63525c4dc59))

# [1.14.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.13.0...v1.14.0-staging.1) (2023-03-01)

### Features

- add get image button ([3a1e11c](https://github.com/equationalapplications/yoursbrightlyai/commit/3a1e11ce78e2453bda44e8fc9a1de63525c4dc59))

# [1.13.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.12.0...v1.13.0) (2023-03-01)

### Features

- can edit character ([94a1e42](https://github.com/equationalapplications/yoursbrightlyai/commit/94a1e42e39b61e745b5072d7e68b1ceda2b51ad7))

# [1.13.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.12.0...v1.13.0-staging.1) (2023-03-01)

### Features

- can edit character ([94a1e42](https://github.com/equationalapplications/yoursbrightlyai/commit/94a1e42e39b61e745b5072d7e68b1ceda2b51ad7))

# [1.12.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.11.0...v1.12.0) (2023-02-27)

### Features

- add Terms and Conditions and Privacy Policy ([fd08f12](https://github.com/equationalapplications/yoursbrightlyai/commit/fd08f12055d79b3716fbefafa23eb0fefb212b07))
- update terms and privacy. run lint ([92c8e3f](https://github.com/equationalapplications/yoursbrightlyai/commit/92c8e3f4d4c033f1aeea2dc172ee6dfa75900dab))

# [1.12.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.11.0...v1.12.0-staging.1) (2023-02-27)

### Features

- add Terms and Conditions and Privacy Policy ([fd08f12](https://github.com/equationalapplications/yoursbrightlyai/commit/fd08f12055d79b3716fbefafa23eb0fefb212b07))
- update terms and privacy. run lint ([92c8e3f](https://github.com/equationalapplications/yoursbrightlyai/commit/92c8e3f4d4c033f1aeea2dc172ee6dfa75900dab))

# [1.11.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.10.0...v1.11.0) (2023-02-26)

### Bug Fixes

- add linking for signin and paywall ([e8dd7fc](https://github.com/equationalapplications/yoursbrightlyai/commit/e8dd7fc8d302bbecd616ba1f4397342a9b71e028))
- compare with uid ([1332125](https://github.com/equationalapplications/yoursbrightlyai/commit/1332125df9a440f174f166f447fe6fdd8b8f4269))
- correct display name ([2c15142](https://github.com/equationalapplications/yoursbrightlyai/commit/2c15142406b63a2beccbf9e73bff5e92c28babbd))
- import expo-random ([a34fb2a](https://github.com/equationalapplications/yoursbrightlyai/commit/a34fb2a8300ef0cda37769a69086a4588bef2d3e))
- make SignIn the initial route ([1086176](https://github.com/equationalapplications/yoursbrightlyai/commit/1086176b4a6f3941eb90a26c738191c1424b328c))
- scale adaptive-icon to 512 x 512 ([662c2a1](https://github.com/equationalapplications/yoursbrightlyai/commit/662c2a1b137b155d2c26bb1ae935dcdc0c0c6678))
- scale image layer to fit ([7e9a920](https://github.com/equationalapplications/yoursbrightlyai/commit/7e9a920d0854e31084ffe6d6123007121a0e582e))
- sort messages by createAt ([5004362](https://github.com/equationalapplications/yoursbrightlyai/commit/5004362c2290233ec24529df9151ae10c7cb5fff))
- subscribe to firestore messages ([67c1d74](https://github.com/equationalapplications/yoursbrightlyai/commit/67c1d74b539c75e22b808d61d42ebb72cc3f9053))
- update title and icon ([d3b269f](https://github.com/equationalapplications/yoursbrightlyai/commit/d3b269f78e926f8760845f8696eb17d402f22475))

### Features

- add Button component from paper login template ([ccc95b5](https://github.com/equationalapplications/yoursbrightlyai/commit/ccc95b558b2d1ec0b8469738c45d11150385d86f))
- add ErrorBoundary ([a54d74d](https://github.com/equationalapplications/yoursbrightlyai/commit/a54d74d153c133ee83321d0387528820001eaff4))
- add gifted chat ([a343fae](https://github.com/equationalapplications/yoursbrightlyai/commit/a343faed06803608ed2cc71718c976ed6e10cf5d))
- add golden color scheme ([b96707b](https://github.com/equationalapplications/yoursbrightlyai/commit/b96707b1b38b2c89a31b91ade558406f5fc9b1a1))
- add Logo component. display on SignIn ([b3f72dc](https://github.com/equationalapplications/yoursbrightlyai/commit/b3f72dc1e82b23ce8524f2258d2867cd44d2dd34))
- add openai function ([60e7128](https://github.com/equationalapplications/yoursbrightlyai/commit/60e7128a9e272e6690690ad26d8412aa5c6d845b))
- create TitleText component. add it to SignIn ([9f55cca](https://github.com/equationalapplications/yoursbrightlyai/commit/9f55cca4c0880442f5ace338fd83fbfb01a38adf))
- export firestore ([d2839ab](https://github.com/equationalapplications/yoursbrightlyai/commit/d2839ab04178a5e4e4149c41752d8bcaee875fb8))
- firebase init firestore ([e43d87e](https://github.com/equationalapplications/yoursbrightlyai/commit/e43d87e2b89d1be7cf1f70c3f990763adb2c5f4e))
- firebase init functions ([84381cb](https://github.com/equationalapplications/yoursbrightlyai/commit/84381cb32200cf0ef4988a394f8efa25c0770d0b))
- show user avatar ([67549ea](https://github.com/equationalapplications/yoursbrightlyai/commit/67549ea0f59bc617a75d6553046d6aec41a52609))
- title "Settings". add logout button ([8356aae](https://github.com/equationalapplications/yoursbrightlyai/commit/8356aae0d1de653a99afee936a4c48faa046a70d))
- title "Subscribe". remove EditScreenInfo ([a698564](https://github.com/equationalapplications/yoursbrightlyai/commit/a698564bbd03368c7c16db22028db56928a2283a))
- title modal as "Subscribe" ([d0e3f95](https://github.com/equationalapplications/yoursbrightlyai/commit/d0e3f9541fdf5f7406c4746d63b0365482f36aa6))
- use transparent adaptive icon background ([5ee7c96](https://github.com/equationalapplications/yoursbrightlyai/commit/5ee7c96ab5cb68cb88ad3b43ef36af8d6c445dd5))

# [1.11.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.10.0...v1.11.0-staging.1) (2023-02-26)

### Bug Fixes

- add linking for signin and paywall ([e8dd7fc](https://github.com/equationalapplications/yoursbrightlyai/commit/e8dd7fc8d302bbecd616ba1f4397342a9b71e028))
- compare with uid ([1332125](https://github.com/equationalapplications/yoursbrightlyai/commit/1332125df9a440f174f166f447fe6fdd8b8f4269))
- correct display name ([2c15142](https://github.com/equationalapplications/yoursbrightlyai/commit/2c15142406b63a2beccbf9e73bff5e92c28babbd))
- import expo-random ([a34fb2a](https://github.com/equationalapplications/yoursbrightlyai/commit/a34fb2a8300ef0cda37769a69086a4588bef2d3e))
- make SignIn the initial route ([1086176](https://github.com/equationalapplications/yoursbrightlyai/commit/1086176b4a6f3941eb90a26c738191c1424b328c))
- scale adaptive-icon to 512 x 512 ([662c2a1](https://github.com/equationalapplications/yoursbrightlyai/commit/662c2a1b137b155d2c26bb1ae935dcdc0c0c6678))
- scale image layer to fit ([7e9a920](https://github.com/equationalapplications/yoursbrightlyai/commit/7e9a920d0854e31084ffe6d6123007121a0e582e))
- sort messages by createAt ([5004362](https://github.com/equationalapplications/yoursbrightlyai/commit/5004362c2290233ec24529df9151ae10c7cb5fff))
- subscribe to firestore messages ([67c1d74](https://github.com/equationalapplications/yoursbrightlyai/commit/67c1d74b539c75e22b808d61d42ebb72cc3f9053))
- update title and icon ([d3b269f](https://github.com/equationalapplications/yoursbrightlyai/commit/d3b269f78e926f8760845f8696eb17d402f22475))

### Features

- add Button component from paper login template ([ccc95b5](https://github.com/equationalapplications/yoursbrightlyai/commit/ccc95b558b2d1ec0b8469738c45d11150385d86f))
- add ErrorBoundary ([a54d74d](https://github.com/equationalapplications/yoursbrightlyai/commit/a54d74d153c133ee83321d0387528820001eaff4))
- add gifted chat ([a343fae](https://github.com/equationalapplications/yoursbrightlyai/commit/a343faed06803608ed2cc71718c976ed6e10cf5d))
- add golden color scheme ([b96707b](https://github.com/equationalapplications/yoursbrightlyai/commit/b96707b1b38b2c89a31b91ade558406f5fc9b1a1))
- add Logo component. display on SignIn ([b3f72dc](https://github.com/equationalapplications/yoursbrightlyai/commit/b3f72dc1e82b23ce8524f2258d2867cd44d2dd34))
- add openai function ([60e7128](https://github.com/equationalapplications/yoursbrightlyai/commit/60e7128a9e272e6690690ad26d8412aa5c6d845b))
- create TitleText component. add it to SignIn ([9f55cca](https://github.com/equationalapplications/yoursbrightlyai/commit/9f55cca4c0880442f5ace338fd83fbfb01a38adf))
- export firestore ([d2839ab](https://github.com/equationalapplications/yoursbrightlyai/commit/d2839ab04178a5e4e4149c41752d8bcaee875fb8))
- firebase init firestore ([e43d87e](https://github.com/equationalapplications/yoursbrightlyai/commit/e43d87e2b89d1be7cf1f70c3f990763adb2c5f4e))
- firebase init functions ([84381cb](https://github.com/equationalapplications/yoursbrightlyai/commit/84381cb32200cf0ef4988a394f8efa25c0770d0b))
- show user avatar ([67549ea](https://github.com/equationalapplications/yoursbrightlyai/commit/67549ea0f59bc617a75d6553046d6aec41a52609))
- title "Settings". add logout button ([8356aae](https://github.com/equationalapplications/yoursbrightlyai/commit/8356aae0d1de653a99afee936a4c48faa046a70d))
- title "Subscribe". remove EditScreenInfo ([a698564](https://github.com/equationalapplications/yoursbrightlyai/commit/a698564bbd03368c7c16db22028db56928a2283a))
- title modal as "Subscribe" ([d0e3f95](https://github.com/equationalapplications/yoursbrightlyai/commit/d0e3f9541fdf5f7406c4746d63b0365482f36aa6))
- use transparent adaptive icon background ([5ee7c96](https://github.com/equationalapplications/yoursbrightlyai/commit/5ee7c96ab5cb68cb88ad3b43ef36af8d6c445dd5))

# [1.10.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.9.0...v1.10.0) (2023-02-04)

### Bug Fixes

- remove duplicate key ([e7555c0](https://github.com/equationalapplications/yoursbrightlyai/commit/e7555c00ff4e528a1232bb3e6499db8b483da378))

### Features

- add app icon ([a62fa14](https://github.com/equationalapplications/yoursbrightlyai/commit/a62fa1438f7ba792804512f4f480be7c0e5a82ff))
- support for auto dark / light mode ([6f27b38](https://github.com/equationalapplications/yoursbrightlyai/commit/6f27b383e6ee554089a4adc75d678978debc1d3d))
- use uid for Purchases appUserID ([573b2db](https://github.com/equationalapplications/yoursbrightlyai/commit/573b2db99742b95d8471ad0bd0a8471d0c4ef01a))

# [1.10.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.9.0...v1.10.0-staging.1) (2023-02-04)

### Bug Fixes

- remove duplicate key ([e7555c0](https://github.com/equationalapplications/yoursbrightlyai/commit/e7555c00ff4e528a1232bb3e6499db8b483da378))

### Features

- add app icon ([a62fa14](https://github.com/equationalapplications/yoursbrightlyai/commit/a62fa1438f7ba792804512f4f480be7c0e5a82ff))
- support for auto dark / light mode ([6f27b38](https://github.com/equationalapplications/yoursbrightlyai/commit/6f27b383e6ee554089a4adc75d678978debc1d3d))
- use uid for Purchases appUserID ([573b2db](https://github.com/equationalapplications/yoursbrightlyai/commit/573b2db99742b95d8471ad0bd0a8471d0c4ef01a))

# [1.9.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.8.0...v1.9.0) (2023-02-01)

### Features

- add paywall screen with purchases ([e5c34dd](https://github.com/equationalapplications/yoursbrightlyai/commit/e5c34ddb958e46cd5d5115125d6d8173919b855a))

# [1.9.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.8.0...v1.9.0-staging.1) (2023-02-01)

### Features

- add paywall screen with purchases ([e5c34dd](https://github.com/equationalapplications/yoursbrightlyai/commit/e5c34ddb958e46cd5d5115125d6d8173919b855a))

# [1.8.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.7.0...v1.8.0) (2023-01-28)

### Features

- add expo-dev-client ([5f0725a](https://github.com/equationalapplications/yoursbrightlyai/commit/5f0725a91ae7a920476b1ae3e7cc4f5918a35003))
- add facebook login button ([dc11d9a](https://github.com/equationalapplications/yoursbrightlyai/commit/dc11d9a02c4d81da1e30505ee6c79215d066c02c))
- add react-native-fbsdk-next ([2bb21ea](https://github.com/equationalapplications/yoursbrightlyai/commit/2bb21eaa8beb7b94a23feab76d43788b35bc089e))
- add signin with FacebookAuthProvider ([1d12f0a](https://github.com/equationalapplications/yoursbrightlyai/commit/1d12f0a7dfea44e822312b773dcc5f0b9ffce0ff))

# [1.8.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.7.0...v1.8.0-staging.1) (2023-01-28)

### Features

- add expo-dev-client ([5f0725a](https://github.com/equationalapplications/yoursbrightlyai/commit/5f0725a91ae7a920476b1ae3e7cc4f5918a35003))
- add facebook login button ([dc11d9a](https://github.com/equationalapplications/yoursbrightlyai/commit/dc11d9a02c4d81da1e30505ee6c79215d066c02c))
- add react-native-fbsdk-next ([2bb21ea](https://github.com/equationalapplications/yoursbrightlyai/commit/2bb21eaa8beb7b94a23feab76d43788b35bc089e))
- add signin with FacebookAuthProvider ([1d12f0a](https://github.com/equationalapplications/yoursbrightlyai/commit/1d12f0a7dfea44e822312b773dcc5f0b9ffce0ff))

# [1.7.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.6.0...v1.7.0) (2023-01-25)

### Bug Fixes

- add peer dependency for google auth ([49001e3](https://github.com/equationalapplications/yoursbrightlyai/commit/49001e3ee0b302cb208249e85a85cf8d476b6398))
- remove unneeded createaccount screen ([3112196](https://github.com/equationalapplications/yoursbrightlyai/commit/31121968d528d78b22736a125fb0bf4c7372aaa6))

### Features

- add GoogleAuthProvider ([26b6426](https://github.com/equationalapplications/yoursbrightlyai/commit/26b6426bbcc2fc97a64d75bc6f3df61d332c9a91))
- useAuthSignInWithCredential ([fbdb244](https://github.com/equationalapplications/yoursbrightlyai/commit/fbdb244bdcb96225cfed65c0b8ec8a161ea1e17d))

# [1.7.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.6.0...v1.7.0-staging.1) (2023-01-25)

### Bug Fixes

- add peer dependency for google auth ([49001e3](https://github.com/equationalapplications/yoursbrightlyai/commit/49001e3ee0b302cb208249e85a85cf8d476b6398))
- remove unneeded createaccount screen ([3112196](https://github.com/equationalapplications/yoursbrightlyai/commit/31121968d528d78b22736a125fb0bf4c7372aaa6))

### Features

- add GoogleAuthProvider ([26b6426](https://github.com/equationalapplications/yoursbrightlyai/commit/26b6426bbcc2fc97a64d75bc6f3df61d332c9a91))
- useAuthSignInWithCredential ([fbdb244](https://github.com/equationalapplications/yoursbrightlyai/commit/fbdb244bdcb96225cfed65c0b8ec8a161ea1e17d))

# [1.6.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.5.0...v1.6.0) (2023-01-24)

### Features

- add protected navigation routes ([0590e2f](https://github.com/equationalapplications/yoursbrightlyai/commit/0590e2f6043560f27d8138499a7fd1c9fa5baf8b))

# [1.6.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.5.0...v1.6.0-staging.1) (2023-01-24)

### Features

- add protected navigation routes ([0590e2f](https://github.com/equationalapplications/yoursbrightlyai/commit/0590e2f6043560f27d8138499a7fd1c9fa5baf8b))

# [1.5.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.4.0...v1.5.0) (2023-01-16)

### Features

- add react query firebase ([7efa8d8](https://github.com/equationalapplications/yoursbrightlyai/commit/7efa8d87bdafb7d1ffbc77b4d25a05e05084353b))
- install react-query firebase ([0017d76](https://github.com/equationalapplications/yoursbrightlyai/commit/0017d7693b1e50c226a3ee0e6fc03801650c76fd))

# [1.5.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.4.0...v1.5.0-staging.1) (2023-01-15)

### Features

- add react query firebase ([7efa8d8](https://github.com/equationalapplications/yoursbrightlyai/commit/7efa8d87bdafb7d1ffbc77b4d25a05e05084353b))
- install react-query firebase ([0017d76](https://github.com/equationalapplications/yoursbrightlyai/commit/0017d7693b1e50c226a3ee0e6fc03801650c76fd))

# [1.4.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.3.0...v1.4.0) (2023-01-12)

### Bug Fixes

- adapt login for navigation ([aa44471](https://github.com/equationalapplications/yoursbrightlyai/commit/aa44471710af9f4aa2e68854b1de01063cac55a1))

### Features

- add callstack login template ([170e884](https://github.com/equationalapplications/yoursbrightlyai/commit/170e8849511c6ae8954814fa95d62c09d1768fb5))
- add deps for login and redux ([9db8a86](https://github.com/equationalapplications/yoursbrightlyai/commit/9db8a86e81e8e6a81b02b66e684e16c060229773))
- add root navigator ([801be12](https://github.com/equationalapplications/yoursbrightlyai/commit/801be12a45e6b97790f551e4173baa922de762ba))
- add support for web ([4e28147](https://github.com/equationalapplications/yoursbrightlyai/commit/4e281471c54ab8c36073804b21d369ffbbe71f5a))
- install @react-navigation/native-stack ([1cfbca8](https://github.com/equationalapplications/yoursbrightlyai/commit/1cfbca85cd20d9b41be62e6e4178ce3fcfc5e6d1))

# [1.4.0-staging.2](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.4.0-staging.1...v1.4.0-staging.2) (2023-01-12)

### Features

- add support for web ([4e28147](https://github.com/equationalapplications/yoursbrightlyai/commit/4e281471c54ab8c36073804b21d369ffbbe71f5a))

# [1.4.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.3.0...v1.4.0-staging.1) (2023-01-10)

### Bug Fixes

- adapt login for navigation ([aa44471](https://github.com/equationalapplications/yoursbrightlyai/commit/aa44471710af9f4aa2e68854b1de01063cac55a1))

### Features

- add callstack login template ([170e884](https://github.com/equationalapplications/yoursbrightlyai/commit/170e8849511c6ae8954814fa95d62c09d1768fb5))
- add deps for login and redux ([9db8a86](https://github.com/equationalapplications/yoursbrightlyai/commit/9db8a86e81e8e6a81b02b66e684e16c060229773))
- add root navigator ([801be12](https://github.com/equationalapplications/yoursbrightlyai/commit/801be12a45e6b97790f551e4173baa922de762ba))
- install @react-navigation/native-stack ([1cfbca8](https://github.com/equationalapplications/yoursbrightlyai/commit/1cfbca85cd20d9b41be62e6e4178ce3fcfc5e6d1))

# [1.3.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.2.0...v1.3.0) (2023-01-06)

### Features

- add react navigation and deps ([4601c00](https://github.com/equationalapplications/yoursbrightlyai/commit/4601c000c69f5995b52d1bc95923fdc5194357a8))

# [1.3.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.2.0...v1.3.0-staging.1) (2023-01-06)

### Features

- add react navigation and deps ([4601c00](https://github.com/equationalapplications/yoursbrightlyai/commit/4601c000c69f5995b52d1bc95923fdc5194357a8))

# [1.2.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.1.0...v1.2.0) (2023-01-06)

### Features

- add eslint and prettier ([420a727](https://github.com/equationalapplications/yoursbrightlyai/commit/420a7278814409deef97c1257562f3ab7810b61e))

# [1.2.0-staging.1](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.1.0...v1.2.0-staging.1) (2023-01-06)

### Features

- add eslint and prettier ([420a727](https://github.com/equationalapplications/yoursbrightlyai/commit/420a7278814409deef97c1257562f3ab7810b61e))

# [1.1.0](https://github.com/equationalapplications/yoursbrightlyai/compare/v1.0.0...v1.1.0) (2023-01-05)

### Features

- add firebase libraries ([34d7ff1](https://github.com/equationalapplications/yoursbrightlyai/commit/34d7ff1ef485b53cd6e1cfb124444de0a8405187))

# 1.0.0 (2023-01-05)

### Bug Fixes

- remove duplicate entries ([aabe43e](https://github.com/equationalapplications/yoursbrightlyai/commit/aabe43e903ba2dbb6c3f520d85f4c9089607c067))
- remove incorrect expo-build-properties ([ce5fed2](https://github.com/equationalapplications/yoursbrightlyai/commit/ce5fed27c6c28d9a03ba0989533c3b87f0fceee6))

### Features

- install dev deps ([9a6954c](https://github.com/equationalapplications/yoursbrightlyai/commit/9a6954cba562dde5ace96f658a3c9e6108fb0a32))
- install expo ([497073a](https://github.com/equationalapplications/yoursbrightlyai/commit/497073a3a025c542e1a2bba179b88796c23ca55e))
- install husky and commit lint ([a22d174](https://github.com/equationalapplications/yoursbrightlyai/commit/a22d174174e31a40733149c0b27192c2bc1e4ded))
- install husky and commit lint ([c05bc4b](https://github.com/equationalapplications/yoursbrightlyai/commit/c05bc4b80c9ec8a69196b777c1298433c03fb310))
- npx eas-cli build:configure ([47d3773](https://github.com/equationalapplications/yoursbrightlyai/commit/47d37734005038761adb72f25608de35185693d9))
- npx expo install @react-native-firebase/app ([9cd05ad](https://github.com/equationalapplications/yoursbrightlyai/commit/9cd05adc5bdce86ef0fdb44170cddc4a6cacfbdb))
- npx expo install dotenv ([d3a8a3e](https://github.com/equationalapplications/yoursbrightlyai/commit/d3a8a3e4fdaa2abd50ec39506207ed452759653b))
- npx expo install expo-build-properties ([e4a692a](https://github.com/equationalapplications/yoursbrightlyai/commit/e4a692ac3c94ff38d4ba3634f334b496715a88d8))
- npx expo install expo-constants ([a35d547](https://github.com/equationalapplications/yoursbrightlyai/commit/a35d54760979b7db665fa7a950d25f80ec38f854))
- npx expo install expo-dev-client ([0429f7b](https://github.com/equationalapplications/yoursbrightlyai/commit/0429f7b36c2bd9d14fe0e0f974bd32c636ea44dc))
