import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchNeteaseCampusSnapshot, neteaseCampusJobToRow } from '../src/lib/neteaseJobImport.js'

test('网易校园岗位保留完整 JD、项目和官网入口', () => {
  const row = neteaseCampusJobToRow({
    id: 4839,
    projectId: 103,
    positionName: '产品策划',
    positionTypeName: '产品',
    workPlaceName: '杭州',
    interviewCityName: '远程面试',
    positionDescription: '<p>负责产品规划</p>',
    positionRequirement: '<p>具备数据分析能力</p>',
    updateTime: Date.UTC(2026, 8, 18, 16, 30),
  }, { projectId: 103, projectName: '网易互联网2027届校园招聘' })

  assert.equal(row.公司, '网易')
  assert.equal(row.工作类型, '应届生招聘')
  assert.equal(row.发布时间, '2026-09-19')
  assert.match(row.职位描述, /岗位职责\n负责产品规划/)
  assert.match(row.职位描述, /任职要求\n具备数据分析能力/)
  assert.equal(row.岗位身份标识, 'netease:campus:103:4839')
  assert.equal(row.职位详情链接, 'https://campus.163.com/app/job/position?id=103')
  assert.match(row.备注, /网易互联网2027届校园招聘/)
})

test('网易校园招聘接口遍历全部分页并去重', async () => {
  const pages = []
  const fetchImpl = async input => {
    const url = new URL(input)
    const page = Number(url.searchParams.get('currentPage'))
    pages.push(page)
    const ids = page === 1 ? [1, 2] : [2, 3]
    return Response.json({
      code: 200,
      data: {
        total: 3,
        pages: 2,
        lastPage: page === 2,
        list: ids.map(id => ({ id, positionName: `岗位${id}`, positionDescription: `职责${id}` })),
      },
    })
  }
  const result = await fetchNeteaseCampusSnapshot({ projectId: 103, pageSize: 2, fetchImpl })
  assert.deepEqual(pages, [1, 2])
  assert.equal(result.rows.length, 3)
  assert.equal(result.complete, true)
})

test('网易校园招聘抽样结果不会被标记为完整快照', async () => {
  const fetchImpl = async () => Response.json({
    code: 200,
    data: {
      total: 3,
      pages: 2,
      lastPage: false,
      list: [1, 2].map(id => ({ id, positionName: `岗位${id}`, positionDescription: `职责${id}` })),
    },
  })
  const result = await fetchNeteaseCampusSnapshot({ projectId: 103, limit: 1, fetchImpl })
  assert.equal(result.rows.length, 1)
  assert.equal(result.complete, false)
})
