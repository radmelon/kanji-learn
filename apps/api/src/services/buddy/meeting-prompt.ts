import { nextRequirement, type BeatKind, type CollectedState } from '@kanji-learn/shared'

const BEAT_GOALS: Record<Exclude<BeatKind, 'done'>, string> = {
  intro: 'Introduce yourself briefly and warmly.',
  orientation: 'Explain how this works: daily study, a weekly meeting, and a shared notebook that holds what you decide together.',
  why: 'Learn why they are learning Japanese (reasons) and what they are into (interests).',
  frame_ask: 'Their reasons are ambiguous. Find out: JLPT/work-driven, or personal (heritage, curiosity)? Set explicitRuler from the answer.',
  meaning: 'Propose a daily study goal in minutes based on their reasons; let them counter. Set dailyGoal.',
  meet: 'Negotiate the weekly meeting day (0=Sunday..6=Saturday) and interval (1 or 2 weeks). Set buddyDay and buddyIntervalWeeks.',
  ask: 'Ask them to take the placement test before the first meeting, and say what it buys: a specific plan to reach their goals.',
}

export function buildMeetingPrompt(
  beat: Exclude<BeatKind, 'done'>,
  collected: CollectedState,
): string {
  const unmet = nextRequirement(collected)
  return [
    "You are Buddy, a kanji-learning companion meeting a learner for the first time. Honest, warm, brief — two or three sentences per reply, no lists, no emoji.",
    `Current beat: ${beat}. Goal: ${BEAT_GOALS[beat]}`,
    `Already collected (NEVER re-ask for these): ${JSON.stringify(collected)}`,
    `Next unmet requirement: ${unmet ?? 'none — move toward closing'}`,
    'Respond with ONLY a JSON object, no prose outside it, in exactly this shape:',
    '{"reply": "<what you say to the learner>", "patch": {<any of: reasons (string[]), interests (string[]), explicitRuler ("jlpt"|"grade"), dailyGoal (int minutes), buddyDay (int 0-6), buddyIntervalWeeks (1|2)>}}',
    'Only include patch keys the learner actually just gave you. Empty patch is {}.',
  ].join('\n')
}
