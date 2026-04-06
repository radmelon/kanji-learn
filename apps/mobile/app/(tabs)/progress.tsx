import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../src/stores/auth.store'
import { useAnalytics } from '../../src/hooks/useAnalytics'
import { useQuizAnalytics } from '../../src/hooks/useQuizAnalytics'
import { useSessionHistory } from '../../src/hooks/useSessionHistory'
import { SrsStatusBar } from '../../src/components/ui/SrsStatusBar'
import { colors, spacing, radius, typography } from '../../src/theme'
import type { DailyStats } from '@kanji-learn/shared'
import { JLPT_LEVELS, JLPT_KANJI_COUNTS } from '@kanji-learn/shared'

type Period = '7d' | '30d' | '90d'

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 }

// ─── Info panel content ───────────────────────────────────────────────────────

interface InfoSection {
  title?: string
  body: string
}

const INFO_BREAKDOWN: InfoSection[] = [
  {
    body: 'Your kanji are sorted into five SRS stages. Each stage reflects how deeply the character is embedded in your long-term memory based on your review history.',
  },
  {
    title: 'Unseen',
    body: 'Kanji not yet introduced. They have no SRS interval and won\'t appear in reviews until the app gradually introduces them.',
  },
  {
    title: 'Learning',
    body: 'Newly introduced kanji with a short interval (1–3 days). These are in intensive rotation — you\'ll see them frequently until you prove you can recall them reliably.',
  },
  {
    title: 'Reviewing',
    body: 'Kanji you\'ve seen several times. Intervals are expanding (1–4 weeks). Your brain is moving from short-term familiarity to medium-term retention.',
  },
  {
    title: 'Remembered',
    body: 'Strong recall — intervals of 1–3 months. You\'ve demonstrated reliable memory over multiple sessions. One or two more correct reviews will push these to burned.',
  },
  {
    title: 'Burned 🔥',
    body: 'Mastered. The SRS interval has reached ~6 months, meaning your brain has proven genuine long-term recall — not just recent practice. Burned kanji leave the daily queue and only resurface as occasional surprise checks.',
  },
]

const INFO_ACTIVITY: InfoSection[] = [
  {
    body: 'Each bar shows the number of SRS flashcard reviews completed that day. The green portion represents correct answers; the full bar height represents total reviews.',
  },
  {
    title: 'What is Spaced Repetition?',
    body: 'A scheduling technique that times each review at the exact moment your brain is about to forget the material. A correct answer pushes the next review further out (e.g. 1 day → 4 days → 2 weeks…). A wrong answer resets the interval back to 1 day. Over time, kanji you know well drift to monthly reviews while difficult ones stay in daily rotation.',
  },
  {
    title: 'Why consistency beats volume',
    body: 'The SRS schedules cards for specific future dates. Skipping a day doesn\'t erase those cards — they accumulate. Reviewing 20 cards daily is far more effective than 140 cards once a week, because you\'re reviewing at the optimal memory-strengthening moment.',
  },
  {
    title: 'Period selector',
    body: 'Switch between 7-day, 30-day, and 90-day windows. The 7-day view shows your recent streak; the 90-day view reveals longer-term patterns in your study habits.',
  },
]

const INFO_ACCURACY: InfoSection[] = [
  {
    body: 'Your overall SRS review accuracy over the last 30 days — the percentage of flashcard answers graded Good or Easy out of all answers submitted.',
  },
  {
    title: 'How accuracy is graded',
    body: 'After revealing a card you self-grade using 4 buttons:\n\n• Again — you forgot it; resets the card\'s interval (incorrect)\n• Hard — you remembered with difficulty (incorrect for accuracy; interval still advances)\n• Good — solid recall (correct)\n• Easy — effortless recall; boosts the next interval (correct)\n\nAgain and Hard both count against your accuracy score.',
  },
  {
    title: 'What is a good accuracy?',
    body: 'Aim for 70–85%. Below 70% suggests cards are advancing too fast or you need more time with new material. Above 90% may mean your daily goal is too conservative — you could handle a faster pace.',
  },
  {
    title: 'Accuracy vs retention',
    body: 'A high accuracy today doesn\'t mean permanent retention. The SRS confirms retention by making you recall a kanji again at 1 month, 3 months, 6 months. Only confident recall (Good/Easy) across all those intervals earns a burn.',
  },
]

