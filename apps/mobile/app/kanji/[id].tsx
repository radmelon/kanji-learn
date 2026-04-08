import { useEffect, useState, useCallback, useRef } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Speech from 'expo-speech'
import { StrokeOrderAnimation } from '../../src/components/writing/StrokeOrderAnimation'
import { api } from '../../src/lib/api'
import { colors, spacing, radius, typography } from '../../src/theme'
import type { SrsStatus } from '@kanji-learn/shared'
import { getRadicalName } from '../../src/constants/radicals'

const SPEECH_OPTS: Speech.SpeechOptions = { language: 'ja-JP', rate: 0.9 }


// ─── Types ─────────────────────────────────────────────────────────────────────

interface RelatedKanji {
  id: number
  character: string
  jlptLevel: string
  meaning: string
  srsStatus: SrsStatus
}

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
  exampleSentences: { ja: string; en: string; vocab: string }[]
  radicals: string[]
  svgPath: string | null
  // Cross-reference codes
  jisCode: string | null
  nelsonClassic: number | null
  nelsonNew: number | null
  morohashiIndex: number | null
  morohashiVolume: number | null
  morohashiPage: number | null
  // SRS progress
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
  const [related, setRelated] = useState<RelatedKanji[]>([])
  const [speakingGroup, setSpeakingGroup] = useState<string | null>(null)
  const speakingGroupRef = useRef<string | null>(null)

  // Play a list of readings sequentially; tap again to stop
  const speakReadings = useCallback((readings: string[], groupKey: string, stripDot = false) => {
    if (speakingGroupRef.current === groupKey) {
      Speech.stop()
      speakingGroupRef.current = null
      setSpeakingGroup(null)
      return
    }
    Speech.stop()
    speakingGroupRef.current = groupKey
    setSpeakingGroup(groupKey)
    const cleaned = readings.map((r) => stripDot ? r.replace(/\./g, '') : r)
    const speakAt = (idx: number) => {
      if (idx >= cleaned.length || speakingGroupRef.current !== groupKey) {
        speakingGroupRef.current = null
        setSpeakingGroup(null)
        return
      }
      Speech.speak(cleaned[idx], { ...SPEECH_OPTS, onDone: () => speakAt(idx + 1), onError: () => { speakingGroupRef.current = null; setSpeakingGroup(null) } })
    }
    speakAt(0)
  }, [])

  const load = () => {
    setIsLoading(true)
    setError(null)
    setRelated([])
    api.get<KanjiDetail>(`/v1/kanji/${id}`)
      .then((k) => {
        setKanji(k)
        // Fire-and-forget related kanji fetch once the detail loads
        api.get<RelatedKanji[]>(`/v1/kanji/${k.id}/related`)
          .then(setRelated)
          .catch(() => { /* non-fatal */ })
      })
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
                  <View style={styles.readingGroupHeader}>
                    <Text style={styles.readingGroupLabel}>On'yomi (Chinese)</Text>
                    <TouchableOpacity
                      onPress={() => speakReadings(kanji.onReadings, 'on')}
                      hitSlop={8}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={speakingGroup === 'on' ? 'volume-high' : 'volume-medium-outline'}
                        size={16}
                        color={speakingGroup === 'on' ? colors.accent : colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
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
                  <View style={styles.readingGroupHeader}>
                    <Text style={styles.readingGroupLabel}>Kun'yomi (Japanese)</Text>
                    <TouchableOpacity
                      onPress={() => speakReadings(kanji.kunReadings, 'kun', true)}
                      hitSlop={8}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={speakingGroup === 'kun' ? 'volume-high' : 'volume-medium-outline'}
                        size={16}
                        color={speakingGroup === 'kun' ? colors.info : colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
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

          {/* Example Sentences */}
          {(kanji.exampleSentences ?? []).length > 0 && (
            <Card title="Example Sentences">
              {(kanji.exampleSentences ?? []).map((s, i) => (
                <View key={i} style={[styles.sentenceRow, i > 0 && styles.sentenceRowBorder]}>
                  <Text style={styles.sentenceJa}>
                    {s.vocab ? (
                      (() => {
                        const idx = s.ja.indexOf(s.vocab)
                        if (idx === -1) return <Text>{s.ja}</Text>
                        return (
                          <>
                            <Text>{s.ja.slice(0, idx)}</Text>
                            <Text style={styles.sentenceVocabHighlight}>{s.vocab}</Text>
                            <Text>{s.ja.slice(idx + s.vocab.length)}</Text>
                          </>
                        )
                      })()
                    ) : s.ja}
                  </Text>
                  <Text style={styles.sentenceEn}>{s.en}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Radicals */}
          {(kanji.radicals ?? []).length > 0 && (
            <Card title="Radicals">
              <View style={styles.radicalPills}>
                {(kanji.radicals ?? []).map((r, i) => {
                  const name = getRadicalName(r)
                  return (
                    <View key={i} style={styles.radicalPill}>
                      <Text style={styles.radicalText}>{r}</Text>
                      {name ? <Text style={styles.radicalName}>{name}</Text> : null}
                    </View>
                  )
                })}
              </View>
            </Card>
          )}

          {/* Stroke Order */}
          <Card title="Stroke Order">
            <StrokeOrderAnimation character={kanji.character} width={300} height={240} />
          </Card>

          {/* Cross-references */}
          {(kanji.nelsonClassic != null || kanji.nelsonNew != null || kanji.morohashiIndex != null || kanji.jisCode != null) && (
            <Card title="References">
              {kanji.jisCode != null && <RefRow label="JIS Code" value={kanji.jisCode} />}
              {kanji.nelsonClassic != null && <RefRow label="Nelson Classic" value={`#${kanji.nelsonClassic}`} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(kanji.character)}%23kanji`)} />}
              {kanji.nelsonNew != null && <RefRow label="New Nelson" value={`#${kanji.nelsonNew}`} onPress={() => Linking.openURL(`https://jisho.org/search/${encodeURIComponent(kanji.character)}%23kanji`)} />}
              {kanji.morohashiIndex != null && (
                <RefRow
                  label="Morohashi (大漢和)"
                  value={
                    kanji.morohashiVolume != null && kanji.morohashiPage != null
                      ? `${kanji.morohashiIndex} (vol. ${kanji.morohashiVolume}, p. ${kanji.morohashiPage})`
                      : `${kanji.morohashiIndex}`
                  }
                />
              )}
              <Text style={styles.refCredit}>
                Nelson: Andrew Nelson (Classic 1962); Jack Halpern ed. (New Nelson, 1997).{'\n'}
                Morohashi: Tetsuji Morohashi, 大漢和辞典 (1955–1960). Source: KANJIDIC2 (CC BY-SA 4.0).
              </Text>
            </Card>
          )}

          {/* Related Kanji */}
          {related.length > 0 && (
            <Card title="Related Kanji">
              <Text style={styles.relatedSubtitle}>Shares a radical · sorted by frequency</Text>
              <View style={styles.relatedGrid}>
                {related.map((r) => {
                  const jlptColor = JLPT_COLORS[r.jlptLevel] ?? colors.primary
                  const statusColor = SRS_COLORS[r.srsStatus]
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={styles.relatedChip}
                      onPress={() => router.push(`/kanji/${r.id}`)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.relatedStatusDot, { backgroundColor: statusColor }]} />
                      <Text style={styles.relatedChar}>{r.character}</Text>
                      <Text style={[styles.relatedLevel, { color: jlptColor }]}>{r.jlptLevel}</Text>
                      <Text style={styles.relatedMeaning} numberOfLines={1}>{r.meaning}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </Card>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  )
}

// ─── RefRow sub-component ────────────────────────────────────────────────────

function RefRow({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={refRowStyles.row} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <Text style={refRowStyles.label}>{label}</Text>
      <View style={refRowStyles.valueRow}>
        <Text style={[refRowStyles.value, onPress != null && refRowStyles.valueLink]}>{value}</Text>
        {onPress != null && <Ionicons name="open-outline" size={13} color={colors.primary} />}
      </View>
    </TouchableOpacity>
  )
}

const refRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  label: { ...typography.bodySmall, color: colors.textMuted },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  value: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  valueLink: { color: colors.primary },
})

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
  readingGroupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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

  // Example Sentences
  sentenceRow: { gap: 4, paddingVertical: spacing.xs },
  sentenceRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  sentenceJa: { fontSize: 15, color: colors.textPrimary, lineHeight: 22 },
  sentenceVocabHighlight: { color: colors.accent, fontWeight: '700' },
  sentenceEn: { ...typography.caption, color: colors.textMuted, lineHeight: 16 },

  // Radicals
  radicalPills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  radicalPill: {
    minWidth: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgSurface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    gap: 2,
  },
  radicalText: { ...typography.h3, color: colors.textPrimary },
  radicalName: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },

  // References
  refCredit: {
    ...typography.caption, color: colors.textMuted, fontStyle: 'italic',
    lineHeight: 16, marginTop: spacing.xs,
    borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.xs,
  },

  // Related Kanji
  relatedSubtitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  relatedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  relatedChip: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  relatedStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  relatedChar: { ...typography.h3, color: colors.textPrimary, minWidth: 24 },
  relatedLevel: { ...typography.caption, fontWeight: '700', minWidth: 20 },
  relatedMeaning: { ...typography.caption, color: colors.textMuted, flex: 1 },
})
