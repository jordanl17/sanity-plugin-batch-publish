const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7
const WEEKS_PER_MONTH = 4.345
const MONTHS_PER_YEAR = 12

const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY
const SECONDS_PER_WEEK = SECONDS_PER_DAY * DAYS_PER_WEEK
const SECONDS_PER_MONTH = SECONDS_PER_WEEK * WEEKS_PER_MONTH
const SECONDS_PER_YEAR = SECONDS_PER_MONTH * MONTHS_PER_YEAR

const JUST_NOW_THRESHOLD_SECONDS = 60

const formatter = new Intl.RelativeTimeFormat('en', {numeric: 'auto'})

/**
 * Formats an ISO timestamp as a human-readable relative time string (e.g. "just now",
 * "3 minutes ago", "2 hours ago", "5 days ago").
 *
 * Accepts an injectable `now` parameter so tests are deterministic. Falls back to returning
 * the raw timestamp string when the input cannot be parsed as a valid date.
 *
 * @public
 */
export function formatAddedAt(isoTimestamp: string, now: Date = new Date()): string {
  const parsed = new Date(isoTimestamp)

  if (isNaN(parsed.getTime())) {
    return isoTimestamp
  }

  const elapsedSeconds = (now.getTime() - parsed.getTime()) / MILLISECONDS_PER_SECOND

  if (elapsedSeconds < JUST_NOW_THRESHOLD_SECONDS) {
    return 'just now'
  }

  if (elapsedSeconds < SECONDS_PER_HOUR) {
    return formatter.format(-Math.round(elapsedSeconds / SECONDS_PER_MINUTE), 'minute')
  }

  if (elapsedSeconds < SECONDS_PER_DAY) {
    return formatter.format(-Math.round(elapsedSeconds / SECONDS_PER_HOUR), 'hour')
  }

  if (elapsedSeconds < SECONDS_PER_WEEK) {
    return formatter.format(-Math.round(elapsedSeconds / SECONDS_PER_DAY), 'day')
  }

  if (elapsedSeconds < SECONDS_PER_MONTH) {
    return formatter.format(-Math.round(elapsedSeconds / SECONDS_PER_WEEK), 'week')
  }

  if (elapsedSeconds < SECONDS_PER_YEAR) {
    return formatter.format(-Math.round(elapsedSeconds / SECONDS_PER_MONTH), 'month')
  }

  return formatter.format(-Math.round(elapsedSeconds / SECONDS_PER_YEAR), 'year')
}
