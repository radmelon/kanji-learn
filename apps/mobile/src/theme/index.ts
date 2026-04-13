// ─── Kanji Learn Design Tokens ────────────────────────────────────────────────

export const colors = {
  // Brand
  primary: '#E84855',      // vermillion red — energy, urgency
  primaryDark: '#B5313B',
  accent: '#F4A261',       // warm amber — encouragement
  accentDark: '#E07B2A',

  // Backgrounds
  bg: '#0F0F1A',           // deep indigo-black
  bgCard: '#1A1A2E',
  bgElevated: '#16213E',
  bgSurface: '#1F2041',

  // JLPT level colours
  n5: '#4CAF50',
  n4: '#2196F3',
  n3: '#FF9800',
  n2: '#9C27B0',
  n1: '#F44336',

  // SRS status colours
  unseen: '#6B7280',
  learning: '#3B82F6',
  reviewing: '#F59E0B',
  remembered: '#10B981',
  burned: '#EF4444',

  // Text
  textPrimary: '#F0F0F5',
  textSecondary: '#A0A0B0',
  textMuted: '#6E6E8A',

  // UI
  border: '#2A2A3E',
  divider: '#1E1E30',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  xl: 28,
  full: 999,
} as const

export const typography = {
  kanjiDisplay: { fontSize: 72, fontWeight: '300' as const, letterSpacing: -2 },
  kanjiLarge: { fontSize: 48, fontWeight: '300' as const },
  kanjiMedium: { fontSize: 32, fontWeight: '400' as const },
  h1: { fontSize: 28, fontWeight: '700' as const },
  h2: { fontSize: 22, fontWeight: '600' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodySmall: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  reading: { fontSize: 16, fontWeight: '400' as const, letterSpacing: 1 },
} as const

export type ColorKey = keyof typeof colors
