/**
 * The device's IANA timezone, e.g. 'America/Los_Angeles'.
 *
 * Root cause A (BUGS.md, 2026-07-26): nothing has ever written
 * user_profiles.timezone, so every account kept its 'UTC' default and
 * reminderHour — documented as being in the learner's timezone — was evaluated
 * against UTC. A 20:00 reminder arrived at 1pm PDT. Three months of "the
 * reminders are broken" was, in part, this.
 *
 * Only the device knows its own zone, which is why the fix is a client sync
 * and not a backfill migration.
 */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Whether the stored profile timezone should be overwritten with the device's.
 *
 * Kept as a separate predicate so the decision is testable without a renderer,
 * and so the "don't PATCH on every launch" rule is stated once rather than
 * living inside an effect.
 */
export function shouldSyncTimezone(stored: string | null | undefined, device: string): boolean {
  if (!stored) return true
  return stored !== device
}
