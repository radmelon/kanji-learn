import { deviceTimezone, shouldSyncTimezone } from '../../src/lib/timezone'

/**
 * Root cause A (BUGS.md, 2026-07-26): nothing has ever written
 * user_profiles.timezone, so every account keeps the 'UTC' default and
 * reminderHour — documented as being in the learner's timezone — is evaluated
 * against UTC. A 20:00 reminder arrives at 1pm PDT.
 *
 * Confirmed live on 2026-07-27: the deployed server logged
 * "5/5 users have no captured timezone".
 */

describe('deviceTimezone', () => {
  it('returns a real IANA zone', () => {
    expect(deviceTimezone()).toMatch(/^[A-Za-z]+(\/[A-Za-z_+-]+)+$|^UTC$/)
  })

  it('falls back to UTC when Intl is unavailable', () => {
    const original = Intl.DateTimeFormat
    // @ts-expect-error — simulating a stripped Intl build
    Intl.DateTimeFormat = undefined
    expect(deviceTimezone()).toBe('UTC')
    Intl.DateTimeFormat = original
  })

  it('never returns an empty string', () => {
    // An empty timezone would be written to the profile and read back as a
    // valid-looking value that Intl then rejects — worse than the UTC default.
    expect(deviceTimezone().length).toBeGreaterThan(0)
  })
})

describe('shouldSyncTimezone', () => {
  it('syncs when the stored zone is the never-written UTC default', () => {
    expect(shouldSyncTimezone('UTC', 'America/Los_Angeles')).toBe(true)
  })

  it('syncs when the learner has travelled', () => {
    expect(shouldSyncTimezone('America/Los_Angeles', 'Asia/Tokyo')).toBe(true)
  })

  it('does NOT sync when they already match', () => {
    // Every profile load would otherwise PATCH, on every launch, forever.
    expect(shouldSyncTimezone('Asia/Tokyo', 'Asia/Tokyo')).toBe(false)
  })

  it('syncs when the stored zone is null or empty', () => {
    expect(shouldSyncTimezone(null, 'Asia/Tokyo')).toBe(true)
    expect(shouldSyncTimezone('', 'Asia/Tokyo')).toBe(true)
  })

  it('does NOT sync a device that resolved to UTC over a stored UTC', () => {
    // A learner genuinely in UTC is indistinguishable from the default, and
    // writing the same value achieves nothing.
    expect(shouldSyncTimezone('UTC', 'UTC')).toBe(false)
  })
})
