# InterviewDE — 后端服务 (Backend)

> **基于 Node.js + Express + Supabase + Gemini 的智能面试中枢**

后端服务负责处理核心业务逻辑，包括面试会话流管理、多模态报告生成、简历解析诊断（Gemini API）以及基于授权用户的数据库操作。应用采用 **Node.js ES 模块** (`"type": "module"`) 开发。

---

## 🛠️ 技术栈

| 模块 | 技术 | 说明 |
| :--- | :--- | :--- |
| **运行时** | Node.js 18+ | 建议通过 `nvm` 管理版本 |
| **HTTP 框架**| Express 4 | 业务接口转发与中间件支持 |
| **数据库/认证** | Supabase SDK | 使用 **Service Role**（管理权限）与 **Auth API**（用户校验） |
| **AI 模型** | Google Gemini | **Dialog**: `gemini-1.5-flash` / `gemini-2.0-flash` <br> **CV Analysis**: `gemini-1.5-pro` |
| **其他组件** | pdf-parse, cors, dotenv | 提供 PDF 提取、跨域支持及配置管理 |

---

## 📂 核心目录结构

```text
backend/
├── src/
│   ├── index.js              # 应用入口：CORS 配置、路由挂载、错误捕获
│   ├── routes/
│   │   ├── interviews.js     # /api/interviews — 面试记录 CRUD 与 报告定稿逻辑
│   │   ├── profile.js        # /api/profile    — 个人资料、PDF 简历解析与 AI 简历诊断
│   │   └── chat.js           # /api/chat       — （如有）实时 TTS 或流式对话适配
│   ├── middleware/
│   │   └── auth.js           # requireAuth：校验 Bearer JWT，提取 Supabase 用户信息
│   ├── lib/
│   │   ├── supabase.js       # 初始化 Supabase Admin 客户端
│   │   └── geminiText.js     # 封装 Gemini SDK 的标准化提问逻辑
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
- **POST `/`**: 创建新面试条目（包含职位、JD、时长、语言及简历快照）。
- **POST `/:id/finalize`**: 调用 Gemini 生成最终面试报告，并将结构化结果更新至数据库。
- **POST `/:id/transcript`**: 面试过程中的自动保存（Autosave）。

### 2. 简历与个人中心 (`/api/profile`)
- **GET `/`**: 获取完整的个人资料（包含简历原文、AI 诊断报告）。
- **PUT `/`**: 更新用户简历或个人信息。
- **POST `/resume/parse-pdf`**: 将上传的 PDF 二进制流解析为纯文本，用于简历提取。
- **POST `/extract-cv`**: 利用 AI 从纯文本简历中提取姓名、经验、技能等结构化字段。
- **POST `/resume-coach`**: 生成深度的简历诊断建议。

---

## 🚀 安装、运行与部署

### 本地开发

本项目是 Node.js 后端，不使用 Python `venv`。每个项目的依赖安装在本目录的
`node_modules` 中，并由 `package-lock.json` 锁定版本，相当于项目级的隔离环境。

前置要求：安装 Node.js 18 或更高版本（推荐使用当前 LTS 版本）。在仓库根目录执行：

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
```

本地服务默认地址：API `http://127.0.0.1:54321`，Studio
`http://127.0.0.1:54323`，测试邮件 `http://127.0.0.1:54324`。可用
`npx supabase status` 查看本机生成的开发密钥；这些密钥只能用于本地开发。

停止本地 Supabase：

```bash
npx supabase stop
```

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

---

## 🛡️ 安全合规说明

1.  **权限保护**：所有数据库写操作均在后端进行，使用 **Service Role Key** 以绕过普通 RLS 策略，但应用层通过 `requireAuth` 严格限定只能操作 `user_id` 匹配的行。
2.  **机密性**：Gemini API 密钥与 Supabase 密钥仅保留在服务器环境变量中。
3.  **大报处理**：后端配置了 `10mb` 的请求体限制，以应对长篇 Job Description 或复杂 PDF 内容。
