import {describe, expect, it} from 'vitest'

import {formatAddedAt} from '../formatAddedAt'

const NOW = new Date('2026-07-01T12:00:00Z')

function secondsBefore(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString()
}

function minutesBefore(minutes: number): string {
  return secondsBefore(minutes * 60)
}

function hoursBefore(hours: number): string {
  return minutesBefore(hours * 60)
}

function daysBefore(days: number): string {
  return hoursBefore(days * 24)
}

describe('formatAddedAt', () => {
  it('returns "just now" for a timestamp ~30 seconds before now', () => {
    expect(formatAddedAt(secondsBefore(30), NOW)).toBe('just now')
  })

  it('returns a string containing "minute" for a timestamp ~5 minutes before now', () => {
    expect(formatAddedAt(minutesBefore(5), NOW)).toContain('minute')
  })

  it('returns a string containing "hour" for a timestamp ~3 hours before now', () => {
    expect(formatAddedAt(hoursBefore(3), NOW)).toContain('hour')
  })

  it('returns a string containing "day" for a timestamp ~2 days before now', () => {
    expect(formatAddedAt(daysBefore(2), NOW)).toContain('day')
  })

  it('returns the raw string without throwing when given an invalid timestamp', () => {
    const invalid = 'not-a-date'
    expect(() => formatAddedAt(invalid, NOW)).not.toThrow()
    expect(formatAddedAt(invalid, NOW)).toBe(invalid)
  })
})
