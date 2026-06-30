import { getYouTubeEmbedUrl } from '~/config/marketingConfig'

describe('getYouTubeEmbedUrl', () => {
  it('parses youtube.com watch URLs', () => {
    expect(getYouTubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
  })

  it('parses youtu.be share URLs', () => {
    expect(getYouTubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    )
  })

  it('parses youtube shorts URLs', () => {
    expect(getYouTubeEmbedUrl('https://www.youtube.com/shorts/abc123xyz')).toBe(
      'https://www.youtube.com/embed/abc123xyz',
    )
  })

  it('returns null for empty or invalid URLs', () => {
    expect(getYouTubeEmbedUrl('')).toBeNull()
    expect(getYouTubeEmbedUrl('https://example.com/video')).toBeNull()
  })
})
