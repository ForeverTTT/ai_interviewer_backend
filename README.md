# LandIt — AI 面试训练平台

这是一个前后端同仓库的智能面试应用（产品名和历史名称的对应关系见[产品概览](docs/01-产品/产品概览.md#名称约定)）。`frontend/` 是 React + Vite 客户端，部署在 Firebase Hosting；`backend/` 是 Node.js + Express API，使用 Supabase 和 Gemini，部署在 Cloud Run。

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
├── docs/                    项目文档，入口是 docs/README.md
│   ├── 01-产品/              产品概览与功能说明
│   ├── 02-开发指南/          本地开发、环境变量、测试、代码约定
│   ├── 03-架构/              按业务领域划分的技术架构
│   ├── 04-参考/              API、数据库、术语表
│   ├── 05-运维/              部署、迁移发布、故障排查
│   └── 06-决策与方案/        设计方案与问题清单
└── .github/workflows/       前后端自动部署与前端 PR 预览
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

后端 Docker 构建从仓库根目录执行：`docker build -t interviewde-backend backend`。本仓库是前后端唯一的 GitHub Actions 正式部署源：推送到 `main` 时，后端运行文件变更触发 Cloud Run 部署，前端文件变更触发 Firebase Hosting `live` 部署；前端 PR 使用独立预览频道。当前前端源码由原独立前端仓库提交 `6b8d11df` 同步而来，已验证可构建出原线上版本的相同资源。原独立前端仓库的推送现在只做构建检查，不再部署 Hosting。数据库迁移仍需单独审核执行，不随 Cloud Run 自动部署。

详细说明见[本地开发](docs/02-开发指南/本地开发.md)、[环境变量](docs/02-开发指南/环境变量.md)、[测试](docs/02-开发指南/测试.md)、[部署总览](docs/05-运维/部署总览.md)；全部文档的入口是[文档索引](docs/README.md)。
