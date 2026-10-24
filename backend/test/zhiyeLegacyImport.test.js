import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLegacyZhiyeJobsSnapshot, parseLegacyZhiyeDetail, parseLegacyZhiyeList } from '../src/lib/zhiyeLegacyImport.js'

const LIST = `
<ul><li><a href="/campusxq?jobId=390852397&amp;jc=2" class="flex-between">
<span>技术研发类</span><span>工艺研发工程师（2027届校招）(J13287)</span><span>硕士、博士</span><span>上海市</span><span><b>查看职位</b></span>
</a></li></ul><a href='/campus/?PageIndex=23'>23</a>`

const DETAIL = `
<h2>工艺研发工程师（2027届校招）(J13287)</h2>
<li><span>职位类别：</span><b>技术研发类</b></li><li><span>职位学历：</span><b>硕士、博士</b></li>
<li><span>更新时间：</span><b>2026.08.10</b></li><li><span>工作地点：</span><b>上海市</b></li>
<h3>职位描述</h3><div class="xqm">负责芯片工艺研发<br/>搭建平台</div>
<h3>职位要求</h3><div class="xqm">微电子相关专业</div>`

test('解析旧版智业列表、分页和实体编码链接', () => {
  const result = parseLegacyZhiyeList(LIST, 'https://smics.zhiye.com')
  assert.equal(result.pageCount, 23)
  assert.equal(result.rows[0].id, '390852397')
  assert.equal(result.rows[0].url, 'https://smics.zhiye.com/campusxq?jobId=390852397&jc=2')
})

test('解析旧版智业完整岗位详情', () => {
  const summary = parseLegacyZhiyeList(LIST, 'https://smics.zhiye.com').rows[0]
  const row = parseLegacyZhiyeDetail(DETAIL, summary, { companyName: '中芯国际', category: '校园招聘' })
  assert.equal(row.招聘岗位, '工艺研发工程师（2027届校招）(J13287)')
  assert.equal(row.职位描述, '岗位职责\n负责芯片工艺研发\n搭建平台\n\n任职要求\n微电子相关专业')
  assert.equal(row.批次, '秋招')
  assert.equal(row.更新时间, '2026-08-10')
})

test('旧版智业全量同步翻页并读取每条详情', async () => {
  const calls = []
  const result = await fetchLegacyZhiyeJobsSnapshot({
    companyName: '中芯国际', startUrl: 'https://smics.zhiye.com/campus/jobs', wait: async () => {},
    fetchImpl: async url => {
      calls.push(String(url))
      if (String(url).includes('xq?')) return { ok: true, text: async () => DETAIL }
      if (String(url).includes('PageIndex=2')) return { ok: true, text: async () => LIST.replace('390852397', '390852398').replace('PageIndex=23', 'PageIndex=2') }
      return { ok: true, text: async () => LIST.replace('PageIndex=23', 'PageIndex=2') }
    },
  })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.ok(calls.includes('https://smics.zhiye.com/campus/?PageIndex=2'))
})

test('旧版智业抽样快照不会触发岗位下架', async () => {
  const result = await fetchLegacyZhiyeJobsSnapshot({
    companyName: '中芯国际', startUrl: 'https://smics.zhiye.com/campus/jobs', limit: 1,
    fetchImpl: async url => ({ ok: true, text: async () => String(url).includes('xq?') ? DETAIL : LIST }),
  })
  assert.equal(result.complete, false)
  assert.equal(result.diagnostics.capped, true)
})