const INFO_VELOCITY: InfoSection[] = [
  {
    body: 'Velocity measures how actively and deeply you\'re building kanji memory over time — not just raw review counts, but the rate at which new characters reach long-term retention.',
  },
  {
    title: 'Daily avg (30d)',
    body: 'Average SRS reviews per day over the last 30 days. Consistency matters more than volume — 20 reviews/day every day beats 200 reviews on weekends.',
  },
  {
    title: 'Weekly avg',
    body: 'Average reviews per day over the last 7 days. Comparing this to your 30-day average shows whether you\'re currently accelerating, coasting, or falling behind.',
  },
  {
    title: 'Trend ↑ / ↓ / →',
    body: 'Compares your last 7-day average to the previous 7-day average. ↑ Up means you\'re studying more than usual; ↓ Down means you\'ve eased off. Neither is inherently good or bad — context matters.',
  },
  {
    title: 'Burn rate & projected completion',
    body: 'Kanji burned per day (30-day average). Divide the remaining unburned kanji by your burn rate to estimate completion. Study more consistently and the date moves closer; slow down and it moves further out.',
  },
]

const INFO_QUIZ_PERF: InfoSection[] = [
  {
    body: 'Quiz performance tracks your results in multiple-choice exam-style sessions. Unlike SRS reviews, quiz answers have no effect on your card intervals or scheduling — they are purely for self-assessment.',
  },
  {
    title: 'Pass threshold',
    body: 'Sessions scored 70% or above are marked as passed. This mirrors the approximate passing bar for real JLPT exams, so a consistent pass rate is a meaningful readiness signal.',
  },
  {
    title: 'Recent sessions bar chart',
    body: 'Each bar represents one quiz session. Bar height = score percentage. Green = passed (≥70%), red = failed. Look for a rising trend over time.',
  },
  {
    title: 'Quiz vs SRS',
    body: 'Use SRS daily to build memory. Use quizzes to benchmark readiness before an exam, or to consolidate a level after completing it. They test the same knowledge, but serve different purposes.',
  },
]

const INFO_QUIZ_WEAK: InfoSection[] = [
  {
    body: 'Kanji you most frequently get wrong in quizzes, requiring a minimum of 3 quiz attempts to appear. Miss rate = wrong answers ÷ total quiz attempts for that character.',
  },
  {
    title: 'What to do with this',
    body: 'These characters need deliberate attention. Look them up in the Kanji Browser, review their stroke order and readings, and pay close attention when they appear in SRS reviews. Repeated quiz misses are a strong signal the SRS alone isn\'t enough — try writing the character by hand a few times.',
  },
]

const INFO_WRITING: InfoSection[] = [
  {
    body: 'Writing practice tracks your stroke-by-stroke accuracy when drawing kanji by hand. Unlike SRS flashcards, writing practice isolates motor memory and spatial recall — knowing a kanji visually is very different from being able to produce it from scratch.',
  },
  {
    title: 'Avg accuracy',
    body: 'The average stroke accuracy score across all your writing attempts, expressed as a percentage. 70% is the pass threshold — the same used for JLPT writing sections.',
  },
  {
    title: 'Pass rate',
    body: 'The percentage of writing attempts that scored 70% or above. A rising pass rate means your motor memory for stroke order and proportion is improving.',
  },
  {
    title: 'Needs most work',
    body: 'The 5 kanji with the lowest average writing score, requiring a minimum of 2 attempts. Use these as a targeted practice list — writing a character correctly 3–5 times in a row typically locks in the stroke order.',
  },
]

