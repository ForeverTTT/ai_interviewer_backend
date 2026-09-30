# AI Interviewer 项目

这是一个前后端同仓库的智能面试应用。前端使用 React、Vite 和 Firebase Hosting；后端使用 Node.js、Express、Supabase 和 Gemini，并部署到 Cloud Run。

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

`backend/data/prompts/*.md` 是程序按固定文件名读取的运行时模板，因此与普通说明文档分开管理。

## 本地开发

使用 Node.js 22.12+（22.x）。前后端分别安装依赖、配置环境变量、启动服务：

```powershell
cd backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

在另一个终端运行：

```powershell
cd frontend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

后端默认监听 `http://localhost:5000`，前端默认监听 `http://localhost:3000`。请按需填写各自的 `.env`，不要提交密钥。已有本地配置无需再次复制覆盖。

详细设置、测试及部署方法见[文档索引](docs/文档索引.md)。
