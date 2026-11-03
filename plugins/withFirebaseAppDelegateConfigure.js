// JS twin of withFirebaseAppDelegateConfigure.ts (kept in sync; see the .ts
// file for the rationale). Expo loads whichever resolves for the loader in use.
const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

module.exports = function withFirebaseAppDelegateConfigure(config) {
  return withDangerousMod(config, [
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
}
