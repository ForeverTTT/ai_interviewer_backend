import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLenovoSocialJobsSnapshot, parseLenovoJobDetail } from '../src/lib/lenovoSocialJobImport.js'

const detail = `
<h2 class="banner__text__title banner__text__title--0">AI 产品经理</h2>
<div class="article__content__view__field__label">Req #</div><div class="article__content__view__field__value">WD001</div>
<div class="article__content__view__field__label">Career area:</div><div class="article__content__view__field__value">Product Management</div>
<div class="article__content__view__field__label">City:</div><div class="article__content__view__field__value">北京（Beijing）</div>
<div class="article__content__view__field__label">Date:</div><div class="article__content__view__field__value">Friday, October 23, 2026</div>
<article><div class="article__header"><h3>Description and Requirements</h3></div><div class="article__content"><div class="article__content__view"><div class="article__content__view__field__value"><p>岗位职责</p><p>负责 AI 产品。</p><p>岗位要求</p><p>本科及以上。</p></div></div></div></article>
<a class="button button--primary" href="https://jobs.lenovo.com/en_US/careers/Login?jobId=1">Apply</a>`

test('联想社招详情保留 JD、发布时间和官方投递入口', () => {
  const row = parseLenovoJobDetail(detail, 'https://jobs.lenovo.com/en_US/careers/JobDetail/AI/1')
  assert.equal(row.招聘岗位, 'AI 产品经理')
  assert.equal(row.职位ID, 'WD001')
  assert.equal(row.发布时间, '2026-10-23')
  assert.match(row.职位描述, /负责 AI 产品/)
  assert.equal(row.简历投递链接, 'https://jobs.lenovo.com/en_US/careers/Login?jobId=1')
})

test('联想社招遍历列表并补齐所有详情', async () => {
  const fetchImpl = async input => {
    const url = String(input)
    if (url.includes('JobDetail')) return new Response(detail)
    const offset = Number(new URL(url).searchParams.get('jobOffset'))
    if (offset === 0) return new Response('<a href="https://jobs.lenovo.com/en_US/careers/JobDetail/AI/1">职位</a>')
    return new Response('<html></html>')
  }
  const result = await fetchLenovoSocialJobsSnapshot({ fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 1)
})

test('联想详情失败时快照不完整', async () => {
  const fetchImpl = async input => String(input).includes('JobDetail')
    ? new Response('error', { status: 500 })
    : new Response(String(input).includes('jobOffset=0') ? '<a href="https://jobs.lenovo.com/en_US/careers/JobDetail/AI/1">职位</a>' : '')
  const result = await fetchLenovoSocialJobsSnapshot({ fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.diagnostics.failures.length, 1)
})
