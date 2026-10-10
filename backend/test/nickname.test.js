import test from 'node:test'
import assert from 'node:assert/strict'

import { validateNickname, normalizeNickname } from '../src/lib/nickname.js'
import { displayPublisher, experienceSchema } from '../src/routes/experiences.js'

test('accepts normal nicknames and tidies whitespace', () => {
  assert.deepEqual(validateNickname('  求职 小白  '), { ok: true, value: '求职 小白' })
  assert.deepEqual(validateNickname('Lena_M'), { ok: true, value: 'Lena_M' })
  assert.deepEqual(validateNickname('秋招冲冲冲2027'), { ok: true, value: '秋招冲冲冲2027' })
  assert.equal(normalizeNickname('a   b'), 'a b')
})

test('enforces length by characters, not bytes', () => {
  assert.equal(validateNickname('甲').code, 'NICKNAME_LENGTH')
  assert.equal(validateNickname('甲乙').ok, true)
  assert.equal(validateNickname('一'.repeat(20)).ok, true)
  assert.equal(validateNickname('一'.repeat(21)).code, 'NICKNAME_LENGTH')
  assert.equal(validateNickname('   ').code, 'NICKNAME_LENGTH')
})

test('rejects contact details, odd characters and reserved names', () => {
  assert.equal(validateNickname('me@example.com').code, 'NICKNAME_CONTACT')
  assert.equal(validateNickname('www.mysite').code, 'NICKNAME_CONTACT')
  assert.equal(validateNickname('138 0013 8000').code, 'NICKNAME_CONTACT')
  assert.equal(validateNickname('<script>').code, 'NICKNAME_CHARS')
  assert.equal(validateNickname('小明😀').code, 'NICKNAME_CHARS')
  assert.equal(validateNickname('匿名荷包蛋').code, 'NICKNAME_RESERVED')
  assert.equal(validateNickname('FlowLab官方').code, 'NICKNAME_RESERVED')
  assert.equal(validateNickname('Admin').code, 'NICKNAME_RESERVED')
})

test('display name: anonymous hides, nickname wins, older posts keep their stored name', () => {
  const nicknames = new Map([['u1', '新昵称']])
  assert.equal(displayPublisher({ user_id: 'u1', anonymous: true, publisher: '旧名' }, nicknames), null)
  assert.equal(displayPublisher({ user_id: 'u1', anonymous: false, publisher: '旧名' }, nicknames), '新昵称')
  assert.equal(displayPublisher({ user_id: 'u2', anonymous: false, publisher: 'Zhang San' }, nicknames), 'Zhang San')
  assert.equal(displayPublisher({ user_id: null, anonymous: false, publisher: null }, nicknames), null, 'imported posts stay anonymous')
})

test('experience schema accepts the anonymous flag', () => {
  const base = { type: 'campus', company: 'A', position: 'B', date: '2026-10' }
  assert.equal(experienceSchema.parse({ ...base, anonymous: true }).anonymous, true)
  assert.equal(experienceSchema.parse(base).anonymous, undefined)
  assert.equal(experienceSchema.safeParse({ ...base, anonymous: 'yes' }).success, false)
})
