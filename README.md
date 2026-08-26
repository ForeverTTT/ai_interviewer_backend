# InterviewDE — 后端服务 (Backend)

> **基于 Node.js + Express + Supabase + Gemini 的智能面试中枢**

后端服务负责处理核心业务逻辑，包括面试会话流管理、多模态报告生成、简历解析诊断（Gemini API）以及基于授权用户的数据库操作。应用采用 **Node.js ES 模块** (`"type": "module"`) 开发。

## 🌐 线上环境

- Cloud Run API：由 GitHub Production Variables 中的 `GCP_PROJECT_ID`、`GCP_REGION` 和
  `CLOUD_RUN_SERVICE` 决定；当前生产前端默认调用
  <https://interview-backend-530979174916.us-central1.run.app>
- 健康检查：<https://interview-backend-530979174916.us-central1.run.app/api/health>，响应包含当前
  `commit`、Cloud Run `revision` 和 `deployedAt`，用于确认代码与部署是否同步
- 生产前端：<https://aiinterviewer-491711-7b1cf.web.app>
- Google Cloud 项目、区域和服务名不再硬编码在仓库中，以 GitHub Production Environment 配置为准
- 数据库与认证：Supabase Cloud；用户通过 Supabase Google OAuth 登录

当前 Cloud Run 配置为 1 vCPU、512 MiB、最少 0 / 最多 2 个实例、每实例并发 20。
生产密钥只能配置在 Cloud Run 环境变量或 Secret Manager 中，不能提交到仓库。

---

## 🛠️ 技术栈

| 模块 | 技术 | 说明 |
| :--- | :--- | :--- |
| **运行时** | Node.js 22+ | 本地建议使用当前 LTS；Cloud Run 使用 Google Buildpacks 构建 |
| **HTTP 框架**| Express 4 | 业务接口转发与中间件支持 |
| **数据库/认证** | Supabase SDK | 使用 **Service Role**（管理权限）与 **Auth API**（用户校验） |
| **Agent 编排** | LangGraph | 根据面试状态选择提问、追问、流程节点和反馈生成 |
| **AI 模型** | Google Gemini | 文本流程默认 `gemini-3.7-flash`，配额耗尽时重试 `gemini-3.5-flash-lite`；实时语音默认 `gemini-3.1-flash-live-preview` |
| **其他组件** | pdf-parse, cors, dotenv | 提供 PDF 提取、跨域支持及配置管理 |

---

## 📂 核心目录结构

```text
backend/
├── src/
│   ├── index.js              # 应用入口：CORS 配置、路由挂载、错误捕获
│   ├── routes/
│   │   ├── interviews.js     # /api/interviews — 幂等创建、记录 CRUD 与报告定稿
│   │   ├── interviewSessions.js # /api/interview-sessions — 练习/正式状态机与学习进度
│   │   ├── profile.js        # /api/profile    — 个人资料、PDF 简历解析与 AI 简历诊断
│   │   └── chat.js           # /api/chat       — 持久化 SSE 对话与 TTS
│   ├── middleware/
│   │   └── auth.js           # requireAuth：校验 Bearer JWT，提取 Supabase 用户信息
│   ├── lib/
│   │   ├── supabase.js       # 初始化 Supabase Admin 客户端
│   │   ├── geminiText.js     # 封装 Gemini SDK 的标准化提问逻辑
│   │   ├── interviewSessionStore.js # checkpoint、消息和并发提交
│   │   └── interviewLearning.js # 难度、RAG、反馈、能力矩阵与进步汇总
│   ├── live/
│   │   └── interviewLiveSocket.js # Gemini Live 连接及持久化断线恢复
│   └── services/             # （可选）核心算法或复杂 AI Prompt 渲染处理
├── package.json
├── .env.example              # 环境变量模板
└── README.md                 # 本文档
```

---

## ⚙️ 环境变量配置

复制 `.env.example` 为 `.env` 并填写相关密钥：

| 变量名 | 描述 | 备注 |
| :--- | :--- | :--- |
| `PORT` | 服务监听端口 | 默认为 `5000` |
| `SUPABASE_URL` | Supabase 项目 URL | 从项目设置 > API 获取 |
| `SUPABASE_SERVICE_ROLE_KEY`| 服务角色密钥 | **核心私钥**，请勿在前端暴露 |
| `GEMINI_API_KEY` | Google AI Studio 密钥 | 用于驱动面试逻辑、简历对比与报告翻译 |
| `FRONTEND_URL` | 允许跨域的前端主地址 | 开发阶段通常为 `http://localhost:3000` |

---

## 🔌 API 核心接口参考

所有业务路由均受 `requireAuth` 中间件保护，需携带 `Authorization: Bearer <supabase_access_token>`。

### 1. 面试管理 (`/api/interviews`)
- **GET `/`**: 获取当前用户的面试历史（最近 50 条）。
- **POST `/`**: 原子创建面试并扣除积分；请求包含 `idempotencyKey`、`interviewerType`
  （`hr` / `technical` / `mixed`）、`mode`、`difficulty`、职位、JD、时长、语言及简历快照。
  相同 `idempotencyKey` 重试不会重复创建、改变面试官类型或重复扣分。
