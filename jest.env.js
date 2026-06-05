// Custom Jest test environment that ensures __DEV__ is defined
// before any modules (including react-native) are loaded
const NodeEnvironment = require('jest-environment-node')

class CustomEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context)
  }

  async setup() {
    await super.setup()
    // Define __DEV__ before any modules are loaded
    this.global.__DEV__ = true
    globalThis.__DEV__ = true
  }
}

module.exports = CustomEnvironment
