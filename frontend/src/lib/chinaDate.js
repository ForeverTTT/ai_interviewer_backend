const DAY_MS = 24 * 60 * 60 * 1000

const chinaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function chinaCalendarDate(now = Date.now()) {
  const parts = Object.fromEntries(
    chinaDateFormatter.formatToParts(new Date(now))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function utcCalendarValue(date) {
  const [year, month, day] = String(date).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function daysUntilChinaDeadline(deadlineDate, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadlineDate || ''))) return null
  return Math.round((utcCalendarValue(deadlineDate) - utcCalendarValue(chinaCalendarDate(now))) / DAY_MS)
}
