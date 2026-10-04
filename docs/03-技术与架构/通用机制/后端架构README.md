# 后端架构

> 状态：现行 · 最后核对：2026-10-03 · 对应总览：[系统总览](../系统总览.md)
> 代码：`backend/`（入口 `backend/src/index.js`）

本文记录后端**跨模块的通用机制**：技术栈、目录、运行与构建、请求处理链路、数据访问、AI 接入、实时通道、可观测性和测试。各业务模块（面试、报告、成长中心、简历……）的实现见[第 5 节](#5-路由与业务模块)的对照表；前端部分见[前端架构](前端架构README.md)。

## 目录

1. [技术栈总览](#1-技术栈总览)
2. [项目结构](#2-项目结构)
3. [运行与构建](#3-运行与构建)
4. [请求处理链路](#4-请求处理链路)
5. [路由与业务模块](#5-路由与业务模块)
6. [鉴权与能量值](#6-鉴权与能量值)
7. [数据访问](#7-数据访问)
8. [AI 接入](#8-ai-接入)
9. [实时语音通道](#9-实时语音通道)
10. [可观测性](#10-可观测性)
11. [配置与环境变量](#11-配置与环境变量)
12. [测试](#12-测试)
13. [部署](#13-部署)
14. [注意事项](#14-注意事项)

---

## 1. 技术栈总览

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **运行时** | Node.js | 22.x（`>=22.12 <23`） | 原生 ES Modules（`"type": "module"`） |
| **Web 框架** | Express | 4.22 | REST 接口、中间件链 |
| **实时通信** | ws | 8.22 | `/api/chat/live` WebSocket，挂在同一个 HTTP 服务上 |
| **数据库与认证** | Supabase JS | 2.117 | PostgreSQL 读写、RPC、校验用户 JWT |
| **实时语音** | @google/genai | 1.52 | Gemini Live 会话（语音输入、面试官语音输出） |
| **文本大模型** | LangChain（`@langchain/core`、`google-genai`、`google-vertexai`） | 1.2 / 2.3 / 2.3 | 报告、练习反馈、简历工具；AI Studio 与 Vertex AI 两种接入 |
| **面试编排** | LangGraph | 1.4 | 多智能体面试状态图（兼容通道，见[第 8 节](#8-ai-接入)） |
| **语音合成** | Google Cloud Text-to-Speech | 7.1 | 兼容通道的 TTS 接口 |
| **参数校验** | Zod | 4.6 | 请求体 schema 校验 |
| **安全** | Helmet / express-rate-limit / cors | 8.3 / 8.7 / 2.8 | 安全响应头、限流、跨域白名单 |
| **PDF 解析** | pdf-parse-fork | 1.2 | 简历 PDF 提取文本（按需动态导入） |
| **配置** | dotenv | 16.6 | 读取 `backend/.env` |
| **测试** | `node:test` | 内置 | 单元与行为测试，无第三方测试框架 |
| **开发工具** | nodemon / Supabase CLI | 3.1 / 2.118 | 热重载；本地数据库与 Migration |
| **容器与托管** | Docker（`node:22-slim`）/ Google Cloud Run | — | 生产部署，见[后端部署](../../05-运维/后端部署.md) |

### 依赖一览

```json
{
  "dependencies": {
    "@google-cloud/text-to-speech": "^7.1.1",
    "@google/genai": "^1.47.0",
    "@langchain/core": "^1.1.35",
    "@langchain/google-genai": "^2.1.26",
    "@langchain/google-vertexai": "^2.1.26",
    "@langchain/langgraph": "^1.2.5",
    "@supabase/supabase-js": "^2.45.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^8.3.1",
    "helmet": "^8.1.0",
    "pdf-parse-fork": "^1.2.0",
    "ws": "^8.20.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "nodemon": "^3.1.4",
    "supabase": "^2.115.0"
  }
}
```

表格中的版本是 `package-lock.json` 实际锁定的版本。

---

## 2. 项目结构

```text
backend/
├── src/
│   ├── index.js                  # 入口：中间件链、路由挂载、健康检查、启动 HTTP + WebSocket
│   ├── config/
│   │   ├── env.js                # 按源码位置定位并加载 backend/.env
│   │   ├── interviewerTypes.js   # HR / 技术 / 综合 三种面试官的提问边界
│   │   └── interviewerStyles.js  # 面试官性格的 Prompt 片段与 Live 音色
│   ├── middleware/
│   │   ├── auth.js               # requireAuth：校验 Supabase JWT
│   │   ├── tokens.js             # checkTokens：能量值余额检查
│   │   └── validate.js           # Zod 请求体校验
│   ├── routes/                   # 每个业务领域一个 Router（见第 5 节）
│   ├── live/
│   │   └── interviewLiveSocket.js  # Gemini Live 实时面试 WebSocket
│   ├── agents/
│   │   ├── interviewGraph.js     # LangGraph 多智能体面试图
│   │   └── utils.js              # 面试计划、题量、Prompt / 知识库加载
│   └── lib/
│       ├── supabase.js           # Service Role 客户端 + 按用户会话的客户端
│       ├── interviewSessionStore.js  # 面试会话读写、乐观锁、请求幂等
│       ├── interviewLearning.js  # 练习 / 正式模式的状态推进、难度、计时
│       ├── interviewFinalize.js  # 面试结束与报告生成
│       ├── interviewEvents.js    # 面试事件记录（interview_events 表）
│       ├── growthCenter.js / offerSprint.js  # 成长中心与 Offer 冲刺计划
│       ├── geminiText.js / geminiFallback.js / geminiLive.js  # 大模型调用与降级
│       ├── ttsVertex.js          # Cloud TTS
│       ├── liveTurnTiming.js     # Live 每轮延迟统计
│       ├── analytics.js          # 产品埋点：事件白名单、analytics.* 日志
│       └── observability.js      # Request ID、结构化日志、脱敏
├── data/
│   ├── prompts/*.md              # 运行时 Prompt 模板（按固定文件名读取，不是说明文档）
│   └── knowledge_base/*.json     # 技术领域、行为能力、面经知识库
├── supabase/
│   ├── config.toml               # 本地 Supabase 配置
│   ├── migrations/               # 数据库 Migration（13 个）
│   └── seed.sql                  # 本地种子数据
├── scripts/                      # 诊断与运维脚本（Live 连通性、编排基准、优势测试题库导入）
├── test/                         # node:test 测试 + test/sql 数据库事务化验收
├── Dockerfile                    # Cloud Run 镜像
└── package.json
```

`src/` 下约 7,600 行代码，最大的几个文件是 `routes/interviews.js`（面试创建、结束、报告、翻译）、`routes/chat.js`、`routes/profile.js` 和 `routes/growthCenter.js`。

---

## 3. 运行与构建

| 命令 | 作用 |
|---|---|
| `npm run dev` | `nodemon src/index.js`，改动后自动重启，默认监听 `http://localhost:5000` |
| `npm start` | `node src/index.js`，生产启动方式 |
| `npm test` | `node --test`，运行 `test/` 下全部测试 |

- **没有构建步骤**：源码直接以 ES Modules 运行，不经过打包或转译。
- **环境变量加载**：`config/env.js` 按源码文件位置定位 `backend/.env`，而不是依赖当前工作目录，所以从仓库根目录或 IDE 启动都能读到配置。已经存在的进程环境变量优先，不会被 `.env` 覆盖。
- **容器镜像**：`node:22-slim`，只安装生产依赖（`npm ci --omit=dev`），以非 root 的 `node` 用户运行，监听 `PORT=8080`（Cloud Run 注入）。

本地完整启动（含本地 Supabase）见[本地开发](../../02-开发指南/本地开发.md)。

---

## 4. 请求处理链路

`src/index.js` 中中间件的执行顺序：

```text
请求
 │
 ├─ trust proxy = 1            # Cloud Run / 负载均衡后取真实客户端 IP（限流依赖它）
 ├─ helmet                     # CSP、HSTS、X-Frame-Options 等安全响应头
 ├─ cors                       # 白名单：FRONTEND_URL + 本地 3000 / 3001 / 5173；暴露 X-Request-Id
 ├─ requestIdMiddleware        # 为每个请求分配或沿用 Request ID
 ├─ express.json               # 默认 10 MB；/api/profile/resume/parse-pdf 放宽到 17 MB
 ├─ /api/ux-events            # 前端埋点，挂在全局限流之前，单独限流每 IP 每分钟 120 次
 ├─ 限流
 │    ├─ /api/*                # 每 IP 每 15 分钟 1000 次
 │    └─ /api/chat、/api/ai-assistant   # 额外：每小时 500 次
 ├─ 路由（见第 5 节）
 │    └─ 路由内部按需：requireAuth → validate(schema) → checkTokens → 业务处理
 ├─ 404 处理                   # 未匹配的路由返回 JSON 错误
 └─ 统一错误处理               # 记录结构化日志；请求体过大返回 413 REQUEST_TOO_LARGE，其他返回 500 + requestId
```

`GET /api/health` 不需要鉴权，返回服务名（`InterviewDE API`）、当前提交 `commit`、Cloud Run 修订版本 `revision` 和部署时间，用于发布后验证。

---

## 5. 路由与业务模块

| 挂载路径 | 文件 | 接口数 | 职责 | 技术文档 |
|---|---|---:|---|---|
| `/api/interviews` | `routes/interviews.js` | 9 | 创建面试（原子扣费）、列表、详情、结束与报告生成、报告翻译 | [面试配置](../面试配置.md)、[面试报告](../面试报告.md) |
| `/api/interview-sessions` | `routes/interviewSessions.js` | 14 | 练习模式：出题、作答、提示、重答、掌握、跳过、暂停 / 恢复 | [面试流程](../模拟面试/面试流程.md) |
| `/api/chat` | `routes/chat.js` | 5 | 兼容通道：SSE 文本面试、TTS、会话重置 | [agent与Prompt](../模拟面试/agent与Prompt.md)、[实时语音与TTS](../模拟面试/实时语音与TTS.md) |
| `/api/chat/live`（WebSocket） | `live/interviewLiveSocket.js` | — | **当前所有面试**使用的 Gemini Live 实时语音通道 | 见[第 9 节](#9-实时语音通道) |
| `/api/growth-center` | `routes/growthCenter.js` | 11 | 准备度汇总、题目收藏、针对练习、Offer 冲刺计划与任务 | [成长中心](../成长中心.md)、[题目收藏](../题目收藏.md) |
| `/api/profile` | `routes/profile.js` | 9 | 个人资料、简历 PDF 解析、结构化提取、简历诊断、能量值 | [个人资料与简历](../个人资料与简历.md) |
| `/api/ai-assistant` | `routes/aiAssistant.js` | 3 | 按 JD 改写简历、生成求职信 | [简历优化](../简历优化.md) |
| `/api/gallup` | `routes/gallup.js` | 4 | 优势测试题库、进度、结果与解读 | [优势测试](../优势测试.md) |
| `/api/experiences` | `routes/experiences.js` | 4 | 面经列表（公开）、发布、删除 | [面经库](../面经库.md) |
| `/api/ux-events` | `routes/uxEvents.js` | 1 | 接收前端埋点（可选鉴权） | [埋点与数据分析](埋点与数据分析.md) |
| `/api/feedback` | `routes/feedback.js` | 1 | AI 结果的 👍/👎 反馈 | [埋点与数据分析](埋点与数据分析.md#6-用户反馈) |

每个接口的方法、参数、鉴权、限流和扣费见 [API 参考](../../04-参考/API.md)。

---

## 6. 鉴权与能量值

- **`requireAuth`**：读取 `Authorization: Bearer <access_token>`，调用 Supabase `auth.getUser(token)` 验证，成功后挂到 `req.user`、`req.accessToken`；失败返回 401（`AUTH_TOKEN_INVALID`）。
- **`checkTokens`**：按 `req.tokenCost` 检查 `profiles.tokens` 余额，不足时返回 403（`INSUFFICIENT_TOKENS`）。真正的扣费在业务成功之后进行；创建面试由数据库 RPC 在同一事务里完成创建和扣费。
- **只有后端能改余额**：浏览器只能读取自己的余额，不能直接写 `profiles.tokens`（2026-10-01 的 Migration `billing_authorization_hardening` 收紧了这一点）。

完整规则（各操作的消耗、扣费时机、退款与幂等）见[账户与计费](账户与计费.md)。

---

## 7. 数据访问

后端只通过 Supabase JS 访问 PostgreSQL，没有 ORM。

| 客户端 | 位置 | 用途 |
|---|---|---|
| `supabase` | `lib/supabase.js` | 用 **Service Role Key** 创建的全局客户端，绕过 RLS，用于需要服务端权限的读写（扣费、跨用户统计、写事件等） |
| `supabaseForUser(accessToken)` | `lib/supabase.js` | 携带用户 JWT 的客户端，查询受 RLS 约束（`auth.uid() = id`），用于"只应读写自己数据"的场景 |

几条贯穿所有模块的约定（详见[系统总览 · 核心原则](../系统总览.md#核心原则)）：

- **PostgreSQL 是唯一事实来源**：Cloud Run 实例随时可能扩缩容，进程内存只放临时连接状态；面试会话、计时、报告都落库。
- **`interviewId` 是隔离边界**：读取、写入、断线恢复和实时连接都以它为准，同时也是 LangGraph 的 `thread_id`。
- **幂等 + 乐观锁**：有副作用的操作带幂等键；会话写入通过 `state_version` 做乐观锁，冲突时抛出 `InterviewSessionConflictError`（409）。
- **复杂操作放进 RPC**：例如 `create_interview_session` 在一个事务里完成"创建面试 + 扣费"。

表、RLS、RPC、触发器和全部 Migration 见[数据库参考](../../04-参考/数据库.md)；Migration 的审核与执行流程见[数据库迁移发布](../../05-运维/数据库迁移发布.md)。

---

## 8. AI 接入

后端有三条调用大模型的路径：

| 路径 | 代码 | 模型（默认） | 用在哪里 |
|---|---|---|---|
| **Gemini Live** | `live/interviewLiveSocket.js`、`lib/geminiLive.js` | `gemini-3.1-flash-live-preview` | 正式与练习面试的实时语音对话，面试官声音由 Live 直接生成 |
| **文本生成** | `lib/geminiText.js`（`invokeGemini`） | `gemini-3.7-flash`；练习模式 `gemini-3.5-flash-lite` | 面试报告、练习出题与反馈、简历结构化提取与诊断、按 JD 改写简历、求职信、报告翻译 |
| **LangGraph 面试图** | `agents/interviewGraph.js` | 同文本主模型 | 兼容通道的 SSE 文本面试，当前前端未启用 |

### 8.1 接入方式与降级

- **AI Studio 还是 Vertex AI**：设置了 `GEMINI_API_KEY` 时走 Google AI Studio（`ChatGoogleGenerativeAI`）；没有设置时走 Vertex AI（`ChatVertexAI`），使用 Cloud Run 的服务账号凭据，项目和区域取自 `GCP_PROJECT_ID` / `GCP_LOCATION`。
- **配额降级**：`lib/geminiFallback.js` 识别 429、`RESOURCE_EXHAUSTED`、quota / rate limit 等各种形式的配额错误，遇到时用 `GEMINI_FALLBACK_MODEL`（默认 `gemini-3.5-flash-lite`）重试一次。
- **温度**：只对支持采样温度的模型设置 `temperature`（默认 0.35），其余模型不传，避免请求被拒。

### 8.2 Prompt 与知识库

- **Prompt 模板**：`data/prompts/*.md`（开场、追问、技术、行为、分析、反馈、求职信等），由 `agents/utils.js` 的 `loadPrompt(name)` 按固定文件名读取。这些文件是程序的一部分，改名或移动会导致运行时出错。
- **知识库**：`data/knowledge_base/*.json`（技术领域、行为能力、面经），由 LangGraph 面试图在出题时作为上下文注入，因此目前只在兼容通道中生效。
- **优势测试不调用大模型**：解读文案来自数据库表 `gallup_analysis_content`，按分档读取对应界面语言的预置文案。
- **面试官设定**：`config/interviewerTypes.js` 约束 HR / 技术 / 综合三种面试官的提问边界；`config/interviewerStyles.js` 提供四种性格的 Prompt 片段和对应的 Live 音色。

Prompt 的完整对照、LangGraph 节点和路由见[agent与Prompt](../模拟面试/agent与Prompt.md)。

---

## 9. 实时语音通道

`attachInterviewLiveSocket(server)` 把 WebSocket 服务挂在 Express 的同一个 HTTP 服务器上，路径 `/api/chat/live`：

```text
浏览器 ──WebSocket──► interviewLiveSocket ──Gemini Live 会话──► Google AI
   ▲  麦克风 PCM 上行                │   面试官语音 + 文本下行
   └──────────── 音频 / 字幕 / 状态事件 ◄┘
                                     │
                                     └─► Supabase：按轮提交对话、推进计时、记录事件
```

- **鉴权**：连接建立后，客户端在 `start` 消息里携带 access token，10 秒内未通过验证就断开；Origin 只允许 `FRONTEND_URL` 和本地 3000 端口。
- **状态**：每一轮对话通过 `interviewSessionStore` 提交（带请求幂等），正式模式的截止时间与宽限期由服务端决定。
- **音色**：按面试语言和面试官性格选择，可用 `GEMINI_LIVE_VOICE_EN` / `_DE` / `_ZH` 覆盖。
- **延迟统计**：`liveTurnTiming.js` 记录正式面试每一轮的延迟，用于排查"面试官反应慢"。

协议细节、断线重连和计时规则见[实时语音与TTS](../模拟面试/实时语音与TTS.md)和[面试流程](../模拟面试/面试流程.md)。

---

## 10. 可观测性

| 机制 | 位置 | 说明 |
|---|---|---|
| Request ID | `requestIdMiddleware` | 沿用客户端传入的 `X-Request-Id`（格式合法时），否则生成 UUID；写回响应头，前端报错时可以据此查日志 |
| 结构化日志 | `logStructured` | JSON 格式输出到 stdout，由 Cloud Logging 收集；带 requestId、方法、路径、用户 ID |
| 敏感信息脱敏 | `observability.js` | 自动替换日志中的 Bearer token、`key` / `access_token` 查询参数、Google API Key、JWT |
| 面试事件 | `lib/interviewEvents.js` | 面试关键节点写入 `interview_events` 表，便于还原单场面试的完整过程 |
| 产品埋点 | `lib/analytics.js` | 业务结果和前端行为写成 `analytics.*` 日志，经 Log Sink 导出到 BigQuery，见[埋点与数据分析](埋点与数据分析.md) |
| 健康检查 | `GET /api/health` | 返回提交、修订版本和部署时间，用来确认线上跑的是哪个版本 |

线上问题的排查步骤见[故障排查](../../05-运维/故障排查.md)。

---

## 11. 配置与环境变量

最少需要 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `GEMINI_API_KEY`（或改用 Vertex AI 凭据）。全部变量的含义、默认值和是否敏感见[环境变量 · 后端](../../02-开发指南/环境变量.md#后端backendenv)；生产环境的配置位置见同文"生产环境在哪里配置"。

> **安全底线**：Service Role Key 和 Gemini Key 只能存在于后端，绝不能写进任何 `VITE_*` 变量，也不要提交真实的 `.env`。

---

## 12. 测试

| 类型 | 位置 | 运行方式 |
|---|---|---|
| 单元与行为测试 | `test/*.test.js` | `npm test`（`node --test`），覆盖会话存储、练习状态推进、成长中心、Offer 冲刺、面试官性格、Live 延迟统计、可观测性、产品埋点与反馈、运行时数据路径 |
| 数据库事务化验收 | `test/sql/*.sql` | 在本地 Supabase 上执行，覆盖面试会话状态机和计费授权 |

具体步骤与人工回归清单见[测试](../../02-开发指南/测试.md)。

---

## 13. 部署

推送到 `main` 时，GitHub Actions（`.github/workflows/deploy-cloud-run.yml`）先运行测试，再构建镜像并发布到 Cloud Run 服务 `interview-backend`（`europe-west1`），通过 Workload Identity Federation 无密钥认证。只改动 `docs/`、`frontend/`、`README.md` 或前端发布工作流时不会触发；也可以在 Actions 页面手动运行。数据库 Migration 不随代码自动发布，需要单独审核执行。

详见[部署总览](../../05-运维/部署总览.md)、[后端部署](../../05-运维/后端部署.md)。

---

## 14. 注意事项

- **限流阈值偏宽**：`index.js` 的注释说明当前阈值是为开发和测试临时调高的（每 15 分钟 1000 次、AI 接口每小时 500 次），正式运营前需要重新评估。
- **WebSocket 与 REST 的跨域白名单不同**：REST 允许本地 3000 / 3001 / 5173 端口，WebSocket 只允许 `FRONTEND_URL` 和本地 3000。在其他端口本地预览时，实时面试会被拒绝连接。
- **内部名称**：后端服务名、`package.json` 和健康检查里的 `service` 字段仍叫 InterviewDE，这是代码内部名称，不面向用户（见[产品概览 · 名称约定](../../01-产品/产品概览.md#名称约定)）。
- **兼容通道**：`/api/chat` 的 SSE 文本面试和 TTS 接口仍然保留，但当前前端没有使用，修改时要确认是否还有调用方。
