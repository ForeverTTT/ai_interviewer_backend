const CHINA_TIME_ZONE = 'Asia/Shanghai'

const chinaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CHINA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Return the calendar date in mainland China as YYYY-MM-DD. */
export function chinaCalendarDate(now = Date.now()) {
  const parts = Object.fromEntries(
    chinaDateFormatter.formatToParts(new Date(now))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Shift a YYYY-MM-DD calendar date without involving the host machine timezone. */
export function shiftCalendarDate(date, days) {
  const [year, month, day] = String(date).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function chinaCalendarDateDaysAgo(days, now = Date.now()) {
  return shiftCalendarDate(chinaCalendarDate(now), -days)
}