const INFO_SPEAKING: InfoSection[] = [
  {
    body: 'Speaking practice tests whether you can produce the correct On\'yomi or Kun\'yomi reading aloud. Your spoken answer is evaluated using phonetic normalization and fuzzy matching to handle natural variation in pronunciation.',
  },
  {
    title: 'How evaluation works',
    body: 'Your spoken input is transcribed and normalised to romaji. A fuzzy string comparison (Levenshtein distance) checks how close it is to any accepted reading. Passing requires the transcription to closely match at least one correct reading — minor accent variation is tolerated, but incorrect readings fail.',
  },
  {
    title: 'Needs most work',
    body: 'Kanji with the lowest correct-answer rate after at least 2 attempts. Reading aloud is often the last skill to solidify — these characters need extra listening practice with native audio.',
  },
]

const INFO_SESSION_HISTORY: InfoSection[] = [
  {
    body: 'A log of your last 30 completed SRS review sessions. Each row shows when the session occurred, how many cards you reviewed, how long it took, and your accuracy for that session.',
  },
  {
    title: 'Accuracy colour coding',
    body: 'Green = 80% or above (strong session). Amber = 60–79% (solid but room to improve). Red = below 60% (tough session — the cards you missed will reappear soon for reinforcement).',
  },
  {
    title: 'Why short sessions are fine',
    body: 'The SRS schedules the right cards regardless of session length. A 5-minute session that clears your due queue is just as effective as a 30-minute marathon — what matters is showing up consistently, not how long each session lasts.',
  },
]

const INFO_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 }

