import test from 'node:test'
import assert from 'node:assert/strict'
import { baiduJobToRow, fetchBaiduJobsSnapshot } from '../src/lib/baiduJobImport.js'

test('百度岗位保留完整 JD、日期与官网详情页', () => {
  const row = baiduJobToRow({
    postId: 'post-1',
    name: '算法实习生（J100001）',
    workContent: '负责模型训练',
    serviceCondition: '熟悉 Python',
    workPlace: '北京市,上海市',
    publishDate: '2026-10-20',
    updateDate: '2026-10-23',
    bgShortName: 'MEG',
    orgName: '搜索研发部',
  }, 'INTERN')
  assert.equal(row.批次, '实习')
  assert.equal(row.工作地点, '北京市、上海市')
  assert.equal(row.发布时间, '2026-10-20')
  assert.match(row.职位描述, /工作职责\n负责模型训练/)
  assert.match(row.职位描述, /职位要求\n熟悉 Python/)
  assert.equal(row.简历投递链接, 'https://talent.baidu.com/jobs/detail/INTERN/post-1')
})

test('百度公开接口使用表单编码并完整分页', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    const body = Object.fromEntries(options.body)
    requests.push(body)
    return Response.json({
      status: 'ok',
      data: {
        total: '2',
        list: [{ postId: body.curPage, name: `岗位${body.curPage}`, workContent: '职责' }],
      },
    })
  }
  const result = await fetchBaiduJobsSnapshot({ recruitType: 'SOCIAL', pageSize: 1, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.equal(requests[0].recruitType, 'SOCIAL')
  assert.equal(requests[1].curPage, '2')
})

test('百度抽样限制返回不完整快照', async () => {
  const fetchImpl = async () => Response.json({
    status: 'ok',
    data: {
      total: '300',
      list: [
        { postId: '1', name: '岗位1', workContent: '职责' },
        { postId: '2', name: '岗位2', workContent: '职责' },
      ],
    },
  })
  const result = await fetchBaiduJobsSnapshot({ recruitType: 'GRADUATE', limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
