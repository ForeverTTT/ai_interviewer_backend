import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLixiangJobsSnapshot, lixiangJobToRow } from '../src/lib/lixiangJobImport.js'

test('理想汽车社招岗位保留完整 JD 和官网详情页', () => {
  const row = lixiangJobToRow({
    id: 4353,
    code: 'F7584',
    title: '整车项目开发经理',
    location_title: '北京',
    department_title: '项目管理',
    second_job_function_title: '汽车研发',
    description: '<p>负责整车项目开发</p>',
    requirements: '<p>具备项目管理经验</p>',
  })
  assert.equal(row.批次, '社招')
  assert.match(row.职位描述, /岗位职责\n负责整车项目开发/)
  assert.match(row.职位描述, /任职要求\n具备项目管理经验/)
  assert.equal(row.职位详情链接, 'https://www.lixiang.com/employ/detail/4353.html')
  assert.equal(row.简历投递链接, row.职位详情链接)
})

test('理想汽车校园岗位区分校招和实习', () => {
  const graduate = lixiangJobToRow({ id: 1, title: '算法工程师', job_mode: '201', hire_mode: 2, description: 'JD' }, { mode: 'graduate' })
  const intern = lixiangJobToRow({ id: 2, title: '算法实习生', job_mode: '202', hire_mode: 2, description: 'JD' }, { mode: 'intern' })
  assert.equal(graduate.批次, '秋招')
  assert.equal(graduate.工作类型, '应届生招聘')
  assert.equal(intern.批次, '实习')
  assert.equal(intern.工作类型, '实习生招聘')
})

test('理想汽车接口完整分页并补齐详情', async () => {
  const requests = []
  const fetchImpl = async input => {
    const url = new URL(input)
    requests.push(url)
    if (url.pathname.endsWith('/job/detail')) {
      const id = url.searchParams.get('job_id')
      return Response.json({ code: 0, data: { id: Number(id), title: `岗位${id}`, description: `完整 JD ${id}` } })
    }
    const page = Number(url.searchParams.get('page'))
    const ids = page === 1 ? [1, 2] : [3]
    return Response.json({ code: 0, data: { page, total_pages: 2, total_count: 3, items: ids.map(id => ({ id })) } })
  }
  const result = await fetchLixiangJobsSnapshot({ mode: 'intern', pageSize: 2, detailConcurrency: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  const listRequests = requests.filter(url => url.pathname.endsWith('/school/job-page'))
  assert.deepEqual(listRequests.map(url => url.searchParams.get('page')), ['1', '2'])
  assert.ok(listRequests.every(url => url.searchParams.get('job_mode') === '2'))
})

test('理想汽车详情失败时快照不完整', async () => {
  const fetchImpl = async input => {
    const url = new URL(input)
    if (url.pathname.endsWith('/job/detail')) return new Response('error', { status: 500 })
    return Response.json({ code: 0, data: { page: 1, total_pages: 1, total_count: 1, items: [{ id: 1 }] } })
  }
  const result = await fetchLixiangJobsSnapshot({ fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 0)
  assert.equal(result.diagnostics.failures.length, 1)
})
