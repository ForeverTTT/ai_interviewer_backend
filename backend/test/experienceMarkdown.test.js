import test from 'node:test'
import assert from 'node:assert/strict'

import { parseExperienceMarkdown } from '../src/lib/experienceMarkdown.js'
import { mapExperienceJson } from '../src/lib/feishuImport.js'

// 编的示例，格式照飞书「面经分享」文档导出的 Markdown（转义的 \+ \.、全角冒号、编号、小标题分轮）
const MD = `# 面经分享

## 面经分享 示例科技 产品运营一面

自我介绍

简历深挖。

太细了，每一处都会挖下去，我差点没圆过来。。。

产品经理和产品运营差别

反问（面试官很耐心）：

团队氛围如何

## 面经分享·字节广告策略产品二面

面试时长：45分钟

1\\.为什么做策略产品？

2\\.讲一个数据分析的例子

## 面经分享  样例网络 售前工程师岗

一、业务面试

你对网络安全的理解？

（效果如何衡量，是什么角色）

二、HR面

自我介绍\\+简历项目提问

## 面经分享·示例银行安徽分行群面

无领导:法律更有效还是教育更有效

半结构:为什么报考这里

## 面经分享·字节广告策略产品二面

面试时长：45分钟

1\\.为什么做策略产品？

2\\.讲一个数据分析的例子

## 面经分享·示例咨询暑期实习vi面

使用的是线上会议，5min 看题，1分钟自我介绍。
`

const parsed = parseExperienceMarkdown(MD, { month: '2026-10' })

test('splits titles into company, position and round', () => {
  assert.equal(parsed.length, 6)
  assert.deepEqual(parsed.map(e => [e.company, e.position, e.rounds.map(r => r.format).join('+')]), [
    ['示例科技', '产品运营', '一面'],
    ['字节跳动', '广告策略产品', '二面'], // 已知公司：和岗位连在一起也能拆开，简称统一成全称
    ['样例网络', '售前工程师岗', '业务面试+HR面'],
    // 列表里没有、又和岗位连写的公司拆不开，整段当公司名，岗位留空
    ['示例银行安徽分行', '未注明岗位', '群面'],
    ['字节跳动', '广告策略产品', '二面'],
    ['示例咨询暑期实习', '未注明岗位', 'VI面'],
  ])
  assert.equal(parsed[5].type, '实习')
  assert.equal(parsed[0].type, '校招')
})

test('keeps questions, moves the author\'s own commentary and reverse questions to the reflection', () => {
  const [meituan] = parsed
  assert.deepEqual(meituan.rounds[0].questions, ['自我介绍', '简历深挖。', '产品经理和产品运营差别'])
  assert.match(meituan.reflection, /我差点没圆过来/)
  assert.match(meituan.reflection, /反问.*：\n· 团队氛围如何/)
})

test('numbered questions, explicit duration and in-body round headers', () => {
  const [, bytedance, network, bank] = parsed
  assert.deepEqual(bytedance.rounds[0].questions, ['为什么做策略产品？', '讲一个数据分析的例子'])
  assert.equal(bytedance.rounds[0].duration_min, 45)
  assert.deepEqual(network.rounds.map(r => r.format), ['业务面试', 'HR面'])
  assert.deepEqual(network.rounds[1].questions, ['自我介绍+简历项目提问'])
  assert.deepEqual(bank.rounds[0].questions, ['无领导:法律更有效还是教育更有效', '半结构:为什么报考这里'])
})

test('short reading or intro times are not the interview length', () => {
  assert.equal(parsed[5].rounds.some(r => r.duration_min), false)
})

test('a post pasted twice imports once', () => {
  const rows = mapExperienceJson(parsed, { source: 'S' })
  assert.equal(new Set(rows.map(r => r.external_key)).size, 5)
})
