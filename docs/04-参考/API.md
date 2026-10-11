# API 参考

> 状态：现行 · 最后核对：2026-10-01 · 依据：`backend/src/index.js` 和 `backend/src/routes/*.js`

本文是后端接口的**唯一完整清单**。各领域文档只解释行为，接口列表统一维护在这里；新增或修改路由时同步更新本文。

## 通用约定

| 项目 | 约定 |
|---|---|
| 基地址 | 生产：`https://interview-backend-557559701677.europe-west1.run.app`；本地：`http://localhost:5000` |
| 鉴权 | `Authorization: Bearer <Supabase access_token>`。下表"鉴权"列为 ✅ 的接口，缺少 token 或 token 无效时返回 401 |
| 内容类型 | `application/json`，请求体默认最大 10 MB（PDF 解析接口为 17 MB），超出时返回 413 `REQUEST_TOO_LARGE` |
| 幂等 | 有副作用的面试类接口接受请求体中的 `idempotencyKey` 或 `Idempotency-Key` 请求头；重试时返回第一次的结果 |
| 乐观锁 | 面试状态写入时校验 `state_version`；冲突时返回 409 和 `currentVersion` |
| 限流 | 所有 `/api/*`（`/api/ux-events` 除外）：每 IP 每 15 分钟 1000 次；`/api/chat/*` 和 `/api/ai-assistant/*` 另外限制为每 IP 每小时 500 次；`/api/ux-events` 单独限制为每 IP 每分钟 120 次 |
| Request ID | 每个响应都带 `X-Request-Id` 头，500 错误的响应体里也有 `requestId` |
| 错误格式 | `{ "error": "...", "code"?: "...", "details"?: ..., "requestId"?: "..." }` |
| 未知路由 | 404 `{ "error": "Route <METHOD> <path> not found" }` |

