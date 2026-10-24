import test from 'node:test'
import assert from 'node:assert/strict'
import { assessJobQuality } from '../src/lib/jobQuality.js'

test('scores completeness and provenance without judging the role itself', () => {
  assert.deepEqual(assessJobQuality({ sourceType: 'official', jobDescription: '完整职责'.repeat(40), applyUrl: 'https://x.test' }), {
    content_quality: 'full', quality_score: 100,
  })
  assert.equal(assessJobQuality({ sourceType: 'ats', jobDescription: '完整职责'.repeat(40) }).quality_score, 90)
  assert.deepEqual(assessJobQuality({ isLegacyAggregate: true, applyUrl: 'https://x.test' }), {
    content_quality: 'aggregate', quality_score: 30,
  })
  assert.deepEqual(assessJobQuality({}), { content_quality: 'link_only', quality_score: 15 })
})
