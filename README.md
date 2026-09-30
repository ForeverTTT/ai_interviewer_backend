# AI Interviewer / OfferClaw

这是一个前后端同仓库的智能面试应用。`frontend/` 是 React + Vite 客户端，部署在 Firebase Hosting；`backend/` 是 Node.js + Express API，使用 Supabase 和 Gemini，部署在 Cloud Run。

线上地址：[前端](https://aiinterviewer-491711-7b1cf.web.app/) · [后端健康检查](https://interview-backend-557559701677.europe-west1.run.app/api/health)

## 文件结构

```text
ai_interviewer_backend/
├── backend/                 后端应用
│   ├── src/                 API、智能体、业务逻辑
│   ├── data/                运行时 Prompt 模板与知识库
│   ├── scripts/             开发和诊断脚本
│   ├── test/                自动化测试与 SQL 集成测试
│   ├── supabase/            本地配置、迁移和种子数据
│   ├── Dockerfile           Cloud Run 镜像定义
│   ├── package.json         后端依赖和命令
│   └── .env.example         后端环境变量模板
├── frontend/                前端应用
│   ├── src/                 React 页面、组件和客户端逻辑
│   ├── public/              不经过打包的静态资源
│   ├── firebase.json        Hosting 配置
│   ├── vite.config.js       开发服务器与构建配置
│   ├── package.json         前端依赖和命令
│   └── .env.example         前端环境变量模板
├── docs/                    按前后端及用途分类的文档
│   ├── 后端/                 开发指南、技术文档、设计方案、部署运维
│   ├── 前端/                 开发指南、技术文档、产品与规划
│   └── 文档索引.md           全部说明文档入口
└── .github/workflows/       前后端自动部署工作流
```

`backend/data/prompts/*.md` 是程序按固定文件名读取的运行时模板，不是说明文档，因而保留原文件名和位置。

## 本地开发

需要 Node.js 22.12 或更新的 22.x 版本。以下命令从仓库根目录开始，分别在两个终端运行。首次配置时从模板创建 `.env`；已有本地 `.env` 不会被覆盖。运行 `npm run dev` 前，请先填写配置：后端至少需要 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 和 `GEMINI_API_KEY`；前端至少需要 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`，并通过 `VITE_BACKEND_URL` 或优先级更高的 `VITE_API_URL` 指向后端。

后端终端：

```powershell
cd backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

填写 `backend/.env` 后，在该终端启动：

```powershell
npm run dev
```

前端终端：

```powershell
cd frontend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

填写 `frontend/.env` 后，在该终端启动：

```powershell
npm run dev
```

后端默认监听 `http://localhost:5000`，前端默认监听 `http://localhost:3000`。不要将后端 Service Role Key 写入任何 `VITE_*` 变量，也不要提交真实 `.env`。

本地健康检查：`http://localhost:5000/api/health`。若前端请求意外打到线上后端，先检查 `frontend/.env` 是否设置了 `VITE_API_URL`；该变量优先于 `VITE_BACKEND_URL`。

## 测试与部署

```powershell
cd backend
npm test
```

```powershell
cd frontend
npm run build
```

后端 Docker 构建从仓库根目录执行：`docker build -t interviewde-backend backend`。推送到 `main` 时，后端运行文件变更会触发 Cloud Run 工作流，前端文件变更会触发 Firebase Hosting 工作流；文档改动不会单独触发后端部署。数据库迁移需单独审核执行，不随 Cloud Run 自动部署。

详细设置、测试及部署方法见[后端开发指南](docs/后端/开发指南/后端开发指南.md)、[前端开发指南](docs/前端/开发指南/前端开发指南.md)和[文档索引](docs/文档索引.md)。