**扣费**列是能量值的消耗，规则见[账户与计费](../03-技术与架构/通用机制/账户与计费.md#2-能量值tokens)。余额不足时返回 403 `INSUFFICIENT_TOKENS`。

## 健康检查

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|:---:|---|
| GET | `/api/health` | | 返回 `status`、`timestamp`、`service`、`commit`、`revision`、`deployedAt` |

## 产品埋点 `/api/ux-events`

设计见[数据埋点与分析方案](../06-决策与方案/进行中/数据埋点与分析方案.md)。前端只在用户同意 Cookie 后调用。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|:---:|---|
| POST | `/api/ux-events` | 可选 | 批量上报浏览器事件，请求体 `{ events: [...] }`，每批 1–20 条。带有效 token 时事件归属到该用户，否则按匿名处理；不接受请求体里的用户 ID。事件名和字段按 `backend/src/lib/analytics.js` 的白名单校验，不合格的单条事件被丢弃。批次格式错误返回 400，其余一律返回 204 |
| POST | `/api/feedback` | ✅ | 对 AI 结果的 👍/👎 反馈。请求体 `feedbackId`、`feature`（`interview_report` / `resume_tailor` / `cover_letter` / `resume_diagnose` / `gallup`）、`rating`（`up` / `down`），可选 `reasons`（预设原因代码数组，最多 5 个，必须与 rating 对应）和 `interviewId`。不接受自由文本。成功返回 204，格式错误返回 400 |
| POST | `/api/feedback/messages` | ✅ | 直接提交反馈。请求体 `feedbackId`（8–64 位字母、数字、连字符，用于重试去重）、`source`（`help` / `interview`），可选 `message`（最多 2000 字符）、`rating`（`up` / `down`）、`interviewId`、`pagePath`（仅路径，不带 query/hash）。帮助反馈必须有文字；面试反馈必须提供本人面试 ID，文字和评价至少填一个。写入 `public.user_feedback`，成功及重复重试返回 204；校验错误 400、无权访问面试 404、每用户 10 分钟最多 10 次（超限 429）、存储失败 503。正文不进埋点或日志 |

## 面试 `/api/interviews`

行为说明：[面试流程](../03-技术与架构/模拟面试/面试流程.md)

| 方法 | 路径 | 鉴权 | 扣费 | 说明 |
|---|---|:---:|---:|---|
| GET | `/api/interviews` | ✅ | | 当前用户最近 50 场面试 |
| POST | `/api/interviews` | ✅ | 300 | 原子、幂等地创建面试。必填 `position`、`language`、`duration`（5–60 的整数）；可选 `job_description`、`resume_snapshot`、`interviewerType`（`hr` / `technical` / `mixed`）、`interviewer_style`、`mode`（`practice` / `formal`）、`difficulty`（`easy` / `medium` / `hard` / `adaptive`）、`role_track`（`school` / `work`）、`idempotencyKey` |
| GET | `/api/interviews/:id` | ✅ | | 面试详情、状态和报告 |
| DELETE | `/api/interviews/:id` | ✅ | | 删除面试（不可恢复） |
| POST | `/api/interviews/:id/transcript` | ✅ | | 幂等提交兼容格式的 transcript |
| POST | `/api/interviews/:id/finalize` | ✅ | | 抢占锁后生成或复用报告；其他并发请求返回 202 |
| POST | `/api/interviews/:id/report/translate` | ✅ | | 把报告翻译成界面语言并缓存 |
| POST | `/api/interviews/:id/events` | ✅ | | 写入允许的客户端生命周期事件 |
| GET | `/api/interviews/:id/events` | ✅ | | 读取事件；正式面试完成前隐藏评分信息 |

## 练习与面试状态 `/api/interview-sessions`

行为说明：[面试流程 · 练习模式流程](../03-技术与架构/模拟面试/面试流程.md#9-练习模式流程)

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|:---:|---|
| GET | `/api/interview-sessions/progress/practice` | ✅ | 多场练习的首次与最新得分对比、进步项和待加强项 |
| GET | `/api/interview-sessions/:id` | ✅ | 恢复 workspace：checkpoint、当前题、全部作答、提示、笔记和练习限制 |
| GET | `/api/interview-sessions/:id/competencies` | ✅ | 岗位能力矩阵，以及每次作答的评分、原文证据和 rubric |
| POST | `/api/interview-sessions/:id/questions/next` | ✅ | 按难度策略生成下一题（会检索面经作为参考） |
| POST | `/api/interview-sessions/:id/questions/:questionId/answer` | ✅ | 保存回答。练习模式立即返回反馈；正式模式不返回反馈，也不能重答 |
| POST | `/api/interview-sessions/:id/questions/:questionId/hint` | ✅ | 依次开放 `nudge` → `structure` → `key_points` → `example`，只限练习模式 |
| POST | `/api/interview-sessions/:id/pause` | ✅ | 暂停，只限练习模式 |
| POST | `/api/interview-sessions/:id/resume` | ✅ | 恢复，只限练习模式 |
| POST | `/api/interview-sessions/:id/reconnect` | ✅ | 记录一次重连 |
| GET | `/api/interview-sessions/:id/reconnect-context` | ✅ | 只返回当前题和有限条最近消息 |
| POST | `/api/interview-sessions/:id/questions/:questionId/retry` | ✅ | 开启一次新的作答机会 |
| POST | `/api/interview-sessions/:id/questions/:questionId/master` | ✅ | 标记已掌握（必须先作答过） |
| POST | `/api/interview-sessions/:id/questions/:questionId/skip` | ✅ | 跳过，可以附带原因 |
| PUT | `/api/interview-sessions/:id/questions/:questionId/note` | ✅ | 保存私人笔记 |

以上接口都接受 `idempotencyKey`，并在事务中校验 `state_version`。

## 文本面试、TTS 与实时语音 `/api/chat`

行为说明：[agent与Prompt](../03-技术与架构/模拟面试/agent与Prompt.md#11-sse-流式通信)、[实时语音与 TTS](../03-技术与架构/模拟面试/实时语音与TTS.md)

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|:---:|---|
| POST | `/api/chat/message` | ✅ | **兼容通道，当前前端未调用。** LangGraph 文本回合，以 SSE 返回。必填 `interviewId` 和 `idempotencyKey`。事件类型：`agent`、`text`、`done`、`error` |
| GET | `/api/chat/session?interviewId=` | ✅ | 读取指定面试的流程状态 |
| POST | `/api/chat/reset` | ✅ | 兼容旧客户端的初始化检查；必须传 `interviewId`，**不会清空**已保存的状态 |
| POST | `/api/chat/tts` | ✅ | **兼容通道，当前前端未调用。** 完整 TTS，请求体 `{ text, language, interviewerStyle }`，返回完整音频 |
| POST | `/api/chat/tts-stream` | ✅ | **兼容通道，当前前端未调用。** 流式 TTS，参数同上，返回 PCM 音频流 |
| WS | `/api/chat/live` | ✅* | Gemini Live 实时语音。*token 放在 `start` 消息中，必须在 10 秒内完成鉴权；`config.interviewId` 必填 |

## 成长中心 `/api/growth-center`

行为说明：[成长中心](../03-技术与架构/成长中心.md)

| 方法 | 路径 | 鉴权 | 扣费 | 说明 |
|---|---|:---:|---:|---|
| GET | `/api/growth-center/overview` | ✅ | | 五维准备度、最近 3 条待复习收藏、有效训练节奏、冲刺计划 |
| PUT | `/api/growth-center/offer-plan` | ✅ | | 保存 Offer 冲刺目标 |
| DELETE | `/api/growth-center/offer-plan` | ✅ | | 删除冲刺目标 |
| PATCH | `/api/growth-center/offer-plan/tasks/:taskId` | ✅ | | 完成或跳过周任务，并幂等记录有效训练 |
| PATCH | `/api/growth-center/offer-plan/reminders/:reminderId` | ✅ | | 把提醒标记为已读或已关闭 |
| GET | `/api/growth-center/collections` | ✅ | | 搜索和筛选收藏的题目 |
| POST | `/api/growth-center/collections` | ✅ | | 从练习题或报告中收藏题目 |
| PATCH | `/api/growth-center/collections/:id` | ✅ | | 更新笔记、标签、置顶、复习状态 |
| DELETE | `/api/growth-center/collections/:id` | ✅ | | 取消收藏 |
| POST | `/api/growth-center/collections/:id/practice` | ✅ | 300 | 用收藏的题目创建一场针对性练习（10 分钟，Medium） |
| POST | `/api/growth-center/tasks/:taskId/complete` | ✅ | | 幂等记录系统任务完成 |

## 个人资料与简历 `/api/profile`

行为说明：[个人资料与简历](../03-技术与架构/个人资料与简历.md)、[账户与计费](../03-技术与架构/通用机制/账户与计费.md)

| 方法 | 路径 | 鉴权 | 扣费 | 说明 |
|---|---|:---:|---:|---|
| GET | `/api/profile` | ✅ | | 简历、结构化简历、诊断结果、头像和能量值余额；没有资料行时自动创建 |
| GET | `/api/profile/resume` | ✅ | | 只返回 `resumeText` |
| PUT | `/api/profile` | ✅ | | 更新 `resumeText`、`resumeNotes`、`profileJson`（与原值浅合并）、`jobSearchStatus`、`avatarId` |
| POST | `/api/profile/resume/parse-pdf` | ✅ | | 请求体 `{ pdfBase64 }`，PDF 最大 12 MB；返回提取的文本 |
| POST | `/api/profile/extract-cv` | ✅ | 50 | 从简历文本提取结构化字段（不保存） |
| POST | `/api/profile/resume-coach` | ✅ | 200 | 生成简历诊断并保存 |
| POST | `/api/profile/resume-coach/translate` | ✅ | | 把诊断结果翻译成界面语言（带缓存） |
| GET | `/api/profile/game-stats` | ✅ | | 等级、四维雷达、连续打卡（当前前端没有调用） |
| POST | `/api/profile/check-in` | ✅ | | 每日打卡，奖励 200（当前前端没有调用） |

## 求职工具 `/api/ai-assistant`

行为说明：[简历优化](../03-技术与架构/简历优化.md)、[面试配置 · JD 解析](../03-技术与架构/面试配置.md#2-jd-解析)

| 方法 | 路径 | 鉴权 | 扣费 | 说明 |
|---|---|:---:|---:|---|
| POST | `/api/ai-assistant/analyze-job-description` | ✅ | | 用规则识别岗位名称、类别和雇佣类型；JD 至少 50 字符（当前前端没有调用，前端在本地解析） |
| POST | `/api/ai-assistant/tailor-resume` | ✅ | 100 | 按 JD 改写简历，返回匹配和缺失的关键词 |
| POST | `/api/ai-assistant/generate-motivation-letter` | ✅ | 100 | 生成动机信 |

## 盖洛普 `/api/gallup`

行为说明：[优势测试](../03-技术与架构/优势测试.md)

| 方法 | 路径 | 鉴权 | 扣费 | 说明 |
|---|---|:---:|---:|---|
| GET | `/api/gallup/questions` | | | 20 道题（三语），公开 |
| GET | `/api/gallup/results` | ✅ | | 当前用户的作答和结果；没有记录时返回 `status: 'not_started'` |
| POST | `/api/gallup/save` | ✅ | | 保存进度 |
| POST | `/api/gallup/analyze` | ✅ | 100 | 按分档查询解读并保存 |

## 面经 `/api/experiences`

行为说明：[面经库](../03-技术与架构/面经库.md)。这组接口不使用 `requireAuth`，而是自行验证 token。

| 方法 | 路径 | 鉴权 | 能量值 | 说明 |
|---|---|:---:|---:|---|
| GET | `/api/experiences` | | | 全部面经，没有分页 |
| GET | `/api/experiences/mine` | ✅ | | 我发布的面经 |
| POST | `/api/experiences` | ✅ | +200 | 发布面经，每个 UTC 自然日最多 1 篇（超出返回 429 `DAILY_LIMIT`） |
| DELETE | `/api/experiences/:id` | ✅ | −200 | 删除自己发布的面经 |

## 前端调用了但后端不存在的接口

| 路径 | 调用方 | 说明 |
|---|---|---|
| `GET /api/interviewers`、`GET /api/interviewers/:id` | `frontend/src/avatar/interviewerRegistry.js` | 数字人脚手架，尚未接入，见[数字人](../03-技术与架构/模拟面试/数字人.md) |
