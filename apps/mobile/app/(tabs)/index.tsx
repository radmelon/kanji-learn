import { useCallback, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../src/stores/auth.store'
import { useReviewStore } from '../../src/stores/review.store'
import { useAnalytics } from '../../src/hooks/useAnalytics'
import { useQuizAnalytics } from '../../src/hooks/useQuizAnalytics'
import { useInterventions } from '../../src/hooks/useInterventions'
import { useSocial } from '../../src/hooks/useSocial'
import { SrsStatusBar } from '../../src/components/ui/SrsStatusBar'
import { StatCard } from '../../src/components/ui/StatCard'
import { InterventionBanner } from '../../src/components/ui/InterventionBanner'
import { OfflineBanner } from '../../src/components/ui/OfflineBanner'
import { colors, spacing, radius, typography } from '../../src/theme'

// ─── Info panel content ───────────────────────────────────────────────────────

interface InfoSection {
  title?: string
  body: string
}

const INFO_VELOCITY: InfoSection[] = [
  {
    body: 'Velocity tracks how actively and effectively you\'re learning kanji over time — not just how many cards you tap through, but how deeply you\'re building lasting memory. It is powered by a Spaced Repetition System (SRS), a scheduling method that times each review for the exact moment your brain is about to forget the character.',
  },
  {
    title: 'Reviews / day',
    body: 'The number of SRS flashcard answers you submit per day, averaged over the last 7 days. Consistency matters more than volume — even 15–20 reviews a day compounds dramatically over months.',
  },
  {
    title: 'Trend ↑ / ↓ / —',
    body: 'Compares your last 7-day review average to your 30-day average. ↑ Up means you\'ve been studying more actively lately; ↓ Down means you\'ve eased off. Neither is good or bad — it\'s context.',
  },
  {
    title: 'What does "burning" a kanji mean? 🔥',
    body: 'Every time you answer a card correctly, the SRS stretches its next review further into the future (1 day → 4 days → 2 weeks → 2 months…). When the interval grows to roughly 6 months, the kanji is marked as burned. Burned means you\'ve demonstrated genuine long-term recall — not just short-term familiarity. The character moves out of active rotation and surfaces only as an occasional surprise check to confirm you haven\'t forgotten it.',
  },
  {
    title: 'Burn rate',
    body: 'How many new kanji you burned per day on average over the last 30 days. This is the most meaningful long-term metric: it measures deep learning, not raw activity. Burn 1 kanji/day and you\'ll master all 2,294 Jouyou kanji in about 6 years. Burn 5/day and it takes roughly 15 months.',
  },
  {
    title: 'Projected completion dates',
    body: 'Estimated dates are calculated by dividing remaining unburned kanji by your current burn rate. Your next JLPT milestone shows when you\'ll burn every kanji at that level. Projections update automatically as your pace changes — study more and the dates move closer.',
  },
]

const INFO_ACTIVITY: InfoSection[] = [
  {
    body: 'Each bar shows how many Spaced Repetition System (SRS) cards you reviewed on that day. A full bar equals 50 reviews — a solid daily session. Shorter bars mean fewer reviews; no bar means the day was skipped.',
  },
  {
    title: 'What is Spaced Repetition?',
    body: 'Spaced Repetition is a learning technique that exploits the way human memory works: we forget things on a predictable curve, but a well-timed review resets and strengthens the memory. By scheduling reviews at the last possible moment before forgetting, the system forces your brain to work just hard enough to rebuild the memory — making it stick longer each time.\n\nThe underlying science goes back to psychologist Hermann Ebbinghaus, who mapped the "Forgetting Curve" in 1885. The modern algorithmic form — using an ease factor and expanding intervals — was pioneered by Piotr Woźniak in his SuperMemo software (1987). His SM-2 algorithm remains the foundation of most SRS apps today, and is the basis for this app\'s scheduling engine.',
  },
  {
    title: 'Why consistency beats volume',
    body: 'The SRS engine schedules each card at the exact moment your brain is about to forget it. Skipping a day doesn\'t erase those cards — they pile up. Reviewing even 10–20 cards daily prevents backlog from growing and keeps each session short and manageable.',
  },
  {
    title: 'How intervals expand',
    body: 'Every time you answer a card correctly, its next review interval roughly doubles (e.g. 1 day → 4 days → 10 days → 3 weeks…). A wrong answer resets the interval back to 1 day. Over time, characters you know well drift to monthly or biannual reviews, while characters you struggle with stay in heavy daily rotation.',
  },
]

const INFO_JOURNEY: InfoSection[] = [
  {
    body: 'Your overall progress toward mastering all 2,294 Jouyou kanji — the characters designated for daily use in modern Japanese and tested across all JLPT levels.',
  },
  {
    title: 'Seen',
    body: 'Kanji you\'ve been introduced to in at least one study session. These characters have an active Spaced Repetition System (SRS) interval and will appear in future reviews.',
  },
  {
    title: 'Mastered',
    body: 'Kanji you\'ve burned — answered correctly enough times that the SRS interval reached ~6 months. Mastered kanji represent genuine long-term retention: the SRS has confirmed your brain can recall them without recent reinforcement.',
  },
  {
    title: 'Remaining',
    body: 'Kanji not yet introduced. New characters are added gradually so your daily review queue grows at a pace you can handle without becoming overwhelmed.',
  },
  {
    title: 'JLPT levels at a glance',
    body: 'N5 (79 kanji) is the entry level and covers basic survival vocabulary. N4 adds 166 more. N3 (370 kanji) marks basic reading ability. N2 (371 kanji) is required for most Japanese universities and many jobs. N1 (1,308 kanji) represents advanced mastery and is the target for fluent readers.',
  },
]

const INFO_QUIZ: InfoSection[] = [
  {
    body: 'Quizzes test your recall in exam-style, multiple-choice conditions. Unlike daily Spaced Repetition System (SRS) reviews — where answering a card changes when you\'ll see it next — quiz results have no effect on your card intervals or learning progress. They\'re purely for self-assessment.',
  },
  {
    title: 'When to use quizzes',
    body: 'Before a JLPT exam to benchmark your readiness. After completing a level to consolidate what you\'ve learned. Any time you want a scored snapshot of your knowledge without touching your review schedule.',
  },
  {
    title: 'Pass threshold',
    body: 'A session is marked as passed when you score 70% or above. This mirrors the approximate passing threshold for real JLPT exams, so a consistent pass rate here is a meaningful readiness signal.',
  },
  {
    title: 'Avg score & pass rate',
    body: 'Averages across all your sessions to date. A rising average score is a stronger signal of real improvement than any single result — look for an upward trend over 5–10 sessions.',
  },
]

const INFO_JLPT_PROGRESS: InfoSection[] = [
  {
    body: 'How far you\'ve progressed through each JLPT level. A kanji counts as mastered once your Spaced Repetition System (SRS) interval reaches ~6 months — meaning your brain has proven it can recall the character from genuine long-term memory.',
  },
  {
    title: 'N5 → N1',
    body: 'N5 (103 kanji) is the entry level. N4 adds 181 more for everyday conversation. N3 (276) marks functional reading ability. N2 (367) is required for most Japanese universities and white-collar jobs. N1 (1,367) represents near-native mastery.',
  },
  {
    title: 'Projected completion dates',
    body: 'Dates are estimated by dividing remaining kanji at that level by your current burn rate. They update automatically as your study pace changes — study more consistently and the dates move closer.',
  },
  {
    title: 'Why levels matter',
    body: 'Each JLPT level unlocks a qualitatively new tier of Japanese media, conversation, and reading. Completing N5 lets you handle tourist situations; N4 covers daily life; N3 opens manga and casual social media; N2 covers news and literature; N1 means you can read virtually anything.',
  },
]

const INFO_ACCURACY_BY_TYPE: InfoSection[] = [
  {
    body: 'Accuracy broken down by the four SRS card types over the last 30 days. Each type tests a different dimension of kanji knowledge — weakness in one area is a clear signal of where to focus.',
  },
  {
    title: 'Meaning',
    body: 'You see the kanji and must recall its English meaning. Tests visual recognition — the most common starting point and usually the highest-accuracy type.',
  },
  {
    title: 'Reading',
    body: 'You see the kanji and must produce its On\'yomi or Kun\'yomi reading. Reading recall is typically the hardest type — a low score here is normal and means you\'re working on the most challenging skill.',
  },
  {
    title: 'Writing',
    body: 'You are prompted for the kanji and must draw it stroke by stroke. Stroke order and accuracy are both evaluated. Improves spatial memory and prevents confusing similar-looking characters.',
  },
  {
    title: 'Compound',
    body: 'You see a multi-kanji word and must identify meaning or reading. Compounds test real-world vocabulary and contextual understanding — high compound accuracy indicates practical reading ability.',
  },
]

const INFO_LEADERBOARD: InfoSection[] = [
  {
    body: 'Rankings compare study activity across all users of the app, or within your study group if you\'ve connected with friends. Position is determined by total kanji reviewed and burned since account creation.',
  },
  {
    title: 'Reviewed',
    body: 'Total Spaced Repetition System (SRS) review answers submitted. Each answer is a flashcard graded during a daily review session. A high review count reflects sustained, long-term study effort — though it\'s possible to inflate this number by grinding easy cards.',
  },
  {
    title: 'Burned 🔥',
    body: 'Total kanji burned (mastered). A kanji is burned when the SRS interval reaches ~6 months — meaning your brain has proven it can recall the character from genuine long-term memory, not just recent study. This is the highest-quality signal on the leaderboard and can\'t be faked; it takes months of correct answers.',
  },
  {
    title: 'Streak 🔥',
    body: 'Consecutive days with at least one SRS review session completed. Long streaks signal habit formation — the strongest single predictor of reaching fluency in a foreign language.',
  },
  {
    title: 'A note on competition',
    body: 'Leaderboards are meant for friendly motivation, not pressure. Everyone learns at a different pace. Your SRS intervals, study history, and personal progress are always private and belong to you.',
  },
]

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter()
  const { user } = useAuthStore()
  const { summary, isLoading, isStale, refresh } = useAnalytics()
  const { data: quizData } = useQuizAnalytics()
  const { interventions, dismiss } = useInterventions()
  const { leaderboard } = useSocial()

  // Tracks which panel's info section is currently open (null = all closed)
  const [activeInfo, setActiveInfo] = useState<string | null>(null)
  const toggleInfo = useCallback((id: string) => {
    setActiveInfo((prev) => (prev === id ? null : id))
  }, [])

  const { loadWeakQueue } = useReviewStore()

  const handleStudy = useCallback(() => {
    router.push('/(tabs)/study')
  }, [router])

  const handleQuiz = useCallback(() => {
    router.push('/test')
  }, [router])

  const [isDrillLoading, setIsDrillLoading] = useState(false)

  const handleDrillWeak = useCallback(async () => {
    setIsDrillLoading(true)
    try {
      const ok = await loadWeakQueue(20)
      if (ok) {
        router.push('/(tabs)/study')
      } else {
        Alert.alert(
          'No weak spots found',
          'Great news — your accuracy is above 65% on all recently reviewed kanji. Keep it up!',
          [{ text: 'OK' }]
        )
      }
    } catch {
      Alert.alert('Error', 'Could not load weak kanji. Check your connection.')
    } finally {
      setIsDrillLoading(false)
    }
  }, [loadWeakQueue, router])

  const displayName = user?.user_metadata?.display_name ?? user?.email?.split('@')[0] ?? 'Learner'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good {getTimeOfDay()},</Text>
            <Text style={styles.name}>{displayName}</Text>
          </View>
          <View style={styles.streakBadge}>
            <Ionicons name="flame" size={18} color={colors.accent} />
            <Text style={styles.streakText}>
              {summary?.streakDays ?? 0}
            </Text>
          </View>
        </View>

        {/* Intervention banners */}
        {interventions.map((i) => (
          <InterventionBanner key={i.id} intervention={i} onDismiss={() => dismiss(i.id)} />
        ))}

        {/* Offline / stale data banner */}
        {isStale && <OfflineBanner message="Showing cached data" staleLabel="Offline" />}

        {/* Start study CTA */}
        <TouchableOpacity style={styles.studyButton} onPress={handleStudy} activeOpacity={0.85}>
          <Ionicons name="book" size={22} color="#fff" />
          <Text style={styles.studyButtonText}>Start Today's Reviews</Text>
          <Ionicons name="arrow-forward" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>

        {/* Take a Quiz CTA */}
        <TouchableOpacity style={styles.quizButton} onPress={handleQuiz} activeOpacity={0.85}>
          <Ionicons name="help-circle" size={22} color={colors.accent} />
          <Text style={styles.quizButtonText}>Take a Quiz</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Drill Weak Spots CTA */}
        <TouchableOpacity style={styles.drillButton} onPress={handleDrillWeak} activeOpacity={0.85} disabled={isDrillLoading}>
          {isDrillLoading
            ? <ActivityIndicator size="small" color={colors.error} />
            : <Ionicons name="fitness" size={22} color={colors.error} />
          }
          <Text style={styles.drillButtonText}>Drill Weak Spots</Text>
          {!isDrillLoading && <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />}
        </TouchableOpacity>

        {isLoading && !summary ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        ) : summary ? (
          <>
            {/* Stats row */}
            <View style={styles.statsRow}>
              <StatCard
                label="Accuracy"
                value={`${summary.accuracy}%`}
                subtitle="last 30 days"
                accentColor={colors.success}
              />
              <StatCard
                label="Daily avg"
                value={summary.velocity.dailyAverage}
                subtitle="reviews/day"
                accentColor={colors.accent}
              />
              <StatCard
                label="Mastered"
                value={summary.statusCounts.burned.toLocaleString()}
                subtitle={`of 2,294`}
                accentColor={colors.burned}
              />
            </View>

            {/* ── Kanji Status ── */}
            {/* (info button is built into SrsStatusBar itself) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Kanji Status</Text>
              <SrsStatusBar counts={summary.statusCounts} />
            </View>

            {/* ── Velocity ── */}
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Velocity</Text>
                <View style={styles.cardRowRight}>
                  <TrendBadge trend={summary.velocity.trend} />
                  <InfoButton id="velocity" activeInfo={activeInfo} onToggle={toggleInfo} />
                </View>
              </View>

              {activeInfo === 'velocity' && <InfoPanel sections={INFO_VELOCITY} />}

              {/* Reviews + burn rate */}
              <View style={styles.velocityRow}>
                <Text style={styles.velocityValue}>
                  {summary.velocity.weeklyAverage}
                  <Text style={styles.velocityUnit}> reviews/day</Text>
                </Text>
                {summary.velocity.burnedPerDay > 0 && (
                  <View style={styles.burnedBadge}>
                    <Text style={styles.burnedBadgeText}>
                      🔥 {summary.velocity.burnedPerDay}/day burned
                    </Text>
                  </View>
                )}
              </View>

              {/* Next JLPT milestone */}
              {summary.velocity.nextMilestone && (
                <View style={styles.milestoneRow}>
                  <View style={styles.milestoneLevelBadge}>
                    <Text style={styles.milestoneLevelText}>
                      {summary.velocity.nextMilestone.level}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.milestoneTitle}>
                      {summary.velocity.nextMilestone.burned} / {summary.velocity.nextMilestone.total} kanji mastered
                    </Text>
                    {summary.velocity.nextMilestone.projectedDate ? (
                      <Text style={styles.milestoneDate}>
                        Complete by{' '}
                        {new Date(summary.velocity.nextMilestone.projectedDate).toLocaleDateString('en', {
                          year: 'numeric', month: 'short',
                        })}
                      </Text>
                    ) : (
                      <Text style={styles.milestoneDate}>Start burning kanji to see a projection</Text>
                    )}
                  </View>
                </View>
              )}

              {/* All-kanji long-term projection */}
              {summary.velocity.projectedCompletion && (
                <Text style={styles.projection}>
                  All 2,294 Jouyou kanji:{' '}
                  {new Date(summary.velocity.projectedCompletion).toLocaleDateString('en', {
                    year: 'numeric', month: 'short',
                  })}
                </Text>
              )}
            </View>

            {/* ── Last 7 Days ── */}
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Last 7 Days</Text>
                <InfoButton id="activity" activeInfo={activeInfo} onToggle={toggleInfo} />
              </View>

              {activeInfo === 'activity' && <InfoPanel sections={INFO_ACTIVITY} />}

              <View style={styles.activityBars}>
                {summary.recentStats.slice(0, 7).reverse().map((day) => (
                  <ActivityBar key={day.date} day={day} />
                ))}
              </View>
            </View>

            {/* ── Journey ── */}
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>Journey</Text>
                <View style={styles.cardRowRight}>
                  <Text style={styles.completionPct}>{summary.completionPct}% complete</Text>
                  <InfoButton id="journey" activeInfo={activeInfo} onToggle={toggleInfo} />
                </View>
              </View>

              {activeInfo === 'journey' && <InfoPanel sections={INFO_JOURNEY} />}

              <View style={styles.progressTrack}>
                {summary.totalSeen > 0 && (
                  <View
                    style={[
                      styles.progressFill,
                      {
                        position: 'absolute', top: 0, left: 0, bottom: 0,
                        width: `${Math.max(Math.round((summary.totalSeen / (summary.totalSeen + summary.statusCounts.unseen)) * 100), 2)}%`,
                        backgroundColor: colors.primary + '33',
                      },
                    ]}
                  />
                )}
                {summary.statusCounts.burned > 0 && (
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.max(summary.completionPct, 1)}%` },
                    ]}
                  />
                )}
              </View>
              <Text style={styles.progressLabel}>
                {summary.totalSeen.toLocaleString()} seen · {summary.statusCounts.burned.toLocaleString()} mastered · {summary.statusCounts.unseen.toLocaleString()} remaining
              </Text>
            </View>

            {/* ── JLPT Progress ── */}
            {summary.velocity.levelProjections.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>JLPT Progress</Text>
                  <InfoButton id="jlpt" activeInfo={activeInfo} onToggle={toggleInfo} />
                </View>

                {activeInfo === 'jlpt' && <InfoPanel sections={INFO_JLPT_PROGRESS} />}

                <View style={styles.jlptRows}>
                  {summary.velocity.levelProjections.map((proj) => {
                    const levelKey = proj.level.toLowerCase() as keyof typeof colors
                    const levelColor = colors[levelKey] ?? colors.textMuted
                    const bd = summary.jlptProgress?.[proj.level] ?? { learning: 0, reviewing: 0, remembered: 0, burned: 0 }
                    const totalActive = bd.learning + bd.reviewing + bd.remembered + bd.burned
                    const pct = proj.total > 0 ? Math.round((bd.burned / proj.total) * 100) : 0
                    return (
                      <View key={proj.level} style={styles.jlptRow}>
                        {/* Level badge */}
                        <View style={[styles.jlptBadge, { backgroundColor: levelColor + '22', borderColor: levelColor + '66' }]}>
                          <Text style={[styles.jlptBadgeText, { color: levelColor }]}>{proj.level}</Text>
                        </View>

                        {/* Progress bar + numbers */}
                        <View style={styles.jlptBarCol}>
                          <View style={[styles.jlptBarTrack, { flexDirection: 'row' }]}>
                            {bd.learning > 0 && <View style={{ width: `${(bd.learning / proj.total) * 100}%`, height: '100%', backgroundColor: colors.learning }} />}
                            {bd.reviewing > 0 && <View style={{ width: `${(bd.reviewing / proj.total) * 100}%`, height: '100%', backgroundColor: colors.reviewing }} />}
                            {bd.remembered > 0 && <View style={{ width: `${(bd.remembered / proj.total) * 100}%`, height: '100%', backgroundColor: colors.remembered }} />}
                            {bd.burned > 0 && <View style={{ width: `${(bd.burned / proj.total) * 100}%`, height: '100%', backgroundColor: colors.burned }} />}
                          </View>
                          <View style={styles.jlptBarLabels}>
                            <Text style={styles.jlptCount}>
                              {totalActive}/{proj.total}
                              <Text style={styles.jlptPct}> · {pct}% mastered</Text>
                            </Text>
                            {proj.projectedDate ? (
                              <Text style={styles.jlptDate}>
                                {new Date(proj.projectedDate).toLocaleDateString('en', { year: 'numeric', month: 'short' })}
                              </Text>
                            ) : pct === 100 ? (
                              <Text style={[styles.jlptDate, { color: colors.success }]}>Complete ✓</Text>
                            ) : null}
                          </View>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* ── Review Accuracy by Type ── */}
            {summary.accuracyByType && Object.keys(summary.accuracyByType).length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>Review Accuracy</Text>
                  <InfoButton id="accuracyByType" activeInfo={activeInfo} onToggle={toggleInfo} />
                </View>

                {activeInfo === 'accuracyByType' && <InfoPanel sections={INFO_ACCURACY_BY_TYPE} />}

                <View style={styles.accTypeRows}>
                  {(['meaning', 'reading', 'writing', 'compound'] as const).map((type) => {
                    const stat = summary.accuracyByType[type]
                    if (!stat || stat.total === 0) return null
                    const label = type.charAt(0).toUpperCase() + type.slice(1)
                    const pct = stat.pct
                    const barColor = pct >= 80 ? colors.success : pct >= 60 ? colors.warning : colors.error
                    return (
                      <View key={type} style={styles.accTypeRow}>
                        <Text style={styles.accTypeLabel}>{label}</Text>
                        <View style={styles.accTypeBarWrap}>
                          <View style={styles.accTypeTrack}>
                            <View style={[styles.accTypeFill, { width: `${pct}%`, backgroundColor: barColor }]} />
                          </View>
                          <Text style={[styles.accTypePct, { color: barColor }]}>{pct}%</Text>
                        </View>
                        <Text style={styles.accTypeCount}>{stat.correct}/{stat.total}</Text>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}

            {/* ── Quiz ── */}
            {quizData && quizData.totalSessions > 0 && (
              <TouchableOpacity style={styles.card} onPress={handleQuiz} activeOpacity={0.8}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>Quiz</Text>
                  <View style={styles.cardRowRight}>
                    <View style={[styles.passBadge, { backgroundColor: (quizData.recentSessions[0]?.passed ? colors.success : colors.error) + '22' }]}>
                      <Text style={[styles.passBadgeText, { color: quizData.recentSessions[0]?.passed ? colors.success : colors.error }]}>
                        Last: {quizData.recentSessions[0]?.passed ? 'Pass' : 'Fail'}
                      </Text>
                    </View>
                    <InfoButton id="quiz" activeInfo={activeInfo} onToggle={toggleInfo} />
                  </View>
                </View>

                {activeInfo === 'quiz' && <InfoPanel sections={INFO_QUIZ} />}

                <View style={styles.quizStatRow}>
                  <View style={styles.quizStatItem}>
                    <Text style={styles.quizStatValue}>{quizData.recentSessions[0]?.scorePct ?? 0}%</Text>
                    <Text style={styles.quizStatLabel}>Last score</Text>
                  </View>
                  <View style={styles.quizStatItem}>
                    <Text style={styles.quizStatValue}>{quizData.avgScore}%</Text>
                    <Text style={styles.quizStatLabel}>Avg score</Text>
                  </View>
                  <View style={styles.quizStatItem}>
                    <Text style={styles.quizStatValue}>{quizData.passRate}%</Text>
                    <Text style={styles.quizStatLabel}>Pass rate</Text>
                  </View>
                  <View style={styles.quizStatItem}>
                    <Text style={styles.quizStatValue}>{quizData.totalSessions}</Text>
                    <Text style={styles.quizStatLabel}>Sessions</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          </>
        ) : null}

        {/* ── Leaderboard ── */}
        {leaderboard.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>Leaderboard</Text>
              <View style={styles.cardRowRight}>
                <Text style={styles.lbSubtitle}>
                  {leaderboard.some((e) => !e.isMe) ? 'Study mates' : 'Global top 10'}
                </Text>
                <InfoButton id="leaderboard" activeInfo={activeInfo} onToggle={toggleInfo} />
              </View>
            </View>

            {activeInfo === 'leaderboard' && <InfoPanel sections={INFO_LEADERBOARD} />}

            {leaderboard.map((entry, i) => (
              <View key={entry.userId} style={[styles.lbRow, entry.isMe && styles.lbRowMe]}>
                <Text style={styles.lbRank}>{i + 1}</Text>
                <View style={styles.lbInfo}>
                  <Text style={[styles.lbName, entry.isMe && styles.lbNameMe]} numberOfLines={1}>
                    {entry.displayName ?? 'Unknown'}
                    {entry.isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.lbStats}>
                    {entry.totalReviewed.toLocaleString()} reviewed · {entry.totalBurned.toLocaleString()} burned
                  </Text>
                </View>
                <View style={styles.lbStreak}>
                  <Ionicons name="flame" size={14} color={entry.streak > 0 ? colors.accent : colors.textMuted} />
                  <Text style={[styles.lbStreakText, { color: entry.streak > 0 ? colors.accent : colors.textMuted }]}>
                    {entry.streak}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── InfoButton ───────────────────────────────────────────────────────────────

const INFO_HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 }

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

// ─── TrendBadge ───────────────────────────────────────────────────────────────

function TrendBadge({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  const config = {
    up: { icon: 'trending-up' as const, color: colors.success, label: 'Up' },
    down: { icon: 'trending-down' as const, color: colors.error, label: 'Down' },
    stable: { icon: 'remove' as const, color: colors.textMuted, label: 'Stable' },
  }[trend]

  return (
    <View style={[trendStyles.badge, { backgroundColor: config.color + '22' }]}>
      <Ionicons name={config.icon} size={14} color={config.color} />
      <Text style={[trendStyles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  )
}

const trendStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  label: { ...typography.caption, fontWeight: '600' },
})

// ─── ActivityBar ──────────────────────────────────────────────────────────────

function ActivityBar({ day }: { day: { date: string; reviewed: number } }) {
  const MAX = 50
  const pct = Math.min((day.reviewed / MAX) * 100, 100)
  const weekday = new Date(day.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'narrow' })

  return (
    <View style={barStyles.container}>
      <View style={barStyles.track}>
        <View style={[barStyles.fill, { height: `${Math.max(pct, 4)}%` }]} />
      </View>
      <Text style={barStyles.label}>{weekday}</Text>
    </View>
  )
}

const barStyles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '60%', backgroundColor: colors.bgSurface, borderRadius: radius.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  fill: { width: '100%', backgroundColor: colors.primary, borderRadius: radius.sm },
  label: { ...typography.caption, color: colors.textMuted },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  greeting: { ...typography.bodySmall, color: colors.textSecondary },
  name: { ...typography.h2, color: colors.textPrimary },
  streakBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgCard, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  streakText: { ...typography.h3, color: colors.accent },
  studyButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg },
  studyButtonText: { ...typography.h3, color: '#fff', flex: 1, textAlign: 'center' },
  quizButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  quizButtonText: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  drillButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.bgCard, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.error + '44', paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  drillButtonText: { ...typography.h3, color: colors.error, flex: 1, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  card: { backgroundColor: colors.bgCard, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardTitle: { ...typography.h3, color: colors.textPrimary },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  velocityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs },
  velocityValue: { ...typography.h2, color: colors.textPrimary },
  velocityUnit: { ...typography.body, color: colors.textSecondary, fontWeight: '400' },
  burnedBadge: { backgroundColor: colors.accent + '22', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  burnedBadgeText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.bgSurface, borderRadius: radius.md, padding: spacing.sm },
  milestoneLevelBadge: { backgroundColor: colors.primary + '22', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  milestoneLevelText: { ...typography.h3, color: colors.primary },
  milestoneTitle: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '600' },
  milestoneDate: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  projection: { ...typography.caption, color: colors.textMuted },
  activityBars: { flexDirection: 'row', height: 80, gap: spacing.xs, alignItems: 'flex-end' },
  progressTrack: { height: 8, backgroundColor: colors.bgSurface, borderRadius: radius.full, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: radius.full },
  progressLabel: { ...typography.caption, color: colors.textMuted },
  completionPct: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },

  // Quiz card
  passBadge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  passBadgeText: { ...typography.caption, fontWeight: '700' },
  quizStatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quizStatItem: { alignItems: 'center', gap: 2 },
  quizStatValue: { ...typography.h3, color: colors.textPrimary },
  quizStatLabel: { ...typography.caption, color: colors.textMuted },

  // JLPT Progress
  jlptRows: { gap: spacing.sm, marginTop: spacing.xs },
  jlptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  jlptBadge: {
    width: 36, height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jlptBadgeText: { ...typography.caption, fontWeight: '800', letterSpacing: 0.5 },
  jlptBarCol: { flex: 1, gap: 3 },
  jlptBarTrack: {
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  jlptBarFill: { height: '100%', borderRadius: radius.full },
  jlptBarLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jlptCount: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  jlptPct: { ...typography.caption, color: colors.textMuted, fontWeight: '400' },
  jlptDate: { ...typography.caption, color: colors.textMuted },

  // Accuracy by Type
  accTypeRows: { gap: spacing.sm, marginTop: spacing.xs },
  accTypeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  accTypeLabel: { ...typography.bodySmall, color: colors.textSecondary, width: 68, fontWeight: '600' },
  accTypeBarWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  accTypeTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  accTypeFill: { height: '100%', borderRadius: radius.full },
  accTypePct: { ...typography.caption, fontWeight: '700', width: 32, textAlign: 'right' },
  accTypeCount: { ...typography.caption, color: colors.textMuted, width: 44, textAlign: 'right' },

  // Leaderboard
  lbSubtitle: { ...typography.caption, color: colors.textMuted },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lbRowMe: { backgroundColor: colors.primary + '11', borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  lbRank: { ...typography.bodySmall, color: colors.textMuted, fontWeight: '700', width: 20, textAlign: 'center' },
  lbInfo: { flex: 1, gap: 1 },
  lbName: { ...typography.body, color: colors.textPrimary },
  lbNameMe: { color: colors.primary, fontWeight: '600' },
  lbStats: { ...typography.caption, color: colors.textMuted },
  lbStreak: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  lbStreakText: { ...typography.bodySmall, fontWeight: '700' },
})