export default function ProgressScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const { summary, isLoading, error, refresh } = useAnalytics()
  const { data: quizData } = useQuizAnalytics()
  const { sessions, isLoadingMore, hasMore, loadMore } = useSessionHistory()
  const [period, setPeriod] = useState<Period>('30d')
  const [activeInfo, setActiveInfo] = useState<string | null>(null)
  const toggleInfo = useCallback((id: string) => {
    setActiveInfo((prev) => (prev === id ? null : id))
  }, [])

  const displayName = user?.user_metadata?.display_name ?? 'Learner'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ gap: 2 }}>
            <Text style={styles.title}>Progress</Text>
            <Text style={styles.subtitle}>{displayName}'s journey</Text>
          </View>
          <TouchableOpacity style={styles.browseBtn} onPress={() => router.push('/browse')}>
            <Ionicons name="search" size={14} color={colors.primary} />
            <Text style={styles.browseBtnText}>Browse</Text>
          </TouchableOpacity>
        </View>

        {isLoading && !summary ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xxl }} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
            <Text style={styles.errorText}>Could not load progress</Text>
            <Text style={styles.errorSub}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : summary ? (
          <>
            {/* Streak + completion hero */}
            <View style={styles.heroRow}>
              <HeroStat
                icon="flame"
                iconColor={colors.accent}
                value={`${summary.streakDays}`}
                label="Day streak"
              />
              <HeroStat
                icon="library"
                iconColor={colors.primary}
                value={`${Math.round((summary.totalSeen / 2294) * 100)}%`}
                label="Seen"
              />
              <HeroStat
                icon="checkmark-circle"
                iconColor={colors.success}
                value={`${summary.completionPct}%`}
                label="Mastered"
              />
            </View>

            {/* Overall SRS breakdown */}
            <Section
              title="Kanji Breakdown"
              right={<InfoButton id="breakdown" activeInfo={activeInfo} onToggle={toggleInfo} />}
            >
              {activeInfo === 'breakdown' && <InfoPanel sections={INFO_BREAKDOWN} />}
              <SrsStatusBar counts={summary.statusCounts} />
              <JlptGrid jlptProgress={summary.jlptProgress} />
            </Section>

            {/* Period selector + activity chart */}
            <Section
              title="Activity"
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <PeriodSelector value={period} onChange={setPeriod} />
                  <InfoButton id="activity" activeInfo={activeInfo} onToggle={toggleInfo} />
                </View>
              }
            >
              {activeInfo === 'activity' && <InfoPanel sections={INFO_ACTIVITY} />}
              <ActivityChart
                stats={summary.recentStats}
                days={PERIOD_DAYS[period]}
              />
            </Section>

            {/* Accuracy card */}
            <Section
              title="Accuracy"
              right={<InfoButton id="accuracy" activeInfo={activeInfo} onToggle={toggleInfo} />}
            >
              {activeInfo === 'accuracy' && <InfoPanel sections={INFO_ACCURACY} />}
              <View style={styles.accuracyRow}>
                <View style={styles.accuracyCircle}>
                  <Text style={styles.accuracyPct}>{summary.accuracy}%</Text>
                  <Text style={styles.accuracyLabel}>correct</Text>
                </View>
                <View style={styles.accuracyDetails}>
                  <AccuracyRow label="Last 7 days" value={summary.accuracy} />
                  <AccuracyRow label="Total reviewed" value={summary.statusCounts.learning + summary.statusCounts.reviewing + summary.statusCounts.remembered + summary.statusCounts.burned} isCount />
                  <AccuracyRow label="Burned" value={summary.statusCounts.burned} isCount />
                </View>
              </View>
            </Section>

            {/* Velocity card */}
            <Section
              title="Velocity"
              right={<InfoButton id="velocity" activeInfo={activeInfo} onToggle={toggleInfo} />}
            >
              {activeInfo === 'velocity' && <InfoPanel sections={INFO_VELOCITY} />}
              <View style={styles.velocityGrid}>
                <VelocityItem label="Daily avg (30d)" value={summary.velocity.dailyAverage} unit="reviews" />
                <VelocityItem label="Weekly avg" value={summary.velocity.weeklyAverage} unit="reviews/day" />
                {summary.velocity.projectedCompletion && (
                  <VelocityItem
                    label="Est. completion"
                    value={new Date(summary.velocity.projectedCompletion).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
                    isText
                  />
                )}
                <VelocityItem
                  label="Trend"
                  value={summary.velocity.trend === 'up' ? '↑ Up' : summary.velocity.trend === 'down' ? '↓ Down' : '→ Stable'}
                  isText
                  color={
                    summary.velocity.trend === 'up'
                      ? colors.success
                      : summary.velocity.trend === 'down'
                      ? colors.error
                      : colors.textMuted
                  }
                />
              </View>
            </Section>

            {/* Quiz Performance */}
            {quizData && quizData.totalSessions > 0 && (
              <>
                <Section
                  title="Quiz Performance"
                  right={<InfoButton id="quizPerf" activeInfo={activeInfo} onToggle={toggleInfo} />}
                >
                  {activeInfo === 'quizPerf' && <InfoPanel sections={INFO_QUIZ_PERF} />}
                  <View style={styles.velocityGrid}>
                    <VelocityItem label="Sessions" value={quizData.totalSessions.toLocaleString()} isText />
                    <VelocityItem label="Avg score" value={`${quizData.avgScore}%`} isText color={quizData.avgScore >= 70 ? colors.success : colors.warning} />
                    <VelocityItem label="Pass rate" value={`${quizData.passRate}%`} isText color={quizData.passRate >= 70 ? colors.success : colors.warning} />
                  </View>
                  {quizData.recentSessions.length > 0 && (
                    <View style={styles.quizHistory}>
                      <Text style={styles.worstKanjiTitle}>Recent sessions</Text>
                      <View style={styles.quizBars}>
                        {quizData.recentSessions.slice(0, 10).reverse().map((s) => (
                          <View key={s.id} style={styles.quizBarWrapper}>
                            <View style={styles.quizBarTrack}>
                              <View style={[styles.quizBarFill, { height: `${Math.max(s.scorePct, 4)}%`, backgroundColor: s.passed ? colors.success : colors.error }]} />
                            </View>
                          </View>
                        ))}
                      </View>
                      <View style={styles.quizBarLegend}>
                        <LegendDot color={colors.success} label="Pass" />
                        <LegendDot color={colors.error} label="Fail" />
                      </View>
                    </View>
                  )}
                </Section>
                {quizData.weakestKanji.length > 0 && (
                  <Section
                    title="Quiz Weak Spots"
                    right={<InfoButton id="quizWeak" activeInfo={activeInfo} onToggle={toggleInfo} />}
                  >
                    {activeInfo === 'quizWeak' && <InfoPanel sections={INFO_QUIZ_WEAK} />}
                    <Text style={styles.sectionNote}>Kanji you most often miss in quizzes (min 3 attempts)</Text>
                    {quizData.weakestKanji.map((k) => (
                      <View key={k.kanjiId} style={styles.worstKanjiRow}>
                        <Text style={styles.worstKanjiChar}>{k.character}</Text>
                        <View style={styles.worstKanjiBar}>
                          <View style={[styles.worstKanjiBarFill, { width: `${k.missRate}%`, backgroundColor: k.missRate >= 50 ? colors.error : colors.warning }]} />
                        </View>
                        <Text style={styles.worstKanjiPct}>{k.missRate}%</Text>
                      </View>
                    ))}
                  </Section>
                )}
              </>
            )}

            {/* Writing Practice */}
            {summary.writing.totalAttempts > 0 ? (
              <Section
                title="Writing Practice"
                right={<InfoButton id="writing" activeInfo={activeInfo} onToggle={toggleInfo} />}
              >
                {activeInfo === 'writing' && <InfoPanel sections={INFO_WRITING} />}
                <View style={styles.velocityGrid}>
                  <VelocityItem label="Attempts" value={summary.writing.totalAttempts.toLocaleString()} isText />
                  <VelocityItem label="Avg accuracy" value={`${summary.writing.avgScore}%`} isText color={summary.writing.avgScore >= 70 ? colors.success : colors.warning} />
                  <VelocityItem label="Pass rate" value={`${summary.writing.passRate}%`} isText color={summary.writing.passRate >= 70 ? colors.success : colors.warning} />
                </View>
                {summary.writing.worstKanji.length > 0 && (
                  <View style={styles.worstKanjiList}>
                    <Text style={styles.worstKanjiTitle}>Needs most work</Text>
                    {summary.writing.worstKanji.map((k) => (
                      <View key={k.kanjiId} style={styles.worstKanjiRow}>
                        <Text style={styles.worstKanjiChar}>{k.character}</Text>
                        <View style={styles.worstKanjiBar}>
                          <View style={[styles.worstKanjiBarFill, { width: `${k.avgScore ?? 0}%`, backgroundColor: (k.avgScore ?? 0) >= 70 ? colors.success : colors.warning }]} />
                        </View>
                        <Text style={styles.worstKanjiPct}>{k.avgScore}%</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Section>
            ) : null}

            {/* Session History */}
            {sessions.length > 0 && (
              <Section
                title="Session History"
                right={<InfoButton id="sessionHistory" activeInfo={activeInfo} onToggle={toggleInfo} />}
              >
                {activeInfo === 'sessionHistory' && <InfoPanel sections={INFO_SESSION_HISTORY} />}
                {sessions.map((s) => {
                  const date = new Date(s.startedAt)
                  const dateStr = date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
                  const timeStr = date.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })
                  const mins = Math.round(s.studyTimeMs / 60000)
                  const accColor = s.accuracyPct >= 80 ? colors.success : s.accuracyPct >= 60 ? colors.warning : colors.error
                  return (
                    <View key={s.id} style={styles.sessionRow}>
                      <View style={styles.sessionDate}>
                        <Text style={styles.sessionDateMain}>{dateStr}</Text>
                        <Text style={styles.sessionDateTime}>{timeStr}</Text>
                      </View>
                      <View style={styles.sessionMeta}>
                        <Text style={styles.sessionItems}>{s.totalItems} cards</Text>
                        {mins > 0 && <Text style={styles.sessionTime}>{mins}m</Text>}
                      </View>
                      <View style={[styles.sessionAccBadge, { backgroundColor: accColor + '22' }]}>
                        <Text style={[styles.sessionAccText, { color: accColor }]}>{s.accuracyPct}%</Text>
                      </View>
                    </View>
                  )
                })}
                {hasMore && (
                  <TouchableOpacity
                    style={styles.showMoreBtn}
                    onPress={loadMore}
                    activeOpacity={0.7}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <>
                        <Text style={styles.showMoreText}>Load more</Text>
                        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </Section>
            )}

            {/* Speaking Practice */}
            {summary.voice.totalAttempts > 0 ? (
              <Section
                title="Speaking Practice"
                right={<InfoButton id="speaking" activeInfo={activeInfo} onToggle={toggleInfo} />}
              >
                {activeInfo === 'speaking' && <InfoPanel sections={INFO_SPEAKING} />}
                <View style={styles.velocityGrid}>
                  <VelocityItem label="Attempts" value={summary.voice.totalAttempts.toLocaleString()} isText />
                  <VelocityItem label="Accuracy" value={`${summary.voice.correctPct}%`} isText color={summary.voice.correctPct >= 70 ? colors.success : colors.warning} />
                </View>
                {summary.voice.worstKanji.length > 0 && (
                  <View style={styles.worstKanjiList}>
                    <Text style={styles.worstKanjiTitle}>Needs most work</Text>
                    {summary.voice.worstKanji.map((k) => (
                      <View key={k.kanjiId} style={styles.worstKanjiRow}>
                        <Text style={styles.worstKanjiChar}>{k.character}</Text>
                        <View style={styles.worstKanjiBar}>
                          <View style={[styles.worstKanjiBarFill, { width: `${k.correctPct ?? 0}%`, backgroundColor: (k.correctPct ?? 0) >= 70 ? colors.success : colors.warning }]} />
                        </View>
                        <Text style={styles.worstKanjiPct}>{k.correctPct}%</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Section>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeroStat({ icon, iconColor, value, label }: { icon: string; iconColor: string; value: string; label: string }) {
  return (
    <View style={heroStyles.item}>
      <Ionicons name={icon as any} size={24} color={iconColor} />
      <Text style={heroStyles.value}>{value}</Text>
      <Text style={heroStyles.label}>{label}</Text>
    </View>
  )
}

const heroStyles = StyleSheet.create({
  item: { flex: 1, alignItems: 'center', backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border },
  value: { ...typography.h2, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
})

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={sectionStyles.container}>
      <View style={sectionStyles.header}>
        <Text style={sectionStyles.title}>{title}</Text>
        {right}
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  )
}

const sectionStyles = StyleSheet.create({
  container: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...typography.h3, color: colors.textPrimary },
  body: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
})

function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <View style={periodStyles.container}>
      {(['7d', '30d', '90d'] as Period[]).map((p) => (
        <TouchableOpacity
          key={p}
          style={[periodStyles.btn, value === p && periodStyles.active]}
          onPress={() => onChange(p)}
        >
          <Text style={[periodStyles.label, value === p && periodStyles.activeLabel]}>{p}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const periodStyles = StyleSheet.create({
  container: { flexDirection: 'row', backgroundColor: colors.bgSurface, borderRadius: radius.md, padding: 2 },
  btn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm - 2 },
  active: { backgroundColor: colors.primary },
  label: { ...typography.caption, color: colors.textMuted },
  activeLabel: { color: '#fff', fontWeight: '700' },
})

function ActivityChart({ stats, days }: { stats: DailyStats[]; days: number }) {
  // Build a dense date-keyed map so empty days get zero bars.
  // The API only stores rows for days with activity, so a plain slice()
  // always returns the same sparse set regardless of which period is selected.
  const statsMap = new Map(stats.map((d) => [d.date, d]))
  const recent: DailyStats[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10) // 'YYYY-MM-DD'
    recent.push(statsMap.get(key) ?? { date: key, reviewed: 0, correct: 0, newLearned: 0, burned: 0, studyTimeMs: 0 })
  }
  const max = Math.max(...recent.map((d) => d.reviewed), 1)

  return (
    <View style={chartStyles.container}>
      <View style={chartStyles.bars}>
        {recent.map((day, i) => {
          const pct = (day.reviewed / max) * 100
          const correctPct = day.reviewed > 0 ? (day.correct / day.reviewed) * 100 : 0
          return (
            <View key={i} style={chartStyles.barWrapper}>
              <View style={chartStyles.track}>
                <View style={[chartStyles.barBg, { height: `${Math.max(pct, 2)}%` }]} />
                <View style={[chartStyles.barFg, { height: `${Math.max(correctPct * pct / 100, 2)}%`, backgroundColor: colors.success }]} />
              </View>
            </View>
          )
        })}
      </View>
      <View style={chartStyles.legend}>
        <LegendDot color={colors.primary} label="Reviewed" />
        <LegendDot color={colors.success} label="Correct" />
      </View>
    </View>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ ...typography.caption, color: colors.textMuted }}>{label}</Text>
    </View>
  )
}

const chartStyles = StyleSheet.create({
  container: { gap: spacing.sm },
  bars: { flexDirection: 'row', height: 100, gap: 2, alignItems: 'flex-end' },
  barWrapper: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  track: { width: '100%', height: '100%', justifyContent: 'flex-end', backgroundColor: colors.bgSurface, borderRadius: 3, overflow: 'hidden', position: 'relative' },
  barBg: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: colors.primary + '44', borderRadius: 3 },
  barFg: { position: 'absolute', bottom: 0, width: '100%', borderRadius: 3 },
  legend: { flexDirection: 'row', gap: spacing.md },
})

interface JlptBreakdown { learning: number; reviewing: number; remembered: number; burned: number }

function JlptGrid({ jlptProgress }: { jlptProgress: Record<string, JlptBreakdown | number> }) {
  return (
    <View style={jlptStyles.grid}>
      {JLPT_LEVELS.map((level) => {
        const levelTotal = JLPT_KANJI_COUNTS[level]
        const raw = jlptProgress[level]
        const bd: JlptBreakdown = typeof raw === 'number'
          ? { learning: 0, reviewing: 0, remembered: 0, burned: raw }
          : raw ?? { learning: 0, reviewing: 0, remembered: 0, burned: 0 }
        const total = bd.learning + bd.reviewing + bd.remembered + bd.burned
        return (
          <View key={level} style={jlptStyles.row}>
            <Text style={jlptStyles.level}>{level}</Text>
            <View style={jlptStyles.track}>
              {bd.learning > 0 && <View style={[jlptStyles.seg, { width: `${(bd.learning / levelTotal) * 100}%`, backgroundColor: colors.learning }]} />}
              {bd.reviewing > 0 && <View style={[jlptStyles.seg, { width: `${(bd.reviewing / levelTotal) * 100}%`, backgroundColor: colors.reviewing }]} />}
              {bd.remembered > 0 && <View style={[jlptStyles.seg, { width: `${(bd.remembered / levelTotal) * 100}%`, backgroundColor: colors.remembered }]} />}
              {bd.burned > 0 && <View style={[jlptStyles.seg, { width: `${(bd.burned / levelTotal) * 100}%`, backgroundColor: colors.burned }]} />}
            </View>
            <Text style={jlptStyles.count}>{total}/{levelTotal}</Text>
          </View>
        )
      })}
    </View>
  )
}

const jlptStyles = StyleSheet.create({
  grid: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  level: { ...typography.caption, color: colors.textMuted, width: 24, fontWeight: '700' },
  track: { flex: 1, height: 6, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden', flexDirection: 'row' },
  seg: { height: '100%' },
  count: { ...typography.caption, color: colors.textMuted, width: 64, textAlign: 'right' },
})

function AccuracyRow({ label, value, isCount }: { label: string; value: number; isCount?: boolean }) {
  return (
    <View style={accStyles.row}>
      <Text style={accStyles.label}>{label}</Text>
      <Text style={accStyles.value}>{isCount ? value.toLocaleString() : `${value}%`}</Text>
    </View>
  )
}

const accStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  label: { ...typography.bodySmall, color: colors.textSecondary },
  value: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
})

function VelocityItem({ label, value, unit, isText, color }: { label: string; value: string | number; unit?: string; isText?: boolean; color?: string }) {
  return (
    <View style={velStyles.item}>
      <Text style={velStyles.label}>{label}</Text>
      <Text style={[velStyles.value, color ? { color } : {}]}>
        {value}{unit && !isText ? <Text style={velStyles.unit}> {unit}</Text> : null}
      </Text>
    </View>
  )
}

const velStyles = StyleSheet.create({
  item: { flex: 1, minWidth: '45%' },
  label: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.h3, color: colors.textPrimary },
  unit: { ...typography.caption, color: colors.textMuted, fontWeight: '400' },
})

// ─── InfoButton ───────────────────────────────────────────────────────────────

function InfoButton({
  id,
  activeInfo,
  onToggle,
}: {
  id: string
  activeInfo: string | null
  onToggle: (id: string) => void
}) {
  const isOpen = activeInfo === id
  return (
    <TouchableOpacity onPress={() => onToggle(id)} hitSlop={INFO_HIT_SLOP} activeOpacity={0.7}>
      <Ionicons
        name={isOpen ? 'chevron-up-circle-outline' : 'information-circle-outline'}
        size={18}
        color={isOpen ? colors.info : colors.textMuted}
      />
    </TouchableOpacity>
  )
}

// ─── InfoPanel ────────────────────────────────────────────────────────────────

function InfoPanel({ sections }: { sections: InfoSection[] }) {
  return (
    <View style={infoStyles.panel}>
      {sections.map((s, i) => (
        <View key={i} style={[infoStyles.section, i > 0 && infoStyles.sectionSpaced]}>
          {s.title !== undefined && (
            <Text style={infoStyles.sectionTitle}>{s.title}</Text>
          )}
          <Text style={infoStyles.sectionBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  )
}

const infoStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info + '44',
    padding: spacing.md,
  },
  section: {},
  sectionSpaced: { marginTop: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    color: colors.info,
    fontWeight: '700',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  browseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.primary + '66',
    borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 6,
  },
  browseBtnText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  heroRow: { flexDirection: 'row', gap: spacing.sm },
  accuracyRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  accuracyCircle: {
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 3, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  accuracyPct: { ...typography.h2, color: colors.primary },
  accuracyLabel: { ...typography.caption, color: colors.textMuted },
  accuracyDetails: { flex: 1, gap: spacing.xs },
  velocityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  sectionNote: { ...typography.caption, color: colors.textMuted },
  quizHistory: { gap: spacing.sm },
  quizBars: { flexDirection: 'row', height: 80, gap: 3, alignItems: 'flex-end' },
  quizBarWrapper: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  quizBarTrack: { width: '100%', height: '100%', justifyContent: 'flex-end', backgroundColor: colors.bgSurface, borderRadius: 3, overflow: 'hidden' },
  quizBarFill: { position: 'absolute', bottom: 0, width: '100%', borderRadius: 3 },
  quizBarLegend: { flexDirection: 'row', gap: spacing.md },
  worstKanjiList: { gap: spacing.sm, paddingTop: spacing.xs },
  worstKanjiTitle: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' },
  worstKanjiRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  worstKanjiChar: { ...typography.h3, color: colors.textPrimary, width: 32, textAlign: 'center' },
  worstKanjiBar: { flex: 1, height: 6, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  worstKanjiBarFill: { height: '100%', borderRadius: radius.full },
  worstKanjiPct: { ...typography.caption, color: colors.textMuted, width: 36, textAlign: 'right' },
  // Session History
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  sessionDate: { width: 72 },
  sessionDateMain: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  sessionDateTime: { ...typography.caption, color: colors.textMuted },
  sessionMeta: { flex: 1, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  sessionItems: { ...typography.bodySmall, color: colors.textSecondary },
  sessionTime: { ...typography.caption, color: colors.textMuted },
  sessionAccBadge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  sessionAccText: { ...typography.caption, fontWeight: '700' },
  showMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.xs, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs,
  },
  showMoreText: { ...typography.caption, color: colors.textMuted },

  errorBox: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl, padding: spacing.xl },
  errorText: { ...typography.h3, color: colors.textPrimary },
  errorSub: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: radius.lg },
  retryText: { ...typography.body, color: '#fff', fontWeight: '600' },
})