- **POST `/:id/finalize`**: 调用 Gemini 生成最终面试报告，并将结构化结果更新至数据库。
- **POST `/:id/transcript`**: 面试过程中的自动保存（Autosave）。

### 2. 简历与个人中心 (`/api/profile`)
- **GET `/`**: 获取完整的个人资料（包含简历原文、AI 诊断报告）。
- **PUT `/`**: 更新用户简历或个人信息。
- **POST `/resume/parse-pdf`**: 将上传的 PDF 二进制流解析为纯文本，用于简历提取。
- **POST `/extract-cv`**: 利用 AI 从纯文本简历中提取姓名、经验、技能等结构化字段。
- **POST `/resume-coach`**: 生成深度的简历诊断建议。

### 3. 持久化面试会话 (`/api/chat`)

- **POST `/message`**: SSE 文本面试；请求必须包含 `interviewId` 和可重试复用的
  `idempotencyKey`。服务端按该面试 ID 恢复 checkpoint，并以乐观锁提交本轮消息。
- **GET `/session?interviewId=<uuid>`**: 获取指定面试的持久化流程状态。
- **POST `/reset`**: 兼容旧客户端的初始化检查；必须传 `interviewId`，不会清空已有状态。
- **WebSocket `/live`**: `start` 消息的 `config.interviewId` 必填。重连时只恢复该面试的
  快照和有限对话历史，每个完整语音回合都会持久化。

会话、学习状态和幂等创建由以下迁移依次建立，服务启动前必须全部应用：

1. `20260823233000_persistent_interview_sessions.sql`
2. `20260824090000_interview_modes_and_learning.sql`
3. `20260824120000_idempotent_interview_creation.sql`
4. `20260824130000_adaptive_question_trigger.sql`
5. `20260824140000_interviewer_types_and_practice_guards.sql`

### 4. 练习、正式模式与学习进度 (`/api/interview-sessions`)

- **GET `/:id`**：恢复指定面试的 checkpoint、当前问题、全部尝试、提示、笔记和练习时长/题数限制。
- **POST `/:id/questions/next`**：按 Easy/Medium/Hard 或 Adaptive 策略生成下一题；会检索相关公开面经作为来源。
- **POST `/:id/questions/:questionId/answer`**：练习模式立即返回证据化反馈并保留多次尝试；正式模式不返回中间反馈且禁止重答。
- **POST `/:id/questions/:questionId/hint`**：依次开放 `nudge`、`structure`、`key_points`、`example`；四级用尽后拒绝继续生成。
- **POST `/:id/pause|resume`**：仅练习模式允许，累计用时由服务端保存。
- **POST `/:id/questions/:questionId/retry|master|skip`** 与 **PUT `.../note`**：练习题控制和笔记。
- **POST `/:id/reconnect`** 与 **GET `/:id/reconnect-context`**：登记重连并只返回当前面试的有限必要上下文。
- **GET `/:id/competencies`**：岗位能力矩阵以及逐次回答的评分、原文证据和 rubric。
- **GET `/progress/practice`**：跨多场练习的首次/最新得分变化、增长项和待加强项。

所有产生副作用的接口都接受 `idempotencyKey`，并在数据库事务中校验
`state_version`。未回答的练习题不能标记为掌握；练习达到时长或题数上限后停止继续作答。
正式模式的 `deadline_at` 由服务端创建和判定，关闭页面不会停止计时。

面试官类型由 `src/config/interviewerTypes.js` 统一约束题型、Prompt 与报告重点。HR 面禁止
深度技术题，技术面禁止退化为纯 HR 问答，Mixed 保留综合覆盖；该配置从数据库恢复，不能由
后续客户端请求覆盖。

本地数据库状态机验收脚本位于
`test/sql/interview_sessions_integration.sql`；脚本在事务中运行并最终回滚测试数据。

### 状态与一致性规则

- Supabase PostgreSQL 是面试事实状态的唯一来源；进程内不保存业务 Session Map。
- `interviewId` 同时是业务隔离主键和 LangGraph `thread_id`。
- 每轮消息、checkpoint、兼容用 `transcript_json` 和状态版本在一次数据库事务中提交。
- 两个后端实例或浏览器标签页并发写入时，旧 `state_version` 会被拒绝；相同
  `idempotencyKey` 返回已提交结果。
- 练习模式允许暂停和即时反馈；正式模式按服务端 `deadline_at` 持续计时，禁止暂停、
  提示和重答，中间评分在完成前不会暴露给客户端。

---

## 🚀 安装、运行与部署

### 本地开发

本项目是 Node.js 后端，不使用 Python `venv`。每个项目的依赖安装在本目录的
`node_modules` 中，并由 `package-lock.json` 锁定版本，相当于项目级的隔离环境。

前置要求：安装 Node.js 22 或更高版本（推荐使用当前 LTS 版本）。在仓库根目录执行：

