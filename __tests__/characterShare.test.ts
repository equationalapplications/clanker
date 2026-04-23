import { buildCharacterShareUrl } from '~/utilities/characterShare'

describe('characterShare', () => {
  const originalShareBaseUrl = process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL

  afterEach(() => {
    if (originalShareBaseUrl === undefined) {
      delete process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL
      return
    }

    process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL = originalShareBaseUrl
  })

  test('defaults to clanker.app when share base URL is not configured', () => {
    delete process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL

    expect(buildCharacterShareUrl('abc 123')).toBe(
      'https://clanker.app/characters/shared/abc%20123',
    )
  })

  test('uses configured share base URL and trims trailing slashes', () => {
    process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL = 'https://example.com///'

    expect(buildCharacterShareUrl('abc')).toBe('https://example.com/characters/shared/abc')
  })
})
