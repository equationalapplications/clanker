// Landing page content — single source of truth for `/` (React) and `/welcome` (static HTML).

import { SITE_BASE } from './siteConfig'

export { SITE_BASE }

export const SITE_META = {
  title: 'Clanker AI — Personal AI Assistant with Real-Time Voice & OKF Memory',
  description:
    'Clanker AI is a personal AI assistant with a personality you design and a memory that never forgets — real-time voice calls, document understanding, live web search, and OKF memory you own and export.',
  keywords:
    'personal AI assistant, Clanker AI, real-time voice AI, AI voice chat, Open Knowledge Format, OKF, Google OKF, AI memory, Obsidian AI, AI characters, export AI character, AI companion, voice assistant',
  canonicalPath: '/welcome',
  ogImage: `${SITE_BASE}/og-image.png`,
  ogImageWidth: 1024,
  ogImageHeight: 500,
  siteName: 'Clanker AI',
} as const

export const JSONLD = {
  softwareApplication: {
    name: 'Clanker AI',
    alternateName: 'Clanker',
    applicationCategory: 'LifestyleApplication',
    operatingSystem: 'iOS, Android, Web',
    description:
      "A personal AI assistant with a personality you design and a memory that never forgets. Talk to it in real time with natural, human-like voice, and it learns from your conversations, documents, and live web search. Own your assistant's memory with Google's Open Knowledge Format (OKF), editable in Obsidian.",
    url: `${SITE_BASE}/welcome`,
    featureList: [
      'Real-time, natural voice calls with AI characters',
      "Import and export character memory with Google's Open Knowledge Format (OKF)",
      'Edit character memories in Markdown editors like Obsidian',
      'Advanced memory that learns from conversation, documents, and web search',
      'Fully open source on GitHub',
    ],
    offers: {
      price: '0',
      priceCurrency: 'USD',
    },
  },
  videoObject: {
    name: 'Clanker vs. The Rest: The Ultimate Hybrid AI Architecture',
    description:
      'See how Clanker AI combines real-time voice, OKF memory export, and advanced learning in one open-source personal AI assistant.',
    thumbnailUrl: 'https://i.ytimg.com/vi/6aictXUK_lw/hqdefault.jpg',
    uploadDate: '2026-06-30T06:44:26-07:00',
    embedUrl: 'https://www.youtube.com/embed/6aictXUK_lw',
    contentUrl: 'https://www.youtube.com/watch?v=6aictXUK_lw',
    publisher: {
      name: 'Equational Applications LLC',
      url: 'https://equationalapplications.com/',
    },
  },
} as const

export const HERO = {
  announcement: {
    text: '✨ New: Images in Chat →',
    href: '/image-generation',
    accessibilityLabel: 'New: Images in chat with your AI character. Learn more.',
  },
  headline: 'Clanker AI',
  tagline: 'A personal AI assistant you design — chat, call, and share your own AI characters',
  signInButtonLabel: 'Sign In',
  signInButtonLabelSignedIn: 'Open App',
  ctaLabelSignedOut: 'Try the App!',
  ctaLabelSignedIn: 'Open App',
  staticPrimaryCtaLabel: 'Try the App',
  staticSecondaryCtaLabel: 'Explore Images in Chat',
  staticBottomCtaHeading: 'Ready to meet your character?',
  staticBottomCtaLabel: 'Get started free',
  signInHref: '/sign-in?redirect=/chat',
} as const

export type LandingFeature = {
  icon: string
  emoji: string
  title: string
  body: string
  learnMoreHref?: string
  isNew?: boolean
}

export const FEATURES_SECTION = {
  title: 'Your characters. Your conversations.',
  staticTitle: 'Everything you need to bring a character to life',
} as const

export const FEATURES: LandingFeature[] = [
  {
    icon: 'phone-in-talk',
    emoji: '📞',
    title: 'Live, Real-Time Voice Calls',
    body: 'Talk to your AI characters in real time with natural, uninterrupted voice that feels exactly like a human phone call. Speak hands-free on speakerphone, interrupt seamlessly whenever you change your mind, and hear your character search the web or check its memory mid-conversation.',
    learnMoreHref: '/real-time-voice',
  },
  {
    icon: 'image-outline',
    emoji: '🖼️',
    title: 'Images in Chat',
    body: 'Ask your character for a chart, a diagram, a mockup, or a selfie — and it generates the image right inside the chat. Save to Photos or share out, with every image also saved to that character’s gallery.',
    learnMoreHref: '/image-generation',
    isNew: true,
  },
  {
    icon: 'export-variant',
    emoji: '📦',
    title: 'Import & Export with Google OKF',
    body: "Back up, restore, and share your character's complete memory using OKF — the Open Knowledge Format introduced by Google Cloud. Read and edit your character's facts and memories in any Markdown editor like Obsidian, then restore them or clone a brand-new character from the bundle. Truly own your data — no walled garden.",
    learnMoreHref: '/memory-export-with-okf',
    isNew: true,
  },
  {
    icon: 'brain',
    emoji: '🧠',
    title: 'Advanced Memory That Learns',
    body: 'Your character learns and organizes facts automatically — from your conversations, uploaded documents (PDFs, Word docs, and images), and live web search. A local-first knowledge wiki reconciles conflicting information to stay consistent and accurate, building a compounding memory without prompt bloat.',
    learnMoreHref: '/advanced-memory',
  },
  {
    icon: 'book-open-variant',
    emoji: '📖',
    title: 'Completely Open Source',
    body: "Clanker AI's code is public on GitHub. Verify how your data is handled, suggest features, or contribute — built by and for its users.",
    learnMoreHref: '/open-source',
  },
  {
    icon: 'robot-outline',
    emoji: '🤖',
    title: 'Build Your Character',
    body: 'Give your AI a name, appearance, personality traits, emotional range, and backstory. Generate a unique portrait avatar with AI. No art skills needed.',
  },
  {
    icon: 'chat-outline',
    emoji: '💬',
    title: 'Real AI Conversations',
    body: 'Chat with characters that actually remember their personality. Long conversation memory is automatically summarized so your assistant stays in character.',
  },
  {
    icon: 'cloud-sync-outline',
    emoji: '☁️',
    title: 'Share & Sync',
    body: 'Save characters to the cloud and sync across all your devices. Share any character via link. Anyone can open it instantly.',
  },
]

export const VIDEO = {
  youtubeId: '6aictXUK_lw',
  heading: 'See Clanker AI in action',
  iframeTitle: 'Clanker AI demo',
  iframeSandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
} as const

export type FooterLink = {
  label: string
  href: string
  external?: boolean
}

export const FOOTER_LINKS: FooterLink[] = [
  { label: 'Real-Time Voice', href: '/real-time-voice' },
  { label: 'Image Generation', href: '/image-generation' },
  { label: 'OKF Memory', href: '/memory-export-with-okf' },
  { label: 'Advanced Memory', href: '/advanced-memory' },
  { label: 'Privacy Mode', href: '/privacy-mode' },
  { label: 'Open Source', href: '/open-source' },
  { label: 'Support', href: '/support' },
  { label: 'Terms and Conditions', href: '/terms' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'About Clanker AI', href: '/welcome' },
  {
    label: 'Equational Applications LLC',
    href: 'https://equationalapplications.com/',
    external: true,
  },
]
