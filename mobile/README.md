# FlowLab Mobile

基于现有 Web 工作台视觉的 React Native / Expo App 首版 UI，兼顾 iOS 与 Android。启动后直接进入「今日」，没有 Landing Page。

## 本地预览

需要 Node.js 22.13 或更高版本。移动端有独立依赖，不影响 `frontend/` 和后端。

```sh
cd mobile
npm ci
npm run web -- --port 8083
```

打开 http://localhost:8083 。浏览器预览来自同一套 React Native 组件；桌面宽度下限制在 480px，方便先调整 App 界面。浏览器效果不能代替真机对安全区域、键盘、字体和原生导航的检查。

首次原生运行需要开发客户端（已安装 `expo-dev-client`），不要依赖 Expo Go 的 SDK 兼容情况：

```sh
npx expo run:ios
# 或已配置 Android SDK 时
npx expo run:android
```

之后使用 `npm start` 连接已有开发客户端。以上原生命令会生成被忽略的 `ios/`、`android/` 文件夹；原生配置维护在 `app.json`，不要手改生成文件。本版包名 `com.flowlab.career.preview` 仅用于开发预览，正式发布前需确定正式标识、签名和高分辨率应用图标。

## 页面与交互

- **今日**：练习入口、目标、进度、小工具、最近报告。
- **练习**：面试设置 → 对话界面 → 结束确认 → 示例复盘；题目收藏、闪卡翻面与掌握状态。
- **发现**：面经与岗位两栏、搜索筛选、详情和收藏。
- **我的**：个人资料、目标、记录、收藏、提醒、反馈和登录界面。
- **简历工作室**：PDF 本地选择、诊断 / 岗位优化 / 求职信示例。
- **优势探索**：20 道演示题、前后切换和本地结果展示。

这次交付是可点击的 UI 原型：数据均为示例，AI 对话、评分、登录、通知、反馈、能量和支付尚未接入服务。语音按钮只改变视觉状态，不录音。PDF 仅在本机选择，不上传；示例诊断不读取文件内容。岗位不是实时招聘信息。优势题目不是标准化测评。

收藏、昵称、目标和练习完成状态通过内存 Context 在页面间同步；重新加载后重置。设置中的提醒和频率仅展示交互，不创建通知或训练计划。

## 后续微调位置

| 内容 | 文件 |
| --- | --- |
| 颜色、品牌素材入口 | `src/theme.ts` |
| 按钮、卡片、表单、页面容器 | `src/components/ui.tsx` |
| 具体页面 | `src/screens/` |
| 路由和底部导航 | `src/app/` |
| 示例数据 | `src/data/demo.ts` |
| 预览共享状态 | `src/state.tsx` |

主题来自 `frontend/src/index.css` 当前 `.flowlab-app-shell`，壳仔素材来自 `frontend/public/brand/`。目前是独立原生组件与主题镜像，没有把 Web 的 DOM/CSS 组件直接搬进 App。资产为本地副本，Web 更新品牌素材时需同步；后续可抽出公共 design tokens 和 API 类型。

App 页面直接呈现功能与内容，不使用宣传标语或大幅营销横幅。壳仔作为页头图标、工具入口、头像和空状态插画，文案使用功能名称、状态和操作说明。

接入真实功能时，沿用现有后端 HTTP API 与实时面试接口；原生认证会话、安全存储、上传、音频和支付另做适配。不要把后端密钥放进 App。

## 验证命令

```sh
npm run typecheck
npm run lint
npx expo-doctor
npm run export:web
npm run export:native
```

导出到 `dist/web`、`dist/native`。原生导出验证 Metro / Hermes 打包，不代表已完成 Xcode/Gradle 编译或真机验证。移动端文件变更不会单独触发现有 Cloud Run 后端部署。
