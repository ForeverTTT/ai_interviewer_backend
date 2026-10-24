import test from 'node:test'
import assert from 'node:assert/strict'

import { chinaCalendarDate, daysUntilChinaDeadline } from '../src/lib/chinaDate.js'

test('job deadline day follows mainland China time', () => {
  const afterChinaMidnight = Date.UTC(2026, 9, 23, 16, 30)
  assert.equal(chinaCalendarDate(afterChinaMidnight), '2026-10-24')
  assert.equal(daysUntilChinaDeadline('2026-10-23', afterChinaMidnight), -1)
  assert.equal(daysUntilChinaDeadline('2026-10-24', afterChinaMidnight), 0)
  assert.equal(daysUntilChinaDeadline('2026-10-31', afterChinaMidnight), 7)
})
