import { eq } from 'drizzle-orm'
import { tutorShares, tutorAnalysisCache } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { TutorAnalysis } from '@kanji-learn/shared'
import { TutorReportService } from './tutor-report.service.js'
import type { ReportData } from './tutor-report.service.js'

// ─── TutorAnalysisService ──────────────────────────────────────────────────────

export class TutorAnalysisService {
  private reportService: TutorReportService

  constructor(
    private db: Db,
    private llm: any,
  ) {
    this.reportService = new TutorReportService(db)
  }

  // ── Batch: compute analysis for all active shares ──────────────────────────

  async computeAllActive(): Promise<{ computed: number; errors: number }> {
    const rows = await this.db
      .select({ userId: tutorShares.userId })
      .from(tutorShares)
      .where(eq(tutorShares.status, 'accepted'))

    // Deduplicate userIds
    const userIds = [...new Set(rows.map((r) => r.userId))]

    let computed = 0
    let errors = 0

    for (const userId of userIds) {
      try {
        await this.computeForUser(userId)
        computed++
      } catch (err) {
        console.error(`[TutorAnalysisService] computeForUser failed for userId=${userId}:`, err)
        errors++
      }
    }

    return { computed, errors }
  }

  // ── Compute analysis for a single user ────────────────────────────────────

  async computeForUser(userId: string, preferredTier: 1 | 2 | 3 = 3): Promise<TutorAnalysis> {
    // Find the accepted share to get shareId
    const share = await this.db.query.tutorShares.findFirst({
      where: eq(tutorShares.userId, userId),
      // accepted status filter
    })

    // Build the full report
    const shareId = share?.id ?? userId
    const report = await this.reportService.buildReport(userId, shareId)

    // Build prompt
    const prompt = this.buildAnalysisPrompt(report)

    const systemPrompt =
      'You are a Japanese language teaching advisor. You are analyzing student learning data on behalf of their tutor. ' +
      'Your job is to provide concise, actionable insights about the student\'s progress, strengths, weaknesses, and areas for improvement. ' +
      'You MUST respond with valid JSON only — no markdown, no prose, no explanation outside the JSON object.'

    let analysis: TutorAnalysis

    try {
      const result = await this.llm.route({
        context: 'deep_diagnostic',
        userId,
        userOptedInPremium: true, // System-initiated analysis — bypass premium gate for Claude (tier 3)
        systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        preferredTier,
        maxTokens: 1024,
        temperature: 0.3,
      })

      // Strip markdown code fences if the LLM wraps the JSON (e.g. ```json ... ```)
      let raw = result.content.trim()
      // Try to extract JSON from inside code fences first
      const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
      if (fenceMatch) {
        raw = fenceMatch[1].trim()
      }
      // Fallback: extract first { ... } block if still not valid JSON
      if (!raw.startsWith('{')) {
        const braceMatch = raw.match(/\{[\s\S]*\}/)
        if (braceMatch) raw = braceMatch[0]
      }
      const parsed = JSON.parse(raw)
      analysis = {
        strengths: parsed.strengths ?? [],
        areasForImprovement: parsed.areasForImprovement ?? [],
        recommendations: parsed.recommendations ?? [],
        observations: parsed.observations ?? [],
        generatedAt: new Date().toISOString(),
      }
    } catch (err) {
      console.error(`[TutorAnalysisService] LLM call or JSON parse failed for userId=${userId}:`, err)
      analysis = {
        strengths: [],
        areasForImprovement: [],
        recommendations: [],
        observations: [`Analysis generation failed: ${err instanceof Error ? err.message : 'unknown error'}`],
        generatedAt: new Date().toISOString(),
      }
    }

    // Upsert into tutorAnalysisCache
    await this.db
      .insert(tutorAnalysisCache)
      .values({
        userId,
        analysisJson: analysis,
        generatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: tutorAnalysisCache.userId,
        set: {
          analysisJson: analysis,
          generatedAt: new Date(),
        },
      })

    return analysis
  }

  // ── Build the analysis prompt from report data ─────────────────────────────

  private buildAnalysisPrompt(data: ReportData): string {
    const { student, progress, velocity, quizAccuracy, effort, placement } = data

    // Student profile
    const learnerSince = student.createdAt
      ? new Date(student.createdAt).toISOString().slice(0, 10)
      : 'unknown'
    const reasons = student.reasonsForLearning.length > 0
      ? student.reasonsForLearning.join(', ')
      : 'not specified'
    const country = student.country ?? 'not specified'

    // Progress
    const statusLines = Object.entries(progress.statusCounts)
      .map(([status, count]) => `  ${status}: ${count}`)
      .join('\n')

    // Quiz accuracy by type
    const accuracyLines = Object.entries(quizAccuracy.byType)
      .map(([type, stats]: [string, { correct: number; total: number; pct: number }]) => `  ${type}: ${stats.correct}/${stats.total} (${stats.pct}%)`)
      .join('\n')

    // Leeches
    const leechLines = quizAccuracy.topLeeches.length > 0
      ? quizAccuracy.topLeeches
          .map((l: { character: string; failCount: number }) => `  ${l.character} (${l.failCount} failures)`)
          .join('\n')
      : '  none'

    // Placement history
    const placementLines = placement.sessions.length > 0
      ? placement.sessions
          .map((s) => {
            const date = s.completedAt ? new Date(s.completedAt).toISOString().slice(0, 10) : 'incomplete'
            return `  ${date}: inferred level = ${s.inferredLevel ?? 'unknown'}`
          })
          .join('\n')
      : '  no placement sessions'

    // Effort — active days (days with reviewed > 0) in last 30 days
    const activeDays30 = data.effort.dailyStats30.filter((d) => d.reviewed > 0).length

    const prompt = `
You are analyzing learning data for a student of Japanese kanji. The tutor reviewing this data needs actionable insights.

=== STUDENT PROFILE ===
Name: ${student.displayName ?? 'anonymous'}
Learning since: ${learnerSince}
Daily goal: ${student.dailyGoal} reviews/day
Country: ${country}
Reasons for learning: ${reasons}

=== PROGRESS ===
Total kanji seen: ${progress.totalSeen} of 2136 Jōyō (${progress.completionPct}%)
Remembered count (solidly retained): ${progress.rememberedCount}
Status breakdown:
${statusLines}

=== VELOCITY ===
Daily average (last 30 days): ${velocity.dailyAvg} reviews/day
Weekly average (last 7 days): ${velocity.weeklyAvg} reviews/day
Trend: ${velocity.trend}
Current streak: ${velocity.currentStreak} days
Longest streak: ${velocity.longestStreak} days

=== QUIZ ACCURACY BY TYPE (last 30 days) ===
${accuracyLines || '  no review data'}
Weakest modality: ${quizAccuracy.weakestModality ?? 'none identified'}
Total leeches (kanji failed ≥3 times): ${quizAccuracy.leechCount}
Top leeches:
${leechLines}

=== PLACEMENT HISTORY ===
${placementLines}

=== EFFORT (last 30 days) ===
Active study days: ${activeDays30} of 30
Sessions per day (avg): ${effort.avgSessionsPerDay}
Weekend vs weekday review ratio: ${effort.weekendVsWeekdayRatio} (1.0 = equal; >1 = more on weekends)

Respond with JSON matching this exact schema: { strengths: string[], areasForImprovement: string[], recommendations: string[], observations: string[] }. Each array should have 2-4 items. Be specific — reference numbers, percentages, and kanji characters from the data.
`.trim()

    return prompt
  }
}
