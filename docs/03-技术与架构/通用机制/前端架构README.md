# 前端架构

> 状态：现行 · 最后核对：2026-08-26 · 2026-10-01 改为只记录跨页面的通用机制，各页面实现移到对应功能的技术文档 · 产品说明：[通用规则 · 多语言、主题与品牌](../../01-产品/通用规则.md)

本文只记录前端**跨页面的通用机制**：技术栈、目录、构建、路由与布局、认证、状态、i18n、样式、通用组件、动效和后端通信。各页面的实现见[第 10 节](#10-页面详解)的对照表。

## 目录

1. [技术栈总览](#1-技术栈总览)
2. [项目结构](#2-项目结构)
3. [构建与开发环境](#3-构建与开发环境)
4. [路由系统](#4-路由系统)
5. [认证体系](#5-认证体系)
6. [状态管理](#6-状态管理)
7. [国际化 (i18n)](#7-国际化-i18n)
8. [样式系统](#8-样式系统)
9. [组件体系](#9-组件体系)
10. [页面详解](#10-页面详解)
11. [SSE 流式通信](#11-sse-流式通信)
12. [语音交互 (TTS / STT)](#12-语音交互-tts--stt)
13. [动效系统](#13-动效系统)
14. [后端通信](#14-后端通信)
15. [环境变量与配置](#15-环境变量与配置)
16. [设计规范](#16-设计规范)

---

## 1. 技术栈总览

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **框架** | React | 18.3 | UI 组件化开发 |
| **构建工具** | Vite | 8.2 | 极速 HMR + 生产构建 |
| **路由** | React Router | 7.18 | SPA 路由 + 路由守卫 |
| **样式** | Tailwind CSS | 3.4 | 原子化 CSS 方案 |
| **后处理** | PostCSS + Autoprefixer | 8.5 / 10.4 | CSS 编译与厂商前缀 |
| **认证** | Supabase Auth | 2.45 | OAuth (Google / LinkedIn OIDC) |
| **国际化** | i18next + react-i18next | 25.10 / 16.6 | 三语 (zh/en/de) |
| **语言检测** | i18next-browser-languagedetector | 8.2 | 浏览器自动语言检测 |
| **图标** | Lucide React | 0.446 | SVG 图标库 |
| **动效** | Framer Motion | 11.5 | 页面过渡与交互动画 |
| **3D** | three | 0.180 | 落地页拱廊场景（`ArchCorridor3D`，按需动态加载） |
| **数字人（预留）** | TalkingHead | 1.7 | 已安装但没有被使用；数字人抽象层见[数字人](../模拟面试/数字人.md) |

### 依赖一览

**生产依赖**：

```json
{
  "@met4citizen/talkinghead": "^1.7.0",
  "@supabase/supabase-js": "^2.45.0",
  "clsx": "^2.1.1",
  "framer-motion": "^11.5.0",
  "i18next": "^25.10.9",
  "i18next-browser-languagedetector": "^8.2.1",
  "lucide-react": "^0.446.0",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-i18next": "^16.6.6",
  "react-router-dom": "^7.18.2",
  "three": "^0.180.0"
}
```

**开发依赖**：

```json
{
  "@vitejs/plugin-react": "^6.0.5",
  "autoprefixer": "^10.4.20",
  "postcss": "^8.5.26",
  "tailwindcss": "^3.4.11",
  "vite": "^8.2.1"
}
```

---

## 2. 项目结构

```
frontend/
├── public/
│   ├── avatars/               # 用户头像图片
│   ├── images/                # 静态图片
│   ├── logos/                 # 院校标识
│   └── landit-icon-*.svg     # Landit 品牌图标
├── index.html                 # 入口 HTML（含首屏防闪烁脚本）
├── src/
│   ├── main.jsx               # React 入口，加载 i18n → 渲染 App
│   ├── App.jsx                # 路由定义 + Layout 壳
│   ├── index.css              # 全局样式（Tailwind + 自定义动画）
│   ├── pages/                 # 12 个页面组件
│   │   ├── LandingPage.jsx        # 首页（营销、特性展示）
│   │   ├── LoginPage.jsx          # 登录页（Google/LinkedIn OAuth）
│   │   ├── AuthCallbackPage.jsx   # OAuth 回调处理
│   │   ├── SetupPage.jsx          # 面试配置（职位/JD/简历/历史记录）
│   │   ├── InterviewPage.jsx      # 面试核心页（全屏沉浸模式）
│   │   ├── DashboardPage.jsx      # 成长中心
│   │   ├── NotesPage.jsx          # 题目收藏
│   │   ├── ProfilePage.jsx        # 个人资料（简历/头像/CV 解析/简历诊断/能量值）
│   │   ├── ResumeTailorPage.jsx   # 简历优化与动机信
│   │   ├── InterviewReportPage.jsx# 面试报告详情
│   │   ├── GallupTestPage.jsx     # 盖洛普优势测试
│   │   └── ExperiencesPage.jsx    # 面经库展示
│   ├── avatar/                # 数字人抽象层（未接入），见 面试/数字人.md
│   ├── components/            # 27 个组件（17 个根目录 + 10 个子目录）
│   │   ├── ChatInterface.jsx      # 核心：SSE + TTS + STT + 消息渲染
│   │   ├── PracticeInterviewPanel.jsx # 练习状态控制器；复用 ChatInterface 的正式模拟房间界面
│   │   ├── Navbar.jsx             # 顶栏导航
│   │   ├── Footer.jsx             # 页脚
│   │   ├── ProtectedRoute.jsx     # 路由守卫
│   │   ├── ThemeToggle.jsx        # 主题切换按钮
│   │   ├── LanguageSwitcher.jsx   # 语言切换下拉
│   │   ├── GallupReport.jsx       # Gallup 报告展示
│   │   ├── CheckInModal.jsx       # 签到弹层
│   │   ├── OfferLogosMarquee.jsx  # 品牌 Logo 滚动
│   │   ├── TestimonialsMarquee.jsx# 用户评价跑马灯
│   │   ├── AdvantagesShowcase.jsx # 优势卖点区块
│   │   ├── HowItWorksShowcase.jsx # 流程说明区块
│   │   ├── TechnologyShowcase.jsx # 技术能力展示区块
│   │   ├── app/
│   │   │   └── AppShell.jsx       # 登录后的侧栏工作台外壳
│   │   ├── brand/                 # 品牌视觉层
│   │   │   ├── PageAtmosphere.jsx # 内页背景「大气层」（港口插画 + 薄雾 + 颗粒）
│   │   │   ├── PageHeader.jsx     # 内页统一页头
│   │   │   ├── HarborStage.jsx    # 港口场景舞台
│   │   │   ├── InterviewPreview.jsx # 面试界面预览
│   │   │   ├── BrandKit.jsx       # 品牌元素集合
│   │   │   └── Marquee.jsx        # 通用跑马灯
│   │   └── landing/               # 落地页专用区块
│   │       ├── HarborHero.jsx     # 首屏主视觉
│   │       ├── ArchCorridor3D.jsx # 拱廊 3D 场景（懒加载 three）
│   │       └── ClosingCta.jsx     # 页尾转化区
│   ├── context/               # 全局 Context
│   │   └── ThemeContext.jsx       # 主题管理 Provider
│   ├── hooks/                 # 自定义 Hooks
│   │   ├── useAuth.js             # Supabase 认证 Hook
│   │   ├── useAccountStatus.js    # 能量值余额等账户状态
│   │   ├── useMediaQuery.js       # 响应式断点
│   │   └── useGeminiLiveInterview.js # Gemini Live 语音连接（携带 interviewId）
│   ├── lib/                   # 工具库
│   │   ├── supabase.js            # Supabase 客户端初始化
│   │   ├── backendBase.js         # 后端 URL 管理
│   │   ├── authenticatedFetch.js  # 带 token 刷新的 fetch 封装
│   │   ├── lazyWithReload.js      # 部署后 chunk 失效时自动刷新一次
│   │   ├── interviewEvents.js     # 上报面试生命周期事件
│   │   ├── jobDescriptionParser.js# 本地 JD 解析（岗位/类别/雇佣类型）
│   │   ├── documentExport.js      # 导出 Word / PDF
│   │   ├── textNormalization.js   # 中英混排空格处理
│   │   └── cvProfileDefaults.js   # 简历结构化默认值
│   ├── locales/               # 国际化资源
│   │   ├── zh.json                # 简体中文
│   │   ├── en.json                # English
│   │   └── de.json                # Deutsch
│   └── i18n/
│       └── config.js              # i18next 初始化配置
├── tailwind.config.js         # Tailwind 主题扩展
├── postcss.config.js          # PostCSS 插件链
├── vite.config.js             # Vite 配置（端口、代理）
├── package.json
└── .env                       # 环境变量（不入版本库）
```

---

## 3. 构建与开发环境

### Vite 配置

```javascript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
```

**关键点**：
- 开发服务器端口：**3000**
- API 代理：`/api` → `localhost:5000`（开发环境无需 CORS）
- React 插件：`@vitejs/plugin-react`（Fast Refresh + JSX 转换）
- 模块系统：ESM（`"type": "module"`）

### 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 (HMR) |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 预览生产构建 |

---

## 4. 路由系统

### 路由架构

```
BrowserRouter
└── AppThemeShell (ThemeProvider + MotionConfig + Outlet + CookieBanner)
    ├── / .......................... LandingPage (Layout, atmosphere=false)
    ├── /login .................... LoginPage (无布局)
    ├── /auth/callback ............ AuthCallbackPage (无布局，且不能包 ProtectedRoute)
    ├── /setup .................... SetupPage (ProtectedRoute + AppShell)
    ├── /interview ................ InterviewPage (无布局, 全屏)
    ├── /interview/:interviewId ... InterviewPage (无布局, 全屏，可刷新恢复)
    ├── /dashboard ................ DashboardPage (ProtectedRoute + AppShell)
    ├── /notes .................... NotesPage (ProtectedRoute + AppShell)
    ├── /profile .................. ProfilePage (ProtectedRoute + AppShell)
    ├── /profile/edit ............. ProfilePage (ProtectedRoute + AppShell)
    ├── /resume-tailor ............ ResumeTailorPage (ProtectedRoute + AppShell)
    ├── /interview/:id/report ..... InterviewReportPage (ProtectedRoute + AppShell)
    ├── /gallup ................... GallupTestPage (ProtectedRoute + AppShell)
    └── /experiences .............. ExperiencesPage (AdaptiveLayout, 公开)
```

### 三种布局

登录前后是两套不同的外壳，由每条路由各自选定：

| 布局 | 组成 | 用在哪 |
|---|---|---|
| `Layout` | `PageAtmosphere` + `Navbar` + `<main>` + `Footer` | 官网式顶栏：落地页，以及未登录时的面经库 |
| `AppShell` | 左侧液态玻璃侧栏 + 内容区 | 登录后的全部工作台页面 |
| `AdaptiveLayout` | 按登录态二选一 | 只用于 `/experiences`：已登录进 `AppShell`，未登录回落到 `Layout` |

`Layout` 接受两个开关：`atmosphere={false}` 关掉背景大气层，落地页自带主视觉，用的就是这个；`hideFooter` 可隐藏页脚，目前没有调用方传它。

`AppShell` 的侧栏把导航分成「面试训练 / 求职材料 / 社区」三组，桌面端是固定侧栏、移动端是抽屉，折叠状态存在 localStorage 的 `landit_sidebar_collapsed`。

- 面试页 (`/interview`、`/interview/:interviewId`) 不套任何布局，实现全屏沉浸模式
- 登录页和 OAuth 回调页独立于布局
- 面经库 (`/experiences`) 公开访问，不需要登录

### ProtectedRoute

使用 `useAuth()` 检查 Supabase 会话，未登录自动跳转 `/login`。

### 路由间数据传递

`SetupPage → InterviewPage` 创建成功后导航到 `/interview/:interviewId`，同时用 React Router
`state` 传递首屏配置以减少一次等待：
- `position`、`jobDescription`、`language`、`duration`
- `interviewId`（后端创建的面试记录 ID）
- `mode`（`practice` / `formal`）与 `difficulty`（Easy/Medium/Hard/Adaptive）
- `interviewerType`（`hr` / `technical` / `mixed`）
- `resumeContext`（简历文本）

直接刷新 `/interview/:interviewId` 时，页面通过 `GET /api/interviews/:id` 重新取得配置，再由
聊天或练习组件恢复 checkpoint、题目、尝试和有限对话历史。无 ID 的兼容路由 `/interview`
仍要求导航 `state`，缺失时返回 `/setup`。

---

## 5. 认证体系

### 架构

```
用户 → LoginPage (OAuth Button)
          │
          ▼
      Supabase Auth (Google / LinkedIn OIDC)
          │
          ▼
      /auth/callback → AuthCallbackPage
          │ exchangeCodeForSession
          ▼
      Supabase Session (JWT)
          │
          ▼
      localStorage (自动持久化)
```

### Supabase 客户端

`src/lib/supabase.js`：

```javascript
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    detectSessionInUrl: true,    // OAuth 回调自动检测
    persistSession: true,        // localStorage 持久化
    autoRefreshToken: true,      // Token 自动续期
  },
})
```

### useAuth Hook

`src/hooks/useAuth.js`：

| 返回值 | 类型 | 说明 |
|--------|------|------|
| `user` | `User \| null` | 当前用户对象 |
| `loading` | `boolean` | 会话加载中 |
| `signInWithGoogle()` | `async function` | Google OAuth 登录 |
| `signInWithLinkedIn()` | `async function` | LinkedIn OIDC 登录 |
| `signOut()` | `async function` | 退出登录 |

### Bearer Token 传递

所有需要认证的 API 调用统一模式：

```javascript
const { data: { session } } = await supabase.auth.getSession()
const token = session?.access_token

fetch(`${backendUrl}/api/xxx`, {
  headers: { Authorization: `Bearer ${token}` },
})
```

---

## 6. 状态管理

### 策略：无全局状态库

本项目 **不使用** Redux、Zustand 等全局状态管理库，采用以下方式：

| 层级 | 方式 | 范围 |
|------|------|------|
| 全局主题 | `ThemeContext` | 整个应用 |
| 认证状态 | `useAuth` Hook | 各组件独立调用 |
| 页面数据 | `useState` + `useEffect` | 页面级 |
| 组件间传参 | Props / 路由 `state` | 父子组件 |
| 持久化 | `localStorage` | 主题、语言、JD 历史 |
| 面试业务状态 | Supabase（通过后端 API） | checkpoint、消息、题目、尝试、提示、笔记和计时 |

### ThemeContext

`src/context/ThemeContext.jsx`：

```javascript
const value = {
  theme,            // 'light' | 'dark'
  setTheme,         // (mode) => void
  appTheme,         // theme 的别名
  setAppTheme,      // setTheme 的别名
  isInterview,      // 当前是否在 /interview 路由
  isDark,           // theme === 'dark'
}
```

**机制**：
- `localStorage` key: `interviewde_theme`
- `useLayoutEffect` 同步 `document.documentElement.classList.toggle('dark')`
- 面试路由下不包裹外层背景色 div

### localStorage 键值表

| Key | 用途 | 模块 |
|-----|------|------|
| `interviewde_theme` | 主题偏好 | ThemeContext |
| `interviewde_lang` | UI 语言偏好 | i18n config |
| `interviewde_jd_history` | 职位描述历史记录 | SetupPage |

---

## 7. 国际化 (i18n)

### 配置

`src/i18n/config.js`：

```javascript
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { zh, en, de },
    fallbackLng: 'zh',
    supportedLngs: ['zh', 'en', 'de'],
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'interviewde_lang',
    },
  })
```

### 三语资源文件

| 文件 | 说明 | 大致 Key 数 |
|------|------|------------|
| `locales/zh.json` | 简体中文（默认） | ~400+ |
| `locales/en.json` | English | ~400+ |
| `locales/de.json` | Deutsch | ~400+ |

### 命名空间结构

```
{
  "meta": { ... },
  "nav": { ... },
  "footer": { ... },
  "landing": { ... },
  "setup": { ... },
  "interview": { ... },
  "dashboard": { ... },
  "report": { ... },
  "profile": { ... },
  "exp": { ... },
  "gallup": { ... },
  "login": { ... },
}
```

### UI 语言 vs 面试语言

| 概念 | 控制方式 | 影响范围 |
|------|---------|---------|
| UI 语言 | `i18n.changeLanguage()` / LanguageSwitcher | 按钮文字、标签、提示信息 |
| 面试语言 | SetupPage `form.language` | AI 提问语种、TTS 音色、STT 识别语言 |

两者相互独立：可以用中文 UI 进行英语面试。

---

## 8. 样式系统

### Tailwind CSS 配置

**深色模式**：`darkMode: 'class'`（通过 `<html class="dark">` 切换）

**品牌色**：Orange 系列（`primary-50` ~ `primary-950`）

```javascript
colors: {
  primary: {
    50: '#fff7ed',   // 最浅
    500: '#f97316',  // 主色
    900: '#7c2d12',  // 最深
    950: '#431407',
  },
}
```

**字体**：

| 字体族 | 字体 | 用途 |
|--------|------|------|
| `sans` | Inter | 正文默认 |
| `serif` | Source Serif 4 | 标题（如页面大标题） |
| `display` | Outfit | 展示文字 |
| `font-chinese-modern` | Noto Sans SC | 中文粗体场景 |

### 自定义组件类

在 `index.css` 的 `@layer components` 中定义：

| 类名 | 用途 |
|------|------|
| `.btn-primary` | 橙色渐变主按钮（圆角全圆、阴影、hover 上浮） |
| `.btn-primary-dark` | 黑/白反色主按钮 |
| `.btn-secondary` | 白底边框次要按钮 |
| `.btn-ghost` | 无底色幽灵按钮 |
| `.btn-setup-action` | 设置页操作按钮（灰色圆角矩形） |
| `.btn-setup-action-pill` | 设置页胶囊按钮 |
| `.input-field-premium` | 高级输入框（圆角 2xl、聚焦环） |
| `.textarea-field-premium` | 高级文本域（圆角 2rem） |
| `.card-premium` | 高级卡片（圆角 2.5rem、hover 阴影+上浮） |
| `.section-badge` | 区域徽章（如"配置你的模拟面试"） |
| `.gradient-text` | 渐变文字（橙色系） |
| `.glass` | 毛玻璃效果 |

### 自定义动画

| 动画名 | 用途 |
|--------|------|
| `fade-in` | 淡入 (0.8s) |
| `slide-up` | 上滑淡入 (0.8s) |
| `reveal` | 弹性揭示 (1.2s) |
| `drift` / `drift-slow` | 上下 8px 缓慢漂浮 (9s / 14s) |
| `pulse-soft` | 透明度与缩放的轻呼吸 (2.4s) |
| `dh-mouth` / `dh-wave` / `dh-breathe` / `dh-thinking` | 数字人动效（预留） |
| `marquee` / `marquee-reverse` / `lk-marquee` | 水平无限滚动 (50s / 50s / 60s) |

### 滚动条定制

全局使用细滚动条，track 透明，thumb 为圆角灰色，hover 时加深。

---

## 9. 组件体系

### 核心组件

面试相关的核心组件 `ChatInterface`、`PracticeInterviewPanel` 见[模拟面试 · 面试房间](../模拟面试/面试房间.md#2-核心组件)。

#### Navbar.jsx (318 行)

| 功能 | 说明 |
|------|------|
| 桌面端导航 | 首页 / 面试 / 历史 / 资料 / 面经库 / 优势测试 |
| 移动端抽屉 | 汉堡菜单 → 全屏链接列表 |
| 用户菜单 | 头像下拉 → Dashboard / Profile / 求职状态 / 退出 |
| 路由高亮 | `isActive(path)` + 下划线指示器 |
| 集成 | LanguageSwitcher + ThemeToggle |

#### ProtectedRoute.jsx (54 行)

```
检查 Supabase 会话 → 有效：渲染 children → 无效：跳转 /login
```

### 营销 / 展示组件

| 组件 | 行数 | 说明 |
|------|------|------|
| `OfferLogosMarquee` | 124 | 品牌 Logo 无限水平滚动 |
| `TestimonialsMarquee` | 90 | 用户评价跑马灯 |
| `AdvantagesShowcase` | 118 | 平台优势卖点展示 |
| `HowItWorksShowcase` | 106 | 使用流程步骤说明 |
| `TechnologyShowcase` | 158 | 技术能力/特性展示 |
| `GallupReport` | 208 | Gallup 报告卡片渲染 |
| `CheckInModal` | 207 | 签到弹层（含动画） |

---

## 10. 页面详解

各页面的实现写在对应功能的技术文档中，本文只保留跨页面的通用机制。

| 页面 | 技术文档 |
|---|---|
| `LandingPage`、`LoginPage`、`AuthCallbackPage` | [首页与登录](../首页与登录.md) |
| `SetupPage` | [面试配置](../面试配置.md) |
| `InterviewPage` | [模拟面试 · 面试房间](../模拟面试/面试房间.md) |
| `InterviewReportPage` | [面试报告](../面试报告.md) |
| `DashboardPage` | [成长中心](../成长中心.md) |
| `NotesPage` | [题目收藏](../题目收藏.md) |
| `ProfilePage` | [个人资料与简历](../个人资料与简历.md) |
| `ResumeTailorPage` | [简历优化](../简历优化.md) |
| `GallupTestPage` | [优势测试](../优势测试.md) |
| `ExperiencesPage` | [面经库](../面经库.md) |

---

## 11. SSE 流式通信

前端 SSE 解析见[面试房间 · 兼容通道：SSE 文本面试](../模拟面试/面试房间.md#3-兼容通道sse-文本面试)，后端事件类型见[agent与Prompt · SSE 流式通信](../模拟面试/agent与Prompt.md#10-sse-流式通信)。

---

## 12. 语音交互 (TTS / STT)

前端 TTS（`useStreamingTTS`、四级降级、分句策略）见[实时语音与TTS · 前端实现](../模拟面试/实时语音与TTS.md#4-前端实现)；当前所有面试使用的 Gemini Live 见同文第 11 节；浏览器 STT 兼容通道见[面试房间](../模拟面试/面试房间.md#4-兼容通道浏览器语音识别)。

---

## 13. 动效系统

### Framer Motion 使用

**页面级动画**：

```jsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  className="..."
>
```

**列表动画**：

```jsx
<AnimatePresence mode="popLayout">
  {items.map(item => (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
    />
  ))}
</AnimatePresence>
```

**展开/收起**：

```jsx
<AnimatePresence>
  {expanded && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
    />
  )}
</AnimatePresence>
```

### 使用 Framer Motion 的文件

**页面**：LandingPage, SetupPage, DashboardPage, ProfilePage, InterviewReportPage, ExperiencesPage, LoginPage, GallupTestPage

**组件**：TechnologyShowcase, TestimonialsMarquee, OfferLogosMarquee, HowItWorksShowcase, GallupReport, AdvantagesShowcase, CheckInModal

### CSS 动画

部分场景使用 Tailwind + 自定义 CSS（如 marquee 滚动、极光背景），不依赖 Framer Motion。

---

## 14. 后端通信

### API 基地址

`src/lib/backendBase.js`：

```javascript
export function getBackendBaseUrl() {
  const raw = import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL
  if (raw != null && String(raw).trim() !== '') {
    return String(raw).replace(/\/$/, '')
  }
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return '<configured production Cloud Run origin>'
  }
  return 'http://localhost:5000'
}
```

开发环境下 Vite 同时代理 `/api` 到 5000，两种方式互为冗余。

### API 端点

前端调用的全部接口见 [API 参考](../../04-参考/API.md)。所有需要鉴权的请求都通过 `lib/authenticatedFetch.js` 发出（自动附加 token、遇到 401 刷新后重试一次）。

---

## 15. 环境变量与配置

前端环境变量的完整清单（含默认值、优先级和生产配置）见[环境变量 · 前端](../../02-开发指南/环境变量.md#前端frontendenv)。要点：所有变量以 `VITE_` 开头并会编译进浏览器代码；`VITE_API_URL` 优先于 `VITE_BACKEND_URL`。

---

## 16. 设计规范

### 视觉风格

- **设计语言**：Premium Minimalist（高端极简）
- **圆角**：大圆角为主（`rounded-2xl` ~ `rounded-[2.5rem]`）
- **阴影**：轻柔阴影 + hover 时加深上浮
- **字重**：标题 `font-black`(900)，正文 `font-medium`(500)~`font-bold`(700)
- **间距**：宽松留白（`space-y-8` ~ `space-y-16`）
- **大小写**：标签/徽章全大写 `uppercase tracking-widest`

### 色彩体系

| 用途 | 浅色模式 | 深色模式 |
|------|---------|---------|
| 页面背景 | `#FAF9F6` / `bg-sky-50/50` | `slate-950` (#020617) |
| 卡片背景 | `white` | `slate-950` |
| 主文字 | `slate-900` | `white` |
| 次文字 | `slate-500`~`slate-600` | `slate-400`~`slate-500` |
| 品牌色 | `orange-500`~`orange-600` | `orange-400`~`orange-500` |
| 成功 | `emerald-*` | `emerald-*` |
| 错误 | `red-*` | `red-*` |
| 边框 | `slate-100`~`slate-200` | `slate-800` |

### 响应式断点

使用 Tailwind 默认断点：

| 断点 | 宽度 | 用途 |
|------|------|------|
| `sm` | 640px | 小屏适配 |
| `md` | 768px | 平板/桌面分列 |
| `lg` | 1024px | 桌面宽屏 |

### 最大宽度

- 内容区：`max-w-7xl`（1280px）
- 内边距：`px-6 lg:px-10` 或 `px-6 lg:px-12`
