# TTS 技术架构文档

## 目录

1. [系统概览](#1-系统概览)
2. [架构图](#2-架构图)
3. [后端实现](#3-后端实现)
4. [前端实现](#4-前端实现)
5. [分句策略](#5-分句策略)
6. [降级与容错](#6-降级与容错)
7. [API Key 轮换池](#7-api-key-轮换池)
8. [配置参考](#8-配置参考)
9. [性能指标](#9-性能指标)
10. [故障排查](#10-故障排查)

---

## 1. 系统概览

本系统采用**增量流式 TTS**方案，将面试官的文本回复实时转化为语音。核心设计原则：

- **流式并行**：LLM 生成文本与 TTS 合成音频并行执行，不等完整回复
- **边收边播**：前端通过 Web Audio API 逐块播放 PCM 音频流，无需等待完整文件
- **有序调度**：多句并行获取，但音频播放严格按文本顺序排列
- **多级降级**：Gemini 流式 → Gemini 非流式 → 浏览器内置语音
- **会话解耦**：TTS 端点无业务状态；文本/Live 面试使用 `interviewId` 在 Supabase 恢复和提交会话

### 技术栈

| 层级 | 技术 | 作用 |
|------|------|------|
| 后端 | Express + Node.js (ESM) | TTS 代理、SSE 文本流 |
| TTS API | Gemini `streamGenerateContent` | 流式音频生成 |
| 前端播放 | Web Audio API (`AudioContext`) | 低延迟 PCM 流式播放 |
| 降级播放 | `SpeechSynthesisUtterance` | 浏览器内置语音兜底 |

---

## 2. 架构图

### 数据流

```
用户发送消息
    │
    ▼
┌─────────────────────────┐
│  POST /api/chat/message  │  ← Express SSE
│  LangGraph 流式执行       │
└────────┬────────────────┘
         │ SSE: {type:"text", content:"..."}
         ▼
┌─────────────────────────┐
│  前端分句器               │  ← ChatInterface.jsx
│  按标点/长度切分文本块     │
└────────┬────────────────┘
         │ 每个句子独立发起 TTS
         ▼
┌─────────────────────────┐    ┌──────────────────────────┐
│  POST /api/chat/tts-stream│──►│ Gemini streamGenerateContent│
│  后端 TTS 代理            │◄──│ SSE 返回 base64 PCM chunks  │
└────────┬────────────────┘    └──────────────────────────┘
         │ Transfer-Encoding: chunked (原始 PCM bytes)
         ▼
┌─────────────────────────┐
│  useStreamingTTS hook    │
│  AudioContext 逐块调度    │
│  nextTimeRef 无缝拼接     │
└─────────────────────────┘
         │
         ▼
      🔊 播放
```

`POST /api/chat/message` 的业务请求必须携带 `interviewId` 和可重试复用的
`idempotencyKey`。LangGraph 使用该 `interviewId` 作为 `thread_id`，完整回复生成后将消息、
checkpoint 和兼容 transcript 原子提交。TTS 分句请求只接收待合成文本和语言，不读取或修改
面试状态，因此 TTS 降级或配额耗尽不会破坏已保存的面试进度。

Gemini Live 使用 WebSocket `/api/chat/live`；`start.config.interviewId` 必填。断线重连只加载
当前问题和该面试最近有限条消息，每个完成的语音回合仍写回相同的持久化会话。

### 降级链路

```
Level 1: /tts-stream (流式 PCM → AudioContext)
    │ 失败/429
    ▼
Level 2: /tts (完整 WAV → decodeAudioData → AudioContext)
    │ 失败/429
    ▼
Level 3: 浏览器 SpeechSynthesis (免费、无限制)
    │ 不支持
    ▼
Level 4: 静默跳过
```

---

## 3. 后端实现

### 文件位置

`backend/src/routes/chat.js`

### 3.1 流式端点：POST /api/chat/tts-stream

**请求体：**

```json
{
  "text": "Good morning, I'm Dr. Schmidt.",
  "language": "English"
}
```

**响应头：**

```
Content-Type: audio/pcm
X-Sample-Rate: 24000
Transfer-Encoding: chunked
```

**实现流程：**

1. 从 Key 轮换池获取可用的 API Key
2. 构建 Gemini TTS 请求体（根据模型名自动选择 camelCase/snake_case）
3. 调用 `streamGenerateContent?alt=sse`
4. 逐行解析 Gemini 的 SSE 响应
5. 提取 `inlineData.data`（base64 PCM），解码后直接 `res.write()` 给前端
6. 首个 chunk 到达时才发送响应头（延迟发送以检测采样率）

**关键参数：**

| 参数 | 值 | 说明 |
|------|-----|------|
| 模型 | `gemini-2.5-flash-preview-tts` | 默认值，可通过 `GEMINI_TTS_MODEL` 覆盖 |
| 采样率 | 24000 Hz | 从 MIME type 中检测，默认 24kHz |
| 声道数 | 1（单声道） | Gemini TTS 固定输出 |
| 位深度 | 16-bit | PCM signed int16 little-endian |

### 3.2 非流式端点：POST /api/chat/tts

作为流式端点的降级方案，行为与流式版类似但：

- 使用 `generateContent`（非流式）
- 等待完整音频生成后一次性返回
- 将 PCM 封装为 WAV 格式（44 字节 RIFF 头 + PCM 数据）
- 返回 `Content-Type: audio/wav`

### 3.3 PCM 转 WAV 封装

`pcmToWav(pcmBase64, sampleRate)` 函数将 Gemini 返回的 base64 PCM 数据封装为标准 WAV：

```
偏移  长度  内容
0     4    "RIFF"
4     4    文件大小 - 8
8     4    "WAVE"
12    4    "fmt "
16    4    16 (PCM 格式块大小)
20    2    1 (PCM 编码)
22    2    1 (单声道)
24    4    24000 (采样率)
28    4    48000 (字节率)
32    2    2 (块对齐)
34    2    16 (位深度)
36    4    "data"
40    4    PCM 数据长度
44    ...  PCM 数据
```

### 3.4 语音配置

```javascript
const TTS_VOICES = {
  English: process.env.GEMINI_TTS_VOICE_EN || 'Sulafat',  // Warm 风格
  Deutsch: process.env.GEMINI_TTS_VOICE_DE || 'Despina',  // Smooth 风格
}
```

---

## 4. 前端实现

### 文件位置

`frontend/src/components/ChatInterface.jsx`

### 4.1 useStreamingTTS Hook

核心 Hook，管理整个 TTS 生命周期。

**API：**

```javascript
const { enqueue, stop, speaking } = useStreamingTTS(language, ttsEnabled)
```

| 方法/属性 | 类型 | 说明 |
|-----------|------|------|
| `enqueue(text, authToken)` | `async function` | 将文本加入 TTS 队列 |
| `stop()` | `function` | 立即停止所有播放和待处理请求 |
| `speaking` | `boolean` | 是否正在播放语音 |

**内部状态：**

| Ref | 类型 | 说明 |
|-----|------|------|
| `ctxRef` | `AudioContext` | Web Audio 上下文（懒初始化） |
| `playGenRef` | `number` | 代际计数器，`stop()` 时递增以废弃旧请求 |
| `nextTimeRef` | `number` | AudioContext 时间轴指针，实现无缝拼接 |
| `activeSourcesRef` | `Set<AudioBufferSourceNode>` | 当前活跃的音频源节点 |
| `pendingRef` | `number` | 正在处理的 enqueue 调用数 |
| `scheduleChainRef` | `Promise` | 有序调度链 |
| `quotaExhaustedRef` | `boolean` | 配额耗尽标记 |

### 4.2 流式 PCM 播放

`scheduleChunk(ctx, int16Array, gen)` 负责将 PCM 数据调度到 AudioContext：

```
Int16 PCM → Float32 归一化 (÷32768) → AudioBuffer → AudioBufferSourceNode.start(nextTime)
```

**关键常量：**

| 常量 | 值 | 说明 |
|------|-----|------|
| `TTS_SAMPLE_RATE` | 24000 | 采样率，与 Gemini 输出匹配 |
| `TTS_MIN_CHUNK_BYTES` | 4800 | 最小播放块（~100ms 音频） |

### 4.3 有序调度机制

解决多句并行 fetch 导致的播放乱序问题：

```
enqueue("句子1")                    enqueue("句子2")
│                                  │
├─ 抢占 slot (waitPrev=resolved)   ├─ 抢占 slot (waitPrev=slot1)
├─ fetch /tts-stream ──────►       ├─ fetch /tts-stream ──────► (并行)
│  (网络慢)                         │  (网络快，数据先到)
│                                  │
│                                  ├─ await waitPrev (阻塞，等 slot1)
├─ await waitPrev (已 resolved)    │
├─ scheduleChunk → 播放句子1       │
├─ resolveSlot() ───────────────►  │
│                                  ├─ waitPrev resolved!
│                                  ├─ scheduleChunk → 播放句子2
│                                  ├─ resolveSlot()
```

**要点：**
- `scheduleChainRef` 是一个 Promise 链，每个 `enqueue` 调用占据一个 slot
- fetch 并行发出（最大化吞吐），但 `scheduleChunk` 的调用严格按入队顺序串行
- `stop()` 重置链为 `Promise.resolve()`，避免旧请求阻塞新请求
- `resolveSlot()` 在 `finally` 中调用，确保异常时也不会死锁

### 4.4 浏览器 SpeechSynthesis 兜底

`speakWithBrowserTTS(text, gen)` 在 Gemini 完全不可用时启用：

- 使用 `SpeechSynthesisUtterance` API
- 自动设置语言：`en-US` / `de-DE`
- 语速 1.05x（略快于默认，更接近自然对话节奏）
- 通过 `gen` 检查实现取消支持

---

## 5. 分句策略

### 文件位置

`frontend/src/components/ChatInterface.jsx` — `runGraph` 函数内的 SSE 解析循环

### 分句规则（按优先级）

| 优先级 | 条件 | 切分点 | 说明 |
|--------|------|--------|------|
| 1 | 句末标点 `.!?。！？\n` 且缓冲 ≥ 15 字符 | 标点后 | 自然句子边界 |
| 2 | 首句未发送 且 ≥ 40 字符 | 最近的标点 | 快速开始第一段语音 |
| 3 | 首句未发送 且 ≥ 60 字符无标点 | 最近的空格 | 强制首句 |
| 4 | 逗号/分号 且 ≥ 100 字符 | 逗号/分号后 | 长句中间切分 |
| 5 | 缓冲 ≥ 150 字符 | 最近的空格或末尾 | 强制切分 |

### 示例

输入：*"Good morning, Linhan. I'm Dr. Schmidt, a Senior Group Member here, and I'm very pleased to meet you today. Please tell us a bit about yourself."*

切分结果（3 个 TTS 请求）：

1. `"Good morning, Linhan."` — 22 字符，句号 ≥ 15 ✓
2. `" I'm Dr. Schmidt, a Senior Group Member here, and I'm very pleased to meet you today."` — 句号
3. `" Please tell us a bit about yourself."` — SSE done 时 flush

### 特殊处理

- **feedback 类型跳过**：`lastAgentName === 'feedback'` 时不触发 TTS
- **方括号清理**：`sanitizeSquareBrackets()` 移除模型输出中的 `[Company Name]` 等占位符
- **SSE 结束时 flush**：`evt.type === 'done'` 时将剩余缓冲区全部发送

---

## 6. 降级与容错

### 6.1 四级降级链

```
┌──────────────────────────────────────────────────┐
│ Level 1: /tts-stream (流式 PCM + AudioContext)     │
│ 延迟最低，边生成边播放                               │
│ 失败条件：429 / 网络错误 / 非 200 响应               │
├──────────────────────────────────────────────────┤
│ Level 2: /tts (完整 WAV + decodeAudioData)         │
│ 延迟中等，需等整段音频生成完                          │
│ 失败条件：429 / 网络错误 / 非 200 响应               │
├──────────────────────────────────────────────────┤
│ Level 3: 浏览器 SpeechSynthesis                    │
│ 免费无限制，音质一般（机器人感）                      │
│ 失败条件：浏览器不支持                               │
├──────────────────────────────────────────────────┤
│ Level 4: 静默跳过                                  │
│ 文字仍然显示，只是没有语音                            │
└──────────────────────────────────────────────────┘
```

### 6.2 配额感知

- `quotaExhaustedRef`：首次收到 HTTP 429 后设为 `true`
- 后续所有 `enqueue` 调用直接跳过 Gemini，走 Level 3
- **重置方式**：刷新页面 / 重新进入面试（组件重新挂载）

### 6.3 代际取消

- `playGenRef` 是一个递增计数器
- 每次调用 `stop()` 时递增，所有持有旧 `gen` 值的异步操作检测到不匹配后立即终止
- 包括：fetch 请求、ReadableStream 读取、AudioBuffer 调度

---

## 7. API Key 轮换池

### 文件位置

`backend/src/routes/chat.js` — `ttsKeyPool` 模块

### 设计

```javascript
ttsKeyPool = {
  next()            → 返回下一个可用 Key，全部耗尽返回 null
  markExhausted(key) → 标记该 Key 冷却 1 小时
  anyAvailable()    → 是否还有可用 Key
  size              → Key 总数
}
```

### 轮换逻辑

1. 从 `GEMINI_TTS_KEYS` 解析逗号分隔的 Key 列表
2. 未设置时回退到 `GEMINI_API_KEY`
3. Round-robin 轮询，跳过冷却中的 Key
4. 收到 429 时标记该 Key 冷却 1 小时（`TTS_KEY_COOLDOWN_MS`）
5. 所有 Key 耗尽 → 返回 HTTP 429 → 前端降级到浏览器语音

### 配额计算

```
N 个 Key × 100 次/天 (flash) = N × 100 次/天 总配额
```

| Key 数量 | 日配额 | 可支撑面试场次 |
|----------|--------|---------------|
| 1 | 100 | ~1-2 场 |
| 3 | 300 | ~4-5 场 |
| 5 | 500 | ~7-8 场 |
| 付费 | 无限 | 无限 |

---

## 8. 配置参考

### .env 变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `GEMINI_API_KEY` | 是 | — | 主 API Key（LLM + TTS 回退） |
| `GEMINI_TTS_KEYS` | 否 | 回退到 `GEMINI_API_KEY` | TTS 专用 Key 池，逗号分隔 |
| `GEMINI_TTS_MODEL` | 否 | `gemini-2.5-flash-preview-tts` | TTS 模型 |
| `GEMINI_TTS_VOICE_EN` | 否 | `Sulafat` | 英语音色 |
| `GEMINI_TTS_VOICE_DE` | 否 | `Despina` | 德语音色 |

### .env 示例

```env
GEMINI_API_KEY=AIzaSy...主Key
GEMINI_TTS_KEYS=AIzaSy...Key1,AIzaSy...Key2,AIzaSy...Key3
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
```

### 模型配额对比

| 模型 | 免费日配额 | 延迟 | 音质 |
|------|-----------|------|------|
| `gemini-2.5-flash-preview-tts` | 100 次/天/Key | 低 | 好 |
| `gemini-2.5-pro-preview-tts` | 50 次/天/Key | 中 | 更好 |

---

## 9. 性能指标

### 延迟目标

| 指标 | 目标值 | 实现方式 |
|------|--------|----------|
| First Audio Byte | 200-500ms | 流式 TTS + 首句 40 字符即发 |
| 句间间隙 | ~0ms | AudioContext `nextTimeRef` 无缝调度 |
| 用户感知延迟 | < 1s | LLM 流式 token 与 TTS 并行 |

### 音频参数

| 参数 | 值 |
|------|-----|
| 采样率 | 24000 Hz |
| 位深度 | 16-bit signed PCM |
| 声道数 | 1（单声道） |
| 最小播放块 | 4800 bytes (~100ms) |
| 字节率 | 48000 bytes/sec |

---

## 10. 故障排查

### 问题：语音完全没有

1. 检查 `GEMINI_API_KEY` 或 `GEMINI_TTS_KEYS` 是否配置
2. 检查 `GEMINI_TTS_MODEL` 是否拼写正确
3. 查看后端控制台是否有 `[TTS]` 或 `[TTS-stream]` 错误日志
4. 确认前端 TTS 开关已开启（音量图标）

### 问题：语音是机器人声音（浏览器 TTS）

1. Gemini 配额耗尽 → 查看后端日志是否有 429 错误
2. 解决：添加更多 API Key 或升级付费计划
3. 重新进入面试页面（重置 `quotaExhaustedRef`）

### 问题：语音顺序错乱

- 已通过 `scheduleChainRef` Promise 链修复
- 如果仍有问题，检查是否有多个 `useStreamingTTS` 实例

### 问题：语音播放有明显间隙

1. 检查网络延迟（TTS API 响应时间）
2. 可以减小 `TTS_MIN_CHUNK_BYTES`（当前 4800，可降到 2400）
3. 确认 `AudioContext` 未处于 `suspended` 状态

### 问题：429 Too Many Requests

```
Quota exceeded for metric: generate_requests_per_model_per_day
```

- 免费配额：flash = 100 次/天/Key，pro = 50 次/天/Key
- 解决方案（按优先级）：
  1. 添加更多 Key（不同 Google Cloud Project）
  2. 切换到 flash 模型（配额翻倍）
  3. 升级 Google AI Studio 付费计划
