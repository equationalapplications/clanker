// jest.setup.dom.js — runs ONLY in the 'dom' (jsdom) jest project, after the
// RN preset setup. See jest.config.js for the project split.
//
// Expo's winter runtime installs lazy getters on globalThis (TextEncoderStream,
// TextDecoderStream, URL, URLSearchParams, DOMException, structuredClone, …)
// that `require()` their implementation on first access. Jest 30 forbids
// `require` between tests ("You are trying to `require` a file outside of the
// scope of the test code"), and jsdom code paths touch these globals during
// test teardown — so materialize them eagerly here, while requires are legal.
const LAZY_WINTER_GLOBALS = [
  'TextDecoderStream',
  'TextEncoderStream',
  'URL',
  'URLSearchParams',
  'DOMException',
  'structuredClone',
  '__ExpoImportMetaRegistry',
  'Headers',
  'Request',
  'Response',
  'fetch',
]

for (const key of LAZY_WINTER_GLOBALS) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
  if (descriptor && typeof descriptor.get === 'function') {
    // Force the lazy getter: caches the value (the getter re-defines the
    // property as a plain value) so no later access requires a module.
    void globalThis[key]
  }
}
