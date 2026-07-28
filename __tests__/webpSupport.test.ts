import { SaveFormat } from 'expo-image-manipulator'

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' },
}))

function loadModule() {
  let mod: typeof import('../src/utilities/webpSupport')
  jest.isolateModules(() => {
    mod = require('../src/utilities/webpSupport')
  })
  return mod!
}

const realDocument = global.document

afterEach(() => {
  global.document = realDocument
  jest.resetModules()
})

function stubCanvas(dataUrl: string | null) {
  global.document = {
    createElement: () => ({
      getContext: () => (dataUrl === null ? null : {}),
      toDataURL: () => dataUrl,
    }),
  } as unknown as Document
}

describe('webpSupport', () => {
  it('reports WebP support when the canvas actually returns a WebP data URI', () => {
    stubCanvas('data:image/webp;base64,UklGRg==')
    const { isWebpSupported, getEncodeTarget } = loadModule()
    expect(isWebpSupported()).toBe(true)
    expect(getEncodeTarget()).toEqual({ format: SaveFormat.WEBP, mimeType: 'image/webp' })
  })

  it('detects the silent PNG fallback and downgrades to JPEG', () => {
    stubCanvas('data:image/png;base64,iVBORw0KGgo=')
    const { isWebpSupported, getEncodeTarget } = loadModule()
    expect(isWebpSupported()).toBe(false)
    expect(getEncodeTarget()).toEqual({ format: SaveFormat.JPEG, mimeType: 'image/jpeg' })
  })

  it('downgrades when there is no 2d context at all', () => {
    stubCanvas(null)
    expect(loadModule().isWebpSupported()).toBe(false)
  })

  it('assumes WebP on native, where there is no document', () => {
    // native has no DOM
    global.document = undefined as unknown as Document
    expect(loadModule().isWebpSupported()).toBe(true)
  })

  it('probes the canvas only once', () => {
    let calls = 0
    global.document = {
      createElement: () => ({
        getContext: () => ({}),
        toDataURL: () => {
          calls += 1
          return 'data:image/webp;base64,UklGRg=='
        },
      }),
    } as unknown as Document
    const { isWebpSupported } = loadModule()
    isWebpSupported()
    isWebpSupported()
    isWebpSupported()
    expect(calls).toBe(1)
  })
})
