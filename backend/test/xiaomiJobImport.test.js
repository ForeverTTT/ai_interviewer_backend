import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchXiaomiJobsSnapshot, xiaomiJobToRow } from '../src/lib/xiaomiJobImport.js'

test('小米岗位保留完整 JD、发布时间与官方投递页', () => {
  const row = xiaomiJobToRow({
    jobPostId: 'post-1',
    title: '大模型算法实习生',
    description: '负责模型训练',
    requirement: '熟悉 Python',
    cityZhNames: ['北京', '上海', '北京'],
    levelOneDeptName: '集团技术委员会',
    publishTime: '2026-06-04',
    type: 3,
    url: 'https://xiaomi.jobs.f.mioffice.cn/topintern/position/post-1/detail',
  }, 3)
  assert.equal(row.批次, '实习')
  assert.equal(row.工作地点, '北京、上海')
  assert.equal(row.发布时间, '2026-06-04')
  assert.match(row.职位描述, /工作职责\n负责模型训练/)
  assert.match(row.职位描述, /职位要求\n熟悉 Python/)
  assert.equal(row.岗位身份标识, 'xiaomi:post-1')
  assert.equal(row.简历投递链接, 'https://xiaomi.jobs.f.mioffice.cn/topintern/position/post-1/detail')
})

test('小米公开接口完整分页并保留项目分类', async () => {
  const requests = []
  const fetchImpl = async url => {
    requests.push(new URL(url))
    const pageNum = requests.length
    return Response.json({ code: 0, data: {
      total: 2,
      list: [{
        jobPostId: String(pageNum),
        title: `岗位${pageNum}`,
        description: '职责',
        type: 2,
        url: `https://example.com/${pageNum}`,
      }],
    } })
  }
  const result = await fetchXiaomiJobsSnapshot({ projectType: 2, pageSize: 1, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.equal(requests[0].searchParams.get('type'), '2')
  assert.equal(requests[1].searchParams.get('pageNum'), '2')
})

test('小米抽样限制返回不完整快照', async () => {
  const fetchImpl = async () => Response.json({ code: 0, data: {
    total: 20,
    list: [
      { jobPostId: '1', title: '岗位1', description: '职责', url: 'https://example.com/1' },
      { jobPostId: '2', title: '岗位2', description: '职责', url: 'https://example.com/2' },
    ],
  } })
  const result = await fetchXiaomiJobsSnapshot({ projectType: 1, limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
