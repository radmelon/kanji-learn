// apps/mobile/src/config/onboarding-content.ts
//
// All visible onboarding strings live here.
// This file is OTA-updatable via Expo EAS Update — no App Store
// rebuild needed to change copy.

export type InfoItem = {
  location: string
  description: string
}

export type OnboardingContent = typeof ONBOARDING_CONTENT

export const ONBOARDING_CONTENT = {
  welcome: {
    kanjiHero: '漢',
    headline: 'Your personal kanji companion.',
    body: 'Kanji Buddy is an AI-powered learning companion that builds a study plan around you — your goals, your pace, your weak spots.',
    tagline: 'Smarter than flashcards. Friendlier than a textbook.',
    cta: 'Get started',
  },

  findHelp: {
    headline: 'Help is always one tap away',
    items: [
      {
        location: 'Study',
        description: 'Tap ⓘ next to the grade buttons to see what Again / Good / Easy mean',
      },
      {
        location: 'Dashboard',
        description: 'Each stat card has an ⓘ explaining what the number means',
      },
      {
        location: 'Progress',
        description: 'Tap ⓘ on any chart or section for a full explanation',
      },
      {
        location: 'Journal',
        description: 'Tap ⓘ to learn how AI-generated mnemonics work and when to refresh them',
      },
      {
        location: 'Write',
        description: 'Tap ⓘ to understand how stroke-order scoring works',
      },
      {
        location: 'Speak',
        description: 'Tap ⓘ to see how reading evaluation difficulty levels work',
      },
    ] satisfies InfoItem[],
    footer: "You don't need to memorise any of this now.",
    cta: 'Got it',
  },

  aboutYou: {
    headline: 'About you',
    namePlaceholder: 'Your name',
    countryPlaceholder: 'Country (optional)',
    cta: 'Next',
  },

  focus: {
    headline: 'What are you focused on right now?',
    subhead: 'You can change this any time in your profile.',
    chips: [
      'Travel',
      'JLPT exam',
      'Work / Business',
      'Anime / Manga',
      'Heritage',
      'Curiosity',
      'Other',
    ],
    cta: 'Next',
  },

  dailyTarget: {
    headline: 'How many kanji per day?',
    options: [5, 10, 15, 20, 30, 50] as number[],
    defaultOption: 20,
    cta: "Let's go",
  },
} as const

// ─── Country list ──────────────────────────────────────────────────────────────
// Shown in the country picker modal on the "About you" step.
// OTA-updatable alongside the rest of this file.

export type Country = { code: string; name: string }

export const COUNTRIES: Country[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norway' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RU', name: 'Russia' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Turkey' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'OTHER', name: 'Other' },
]
