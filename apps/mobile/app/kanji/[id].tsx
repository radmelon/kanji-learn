import { useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'
import type { SrsStatus } from '@kanji-learn/shared'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VocabExample {
  word: string
  reading: string
  meaning: string
}

interface KanjiDetail {
  id: number
  character: string
  jlptLevel: string
  strokeCount: number
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  exampleVocab: VocabExample[]
  radicals: string[]
  svgPath: string | null
  srsStatus: SrsStatus
  srsInterval: number | null
  srsRepetitions: number | null
  srsNextReviewAt: string | null
  srsLastReviewedAt: string | null
  srsEaseFactor: number | null
  srsReadingStage: number | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SRS_LABELS: Record<SrsStatus, string> = {
  unseen: 'Not started',
  learning: 'Learning',
  reviewing: 'Reviewing',
  remembered: 'Remembered',
  burned: 'Burned 🔥',
}

const SRS_COLORS: Record<SrsStatus, string> = {
  unseen: colors.textMuted,
  learning: colors.learning,
  reviewing: colors.reviewing,
  remembered: colors.remembered,
  burned: colors.burned,
}

const JLPT_COLORS: Record<string, string> = {
  N5: colors.n5 ?? '#22C55E',
  N4: colors.n4 ?? '#3B82F6',
  N3: colors.n3 ?? '#A855F7',
  N2: colors.n2 ?? '#F97316',
  N1: colors.n1 ?? '#EF4444',
}

function formatNextReview(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return 'Due now'
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 30) return `In ${days} days`
  const months = Math.floor(days / 30)
  return months === 1 ? 'In 1 month' : `In ${months} months`
}

// ─── Screen ─────────────────────────────────────────────────────────────────────

export default function KanjiDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [kanji, setKanji] = useState<KanjiDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setIsLoading(true)
    setError(null)
    api.get<KanjiDetail>(`/v1/kanji/${id}`)
      .then(setKanji)
      .catch((err) => setError(err?.message ?? 'Failed to load'))
      .finally(() => setIsLoading(false))
  }

  useEffect(() => { load() }, [id])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Back bar */}
      <View style={styles.bar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} activeOpacity={0.7} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xxl }} />
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : kanji ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroChar}>{kanji.character}</Text>
            <View style={styles.heroBadges}>
              <View style={[styles.jlptBadge, {
                backgroundColor: (JLPT_COLORS[kanji.jlptLevel] ?? colors.primary) + '22',
                borderColor: JLPT_COLORS[kanji.jlptLevel] ?? colors.primary,
              }]}>
                <Text style={[styles.jlptText, { color: JLPT_COLORS[kanji.jlptLevel] ?? colors.primary }]}>
                  {kanji.jlptLevel}
                </Text>
              </View>
              <View style={styles.strokeBadge}>
                <Ionicons name="pencil-outline" size={12} color={colors.textMuted} />
                <Text style={styles.strokeText}>{kanji.strokeCount} strokes</Text>
              </View>
            </View>
            <Text style={styles.primaryMeaning}>{kanji.meanings[0] ?? ''}</Text>
          </View>

          {/* SRS Progress */}
          {kanji.srsStatus !== 'unseen' && (
            <Card title="SRS Progress">
              <View style={styles.srsRow}>
                <View style={[styles.srsStatusBadge, { backgroundColor: SRS_COLORS[kanji.srsStatus] + '22' }]}>
                  <Text style={[styles.srsStatusText, { color: SRS_COLORS[kanji.srsStatus] }]}>
                    {SRS_LABELS[kanji.srsStatus]}
                  </Text>
                </View>
                <View style={styles.srsMeta}>
                  {kanji.srsNextReviewAt !== null && (
                    <View style={styles.srsMetaItem}>
                      <Text style={styles.srsMetaLabel}>Next review</Text>
                      <Text style={styles.srsMetaValue}>{formatNextReview(kanji.srsNextReviewAt)}</Text>
                    </View>
                  )}
                  {kanji.srsInterval !== null && (
                    <View style={styles.srsMetaItem}>
                      <Text style={styles.srsMetaLabel}>Interval</Text>
                      <Text style={styles.srsMetaValue}>
                        {kanji.srsInterval === 1 ? '1 day' : `${kanji.srsInterval} days`}
                      </Text>
                    </View>
                  )}
                  {kanji.srsRepetitions !== null && (
                    <View style={styles.srsMetaItem}>
                      <Text style={styles.srsMetaLabel}>Reviews</Text>
                      <Text style={styles.srsMetaValue}>{kanji.srsRepetitions}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Card>
          )}

          {/* Meanings */}
          <Card title="Meanings">
            <View style={styles.meaningsList}>
              {kanji.meanings.map((m, i) => (
                <View key={i} style={[styles.meaningPill, i === 0 && styles.meaningPillPrimary]}>
                  <Text style={[styles.meaningPillText, i === 0 && styles.meaningPillTextPrimary]}>{m}</Text>
                </View>
              ))}
            </View>
          </Card>

          {/* Readings */}
          {(kanji.onReadings.length > 0 || kanji.kunReadings.length > 0) && (
            <Card title="Readings">
              {kanji.onReadings.length > 0 && (
                <View style={styles.readingGroup}>
                  <Text style={styles.readingGroupLabel}>On'yomi (Chinese)</Text>
                  <View style={styles.readingPills}>
                    {kanji.onReadings.map((r, i) => (
                      <View key={i} style={styles.readingPill}>
                        <Text style={styles.readingPillText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
              {kanji.kunReadings.length > 0 && (
                <View style={styles.readingGroup}>
                  <Text style={styles.readingGroupLabel}>Kun'yomi (Japanese)</Text>
                  <View style={styles.readingPills}>
                    {kanji.kunReadings.map((r, i) => (
                      <View key={i} style={[styles.readingPill, styles.readingPillKun]}>
                        <Text style={[styles.readingPillText, styles.readingPillTextKun]}>{r}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Card>
          )}

          {/* Example Vocabulary */}
          {kanji.exampleVocab.length > 0 && (
            <Card title="Example Vocabulary">
              {kanji.exampleVocab.map((v, i) => (
                <View key={i} style={[styles.vocabRow, i > 0 && styles.vocabRowBorder]}>
                  <View style={styles.vocabLeft}>
                    <Text style={styles.vocabWord}>{v.word}</Text>
                    <Text style={styles.vocabReading}>{v.reading}</Text>
                  </View>
                  <Text style={styles.vocabMeaning}>{v.meaning}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Radicals */}
          {kanji.radicals.length > 0 && (
            <Card title="Radicals">
              <View style={styles.radicalPills}>
                {kanji.radicals.map((r, i) => (
                  <View key={i} style={styles.radicalPill}>
                    <Text style={styles.radicalText}>{r}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  )
}

// ─── Card sub-component ────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={cardStyles.wrapper}>
      <Text style={cardStyles.title}>{title}</Text>
      <View style={cardStyles.body}>{children}</View>
    </View>
  )
}

const cardStyles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  body: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
})

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backLabel: { ...typography.body, color: colors.textPrimary },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  errorText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  retryText: { ...typography.body, color: '#fff', fontWeight: '600' },

  // Hero
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  heroChar: { fontSize: 96, lineHeight: 110, color: colors.textPrimary, fontWeight: '300' },
  heroBadges: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  jlptBadge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  jlptText: { ...typography.caption, fontWeight: '700' },
  strokeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bgCard, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.border,
  },
  strokeText: { ...typography.caption, color: colors.textMuted },
  primaryMeaning: { ...typography.h2, color: colors.textSecondary, textAlign: 'center' },

  // SRS
  srsRow: { gap: spacing.md },
  srsStatusBadge: { alignSelf: 'flex-start', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 5 },
  srsStatusText: { ...typography.body, fontWeight: '700' },
  srsMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  srsMetaItem: { gap: 2 },
  srsMetaLabel: { ...typography.caption, color: colors.textMuted },
  srsMetaValue: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },

  // Meanings
  meaningsList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  meaningPill: {
    backgroundColor: colors.bgSurface, borderRadius: radius.full,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  meaningPillPrimary: { backgroundColor: colors.primary + '22', borderColor: colors.primary + '66' },
  meaningPillText: { ...typography.bodySmall, color: colors.textSecondary },
  meaningPillTextPrimary: { color: colors.primary, fontWeight: '700' },

  // Readings
  readingGroup: { gap: spacing.xs },
  readingGroupLabel: {
    ...typography.caption, color: colors.textMuted,
    fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  readingPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  readingPill: {
    backgroundColor: colors.accent + '22', borderRadius: radius.md,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.accent + '55',
  },
  readingPillKun: { backgroundColor: colors.info + '22', borderColor: colors.info + '55' },
  readingPillText: { ...typography.body, color: colors.accent, fontWeight: '600' },
  readingPillTextKun: { color: colors.info },

  // Vocabulary
  vocabRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs,
  },
  vocabRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  vocabLeft: { gap: 2 },
  vocabWord: { ...typography.h3, color: colors.textPrimary },
  vocabReading: { ...typography.caption, color: colors.textMuted },
  vocabMeaning: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, textAlign: 'right' },

  // Radicals
  radicalPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  radicalPill: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgSurface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  radicalText: { ...typography.h3, color: colors.textPrimary },
})
