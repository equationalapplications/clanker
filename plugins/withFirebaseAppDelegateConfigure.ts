// The `@react-native-firebase/app` Expo plugin inserts `FirebaseApp.configure()`
// into AppDelegate.swift, but its anchors (`self.moduleName = "..."`,
// `factory.startReactNative(`) no longer exist in Expo SDK 58's scene-based
// AppDelegate template, so it skips with only a warning ("Unable to determine
// correct Firebase insertion point") and no Firebase app is ever configured
// natively — FirebaseCore logs COR000005 and JS crashes on `getApp()`.
// Insert the call ourselves, after RNFB's plugin has run.
// Remove once RNFB ships SDK 58-aware anchors: bump @react-native-firebase/*,
// rerun prebuild, and delete this plugin if RNFB's warning no longer appears.
import { withDangerousMod } from '@expo/config-plugins'
import type { ConfigPlugin } from '@expo/config-plugins'
import fs from 'fs'
import path from 'path'

const withFirebaseAppDelegateConfigure: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const appDelegatePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'Clanker',
        'AppDelegate.swift',
      )
      let contents = fs.readFileSync(appDelegatePath, 'utf8')
      if (contents.includes('FirebaseApp.configure()')) {
        return cfg
      }
      if (!contents.includes('return super.application(')) {
        throw new Error(
          'withFirebaseAppDelegateConfigure: no `return super.application(` anchor in AppDelegate.swift — template changed? Revisit this plugin.',
        )
      }
      if (!contents.includes('import FirebaseCore')) {
        contents = contents.replace(/(internal import Expo\n)/, '$1import FirebaseCore\n')
      }
      contents = contents.replace(
        /(\n)(\s*)(return super\.application\()/,
        '$1$2FirebaseApp.configure()\n$1$2$3',
      )
      fs.writeFileSync(appDelegatePath, contents)
      return cfg
    },
  ])

export default withFirebaseAppDelegateConfigure
