import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchIntelChinaJobsSnapshot, intelJobToRow } from '../src/lib/intelJobImport.js'

test('英特尔详情按 Workday Job Type 区分社招、校招和实习', () => {
  const base = { id: '1', jobReqId: 'JR1', title: 'Software Engineer', location: 'PRC, Shanghai', startDate: '2026-10-23', externalUrl: 'https://intel.example/job/JR1' }
  const social = intelJobToRow({ ...base, jobDescription: '<h2>Job Description:</h2>Build systems<h2>Job Type:</h2>Experienced Hire' })
  const campus = intelJobToRow({ ...base, jobDescription: '<p>Build systems</p><h2>Job Type:</h2>College Grad' })
  const intern = intelJobToRow({ ...base, jobDescription: '<p>Build systems</p><h2>Job Type:</h2>Student / Intern' })
  assert.equal(social.批次, '社招')
  assert.equal(campus.批次, '秋招')
  assert.equal(intern.批次, '实习')
  assert.equal(intern.发布时间, '2026-10-23')
  assert.equal(intern.简历投递链接, 'https://intel.example/job/JR1')
})

test('英特尔适配器动态发现中国地点、完整分页并读取详情', async () => {
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) })
    if (url.endsWith('/jobs')) {
      const body = JSON.parse(options.body)
      if (!body.appliedFacets.locations) return Response.json({ facets: [{ facetParameter: 'locationMainGroup', values: [{ values: [
        { descriptor: 'PRC, Beijing', id: 'cn-1' },
        { descriptor: 'US, Austin', id: 'us-1' },
      ] }] }] })
      const ids = body.offset === 0 ? [1, 2] : [3]
      return Response.json({ total: 3, jobPostings: ids.map(id => ({ externalPath: `/job/role-${id}` })) })
    }
    const id = url.at(-1)
    return Response.json({ jobPostingInfo: { id, jobReqId: `JR${id}`, title: `岗位${id}`, jobDescription: '<p>完整 JD</p><h2>Job Type:</h2>College Grad', externalUrl: `https://intel.example/job/${id}` } })
  }
  const result = await fetchIntelChinaJobsSnapshot({ pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  const listRequests = requests.filter(request => request.url.endsWith('/jobs') && request.body?.appliedFacets?.locations)
  assert.deepEqual(listRequests.map(request => request.body.offset), [0, 2])
  assert.deepEqual(listRequests[0].body.appliedFacets.locations, ['cn-1'])
})

test('英特尔详情失败时不执行完整快照下架', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/jobs')) {
      const body = JSON.parse(options.body)
      if (!body.appliedFacets.locations) return Response.json({ facets: [{ facetParameter: 'locationMainGroup', values: [{ values: [{ descriptor: 'PRC, Shanghai', id: 'cn' }] }] }] })
      return Response.json({ total: 1, jobPostings: [{ externalPath: '/job/role-1' }] })
    }
    return new Response('error', { status: 500 })
  }
  const result = await fetchIntelChinaJobsSnapshot({ fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.diagnostics.failures.length, 1)
})
