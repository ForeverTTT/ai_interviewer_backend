import test from 'node:test'
import assert from 'node:assert/strict'
import { tencentJobToRow } from '../src/lib/tencentJobImport.js'

test('腾讯岗位保留完整职责、要求和 HTTPS 官网投递页', () => {
  const row = tencentJobToRow({
    PostId: '123',
    RecruitPostName: '后端开发工程师',
    Responsibility: '负责服务端开发',
    Requirement: '熟悉 Node.js',
    LocationName: '深圳',
    BGName: 'CSIG',
    LastUpdateTime: '2026年10月23日',
  })
  assert.match(row.职位描述, /岗位职责\n负责服务端开发/)
  assert.match(row.职位描述, /任职要求\n熟悉 Node\.js/)
  assert.equal(row.简历投递链接, 'https://careers.tencent.com/jobdesc.html?postId=123')
})