```bash
cd ai_interviewer_backend

# 严格按照 package-lock.json 安装依赖
npm ci

# macOS / Linux
cp .env.example .env

# Windows PowerShell（与上一条二选一）
Copy-Item .env.example .env
```

编辑 `.env`，填入 Supabase Service Role Key 和 Gemini API Key。`.env` 包含密钥，
不得提交到 Git。然后启动开发服务器：

```bash
npm run dev
```

默认监听 `http://localhost:5000`。可用健康检查确认服务正常：

```bash
curl http://localhost:5000/api/health
```

若不需要热更新，可运行生产启动命令：

```bash
npm start
```

### 本地 Supabase

本仓库的 `supabase/` 包含本地认证、数据库表、RLS、头像存储桶和测试题数据。
确保 Docker Desktop 正在运行，然后在后端目录执行：

```bash
npx supabase start
npx supabase db reset
npx supabase db lint --local --level warning
```

本地服务默认地址：API `http://127.0.0.1:54321`，Studio
`http://127.0.0.1:54323`，测试邮件 `http://127.0.0.1:54324`。可用
`npx supabase status` 查看本机生成的开发密钥；这些密钥只能用于本地开发。

停止本地 Supabase：

```bash
npx supabase stop
```

### 本地测试

```bash
# 后端单元与行为测试
node --test

# 本地 Supabase 已启动后，运行事务化数据库验收（测试数据最终回滚）
docker exec -i supabase_db_ai_interviewer_backend \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < test/sql/interview_sessions_integration.sql
```

数据库脚本覆盖同一用户多面试隔离、创建/扣分幂等、乐观锁冲突、练习模式完整动作、
正式模式截止时间及限制、Adaptive 难度和评分证据。当前持久化方案的阶段状态与上线前
人工验收项见 `technical documents/Persistent-Interview-Sessions-Plan.md`。

### Docker 部署

从后端目录构建镜像；不要把本地 `.env` 打包进镜像：

```bash
cd ai_interviewer_backend
docker build -t interviewde-backend .
docker run --rm -p 8080:8080 --env-file .env -e PORT=8080 interviewde-backend
```

服务启动后访问 `http://localhost:8080/api/health`。部署到 Cloud Run 等平台时，
应通过平台的环境变量或 Secret Manager 配置密钥，并让平台注入 `PORT`；不要在镜像、
Dockerfile 或代码仓库中写入密钥。

### Cloud Run 部署

后端通过 `.github/workflows/deploy-cloud-run.yml` 自动部署：每次 push 到 `main`，GitHub Actions
先执行 `npm ci` 和 `npm test`，通过后使用 Google Cloud Workload Identity Federation 构建并部署
Cloud Run，最后检查 `/api/health` 返回的 commit 是否等于本次 GitHub SHA。也可以在 Actions 页面
通过 `workflow_dispatch` 手动重跑。

GitHub 仓库的 `production` Environment 需要一次性配置：

| 类型 | 名称 | 示例/说明 |
|---|---|---|
| Variable | `GCP_PROJECT_ID` | 实际承载 `interview-backend` 的 Google Cloud 项目 ID |
| Variable | `GCP_REGION` | 当前生产服务使用 `us-central1` |
| Variable | `CLOUD_RUN_SERVICE` | `interview-backend` |
| Secret | `GCP_WORKLOAD_IDENTITY_PROVIDER` | 完整 WIF Provider 资源名 |
| Secret | `GCP_SERVICE_ACCOUNT` | GitHub 部署专用 Service Account 邮箱 |

WIF 必须把 GitHub OIDC `attribute.repository` 限定为
`ForeverTTT/ai_interviewer_backend`。部署账号需要 Cloud Run 源码部署、Cloud Build、Artifact
Registry 及目标运行时 Service Account 的必要权限。不要创建或上传长期 Service Account JSON key。

自动部署使用 `env_vars_update_strategy: merge`，只写入 `APP_COMMIT_SHA` 和 `APP_DEPLOYED_AT`，
不会覆盖 Cloud Run 中已有的 Supabase、Gemini 和 CORS 环境变量。

部署前须在 Cloud Run 中配置 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、
`GEMINI_API_KEY`、Gemini 模型变量和生产 `FRONTEND_URL`。推荐用 Secret Manager
保存私钥。部署后用 `/api/health` 检查服务，并确认 CORS 允许生产前端域名。

Supabase migration 不属于 Cloud Run 自动部署步骤，仍需在发布前单独审核和执行，避免应用代码发布时
未经确认修改生产数据库 Schema。

---

## 🛡️ 安全合规说明

1.  **权限保护**：所有数据库写操作均在后端进行，使用 **Service Role Key** 以绕过普通 RLS 策略，但应用层通过 `requireAuth` 严格限定只能操作 `user_id` 匹配的行。
2.  **机密性**：Gemini API 密钥与 Supabase 密钥仅保留在服务器环境变量中。
3.  **大报处理**：后端配置了 `10mb` 的请求体限制，以应对长篇 Job Description 或复杂 PDF 内容。
