# agent与Prompt

> 状态：**兼容通道，当前前端未启用** · 最后核对：2026-10-03 · 产品说明：[模拟面试](../../01-产品/功能说明/模拟面试.md)

> **重要**：本文描述的 LangGraph 面试图和 `backend/data/prompts/` 下的模板（`motivation_letter.md` 除外）只在 SSE 文本通道 `POST /api/chat/message` 中运行。当前前端所有面试都走 Gemini Live（`ChatInterface` 的 `digitalHuman` 恒为真），**不会执行这里的节点和 Prompt**。当前实际使用的 Prompt 在代码中内联：
>
> | 场景 | Prompt 位置 |
> |---|---|
> | 正式模拟（Gemini Live） | `backend/src/live/interviewLiveSocket.js` 的 `buildSystemInstruction`，叠加 `config/interviewerTypes.js` 的类型指令 |
> | 练习的出题、反馈、提示 | `backend/src/lib/interviewLearning.js` 中传给 `invokeGemini` 的内联 Prompt |
> | 面试报告 | `backend/src/routes/interviews.js` 的 `REPORT_JSON_SYSTEM`，见[面试报告](../面试报告.md) |
> | 求职信 | `backend/data/prompts/motivation_letter.md`，见[简历优化](../简历优化.md) |
>
> 两条通道共用的部分：题量计算 `agents/utils.js` 的 `getMaxQuestions` / `getPracticeCoreQuestions`，以及面试官类型策略 `config/interviewerTypes.js`。

## 文档职责边界

本文只负责 **Agent 内部实现**：LangGraph 状态、节点、条件路由、Prompt、知识库检索、难度指令、
题目计划和 LLM 配置。它会说明 Agent 与持久化/传输层的接口，但不承载完整的面试产品流程。

面试创建、练习/正式状态机、数据库表、REST/WebSocket 协议、计时与截止宽限、幂等并发、报告生成、
故障恢复和可观测性统一记录在 [面试流程](面试流程.md)。修改功能时应先判断
归属，避免把所有后端业务内容继续堆入本文。

例外是[第 2 节](#2-agent-总体结构与运行保障)：它从 Agent 的角度概括**全部 AI 通道**（不只是 LangGraph）
如何被驱动、如何落库、出错后如何回滚，方便读者一次看清。其中涉及的状态机、表结构和 API 细节仍以
[面试流程](面试流程.md)为准，两处不一致时以代码和面试流程为准。

## 目录

1. [系统概览](#1-系统概览)
2. [Agent 总体结构与运行保障](#2-agent-总体结构与运行保障)：结构图、Harness、持久化、错误回滚
3. [LangGraph 架构图](#3-langgraph-架构图)
4. [LangGraph 状态定义](#4-langgraph-状态定义)
5. [节点详解](#5-节点详解)
6. [路由逻辑](#6-路由逻辑)
7. [面试计划生成](#7-面试计划生成)
8. [Prompt 模板体系](#8-prompt-模板体系)
9. [知识库](#9-知识库)
10. [Agent 会话接入](#10-agent-会话接入)
11. [SSE 流式通信](#11-sse-流式通信)
12. [LLM 配置](#12-llm-配置)
13. [辅助 Agent：动机信生成](#13-辅助-agent动机信生成)
14. [LangGraph 执行流程示例](#14-langgraph-执行流程示例)
15. [配置参考](#15-配置参考)

---

## 1. 系统概览

本文描述的文本面试 Agent 基于 **LangGraph** 构建，用于模拟真实的德国公司面试流程。正式语音主链路
由 Gemini Live 直接对话，练习主链路由 REST 状态机显式推进；它们不会在每一个 Live turn 中重新执行
LangGraph。三条通道的完整关系见 [面试流程](面试流程.md)。Agent 内部的核心设计原则：

- **多角色协作**：分析器（内部推理）、开场、经历深挖、技术、行为、反馈共 6 个角色
- **有状态图执行**：在 SSE 文本链路中，每轮用户消息触发一次图遍历，产生一个面试官回复
- **动态路由**：根据面试进度计划（plan）自动选择下一个提问类型
- **流式输出**：通过 SSE 将 LLM token 实时推送到前端
- **持久化隔离**：所有恢复和提交都以 `interviewId` 为边界，服务重启或扩容不会丢失业务状态
- **模式与难度指令**：Agent 消费已持久化模式和难度配置；业务状态转换由面试流程层负责

### 技术栈

| 层级 | 技术 | 作用 |
|------|------|------|
| 图引擎 | `@langchain/langgraph` (StateGraph) | 有状态多节点图 |
| LLM | `@langchain/google-genai` (Gemini，模型可配置) | 文本生成和答案分析 |
| 提示词 | Markdown 模板 + `{{变量}}` 渲染 | 角色指令 |
| 知识库 | JSON + Supabase `interview_experiences` | 技术领域、行为胜任力、企业面经 RAG |
| 会话存储 | Supabase PostgreSQL（按 `interviewId`） | checkpoint、消息、题目、尝试和证据 |
| 通信 | Server-Sent Events (SSE) | LangGraph 文本回复的实时流式推送 |

### 文件清单

| 文件路径 | 作用 |
|----------|------|
| `src/agents/interviewGraph.js` | 图定义、节点、答案质量分析和难度指令 |
| `src/agents/utils.js` | Prompt、知识库和面试计划工具；不保存 Session |
| `src/config/interviewerTypes.js` | HR、Technical、Mixed 的题型、Persona 与报告策略唯一来源 |
| `src/lib/interviewSessionStore.js` | 面试恢复、请求认领、乐观锁和原子提交 |
| `src/lib/interviewLearning.js` | 难度策略、RAG、能力矩阵、评分证据和进步汇总 |
| `src/routes/chat.js` | 持久化 SSE 文本面试及 TTS API |
| `src/routes/interviewSessions.js` | 练习/正式动作状态机 API |
| `src/live/interviewLiveSocket.js` | Gemini Live 语音连接和有限上下文恢复 |
| `backend/data/prompts/*.md` | 各角色的 Prompt 模板 |
| `backend/data/knowledge_base/*.json` | 技术领域和行为胜任力基础库 |

---

## 2. Agent 总体结构与运行保障

本节回答三个问题：模型是**怎么被驱动和约束**的（Harness）、状态**怎么保存**（持久化）、出错时**怎么保证不留下半截状态**（错误回滚）。
一句话概括：**Agent 本身不保存任何状态；每一轮都从数据库读出状态 → 调用模型 → 校验输出 → 在一个数据库事务里一次性写回。**
模型调用全部发生在写库之前，所以模型失败、超时或进程崩溃都不会留下写了一半的面试。

### 2.1 Agent 结构图

```mermaid
flowchart TB
    subgraph FE["① 前端 · 面试房间"]
        LiveUI["语音面试<br/>正式对话 / 练习读题"]
        PracticeUI["练习面板<br/>出题 · 作答 · 提示 · 重答"]
        ReportUI["结束面试 / 报告页"]
    end

    subgraph HN["② 接入层 · Harness：鉴权 · 业务规则 · 输出闸门 · 幂等认领"]
        WS["WebSocket /api/chat/live<br/>interviewLiveSocket.js"]
        REST["REST /api/interview-sessions/*<br/>interviewSessions.js"]
        SSE["SSE /api/chat/message<br/>chat.js · 兼容通道"]
        FIN["POST /api/interviews/:id/finalize<br/>interviews.js"]
    end

    subgraph AG["③ Agent"]
        Interviewer["面试官 Agent<br/>Gemini Live 实时语音"]
        Planner["出题 Agent"]
        Coach["教练 Agent"]
        Hint["提示 Agent"]
        Graph["LangGraph 面试图<br/>未启用"]
        Reporter["报告 Agent"]
    end

    subgraph MD["④ 模型调用"]
        LiveAPI["Gemini Live API<br/>gemini-3.1-flash-live-preview"]
        Invoke["invokeGemini<br/>超时 · 配额降级 · 去 JSON 围栏"]
        LC["LangChain LLM 实例<br/>见第 12 节"]
    end

    subgraph ST["⑤ 会话存储层 · interviewSessionStore.js / interviewLearning.js"]
        Claim["claim / release<br/>幂等认领"]
        Commit["commit_interview_turn<br/>apply_interview_action<br/>乐观锁 + 单事务提交"]
        FinLock["claim_interview_finalize<br/>报告生成锁"]
    end

    DB[("⑥ Supabase PostgreSQL<br/>interviews · interview_messages · questions / attempts / hints / notes<br/>interview_requests · interview_events")]

    LiveUI <--> WS
    PracticeUI --> REST
    ReportUI --> FIN

    WS <--> Interviewer
    REST --> Planner
    REST --> Coach
    REST --> Hint
    SSE --> Graph
    FIN --> Reporter

    Interviewer <--> LiveAPI
    Planner --> Invoke
    Coach --> Invoke
    Hint --> Invoke
    Reporter --> Invoke
    Graph --> LC

    MD == "模型结果返回接入层后才写库" ==> ST
    Claim --> Commit
    ST --> DB
```

| Agent | 所在通道 | 当前是否在用 | 职责 | 代码 |
|---|---|---|---|---|
| 面试官 Agent | WebSocket | ✅ 所有面试 | 正式模式：自主提问与追问；练习模式：只在收到控制指令时朗读题目 | `live/interviewLiveSocket.js` 的 `buildSystemInstruction` |
| 出题 Agent | REST | ✅ 练习模式 | 按路线阶段（opening / explore / technical / behavioral）生成下一题 | `lib/interviewLearning.js` |
| 教练 Agent | REST | ✅ 练习模式，以及自适应难度的正式面试 | 对一次作答打分、给证据和改进点，顺带预生成 4 级提示 | 同上 |
| 提示 Agent | REST | ✅ 练习模式 | 逐级发放提示：方向 → 结构 → 要点 → 参考答案 | 同上 |
| LangGraph 面试图 | SSE | ⚠️ 兼容通道，前端未启用 | 见第 3–9 节 | `agents/interviewGraph.js` |
| 报告 Agent | REST | ✅ 所有面试结束时 | 根据完整对话生成五维评分与逐题复盘 | `routes/interviews.js`，见[面试报告](../面试报告.md) |

练习模式同时用两条通道：**状态推进走 REST**（出题、作答、提示、重答、掌握、跳过），**朗读题目走 WebSocket**——前端把题目包成
`[PRACTICE_CONTROL] Read this question exactly once…` 发给面试官 Agent，让它只读题、不自由发挥（见 2.2 的输出闸门）。

### 2.2 Harness：怎么驱动和约束模型

这里的 Harness 指包在模型外面的那层代码：负责**组装输入、限制行为、校验输出、处理超时和降级**。模型只负责"想"，什么能被用户看到、什么能写进数据库，全部由 Harness 决定。

#### 公共调用层 `invokeGemini`（`lib/geminiText.js`）

出题、教练、提示、报告四个 Agent 都经过它：

| 机制 | 行为 |
|---|---|
| 运行环境 | 配了 `GEMINI_API_KEY` 走 Google AI Studio，否则走 Vertex AI（`GCP_PROJECT_ID` / `GCP_LOCATION`） |
| 超时 | 默认 45 秒，可按调用传 `timeoutMs`；超时抛出 `GEMINI_TIMEOUT`。超时只是不再等待结果，底层请求不会被取消，迟到的结果会被丢弃——因为写库在模型调用之后，这不会造成脏数据 |
| 配额降级 | 只有主模型是 `gemini-3.7-flash` 且错误被识别为配额耗尽（429 / gRPC 8 / `RESOURCE_EXHAUSTED` / quota、rate limit 字样）时，才用 `GEMINI_FALLBACK_MODEL`（默认 `gemini-3.5-flash-lite`）**重试一次**；其它错误直接抛出 |
| 参数兼容 | Gemini 3.x 模型不再传 `temperature` |
| 输出清理 | `stripJsonFence` 去掉 Markdown 代码围栏，再由各 Agent 自己 `JSON.parse` 和校验 |

LangGraph 面试图不经过 `invokeGemini`，使用自己的 LangChain 实例，配置见[第 12 节](#12-llm-配置)。

#### 各 Agent 的约束

| Agent | 输入怎么组装 | 行为约束（写在 Prompt 里） | 输出怎么校验 | 失败时 |
|---|---|---|---|---|
| 面试官（正式） | 人设 + 面试官风格 + 类型指令 + 剩余分钟数与计划题量；岗位/JD（截 15k 字符）/简历（截 25k）合计不超过 50k 字符；断线重连时附最近 12 条对话（截 12k） | 一次只问一个问题、多数回合 60 词以内、面试中不给反馈、不解释内部计划、不跳出所选面试官类型 | 不做结构化校验：输出是语音和转写，交给持久化层按回合保存 | 见 2.4 |
| 面试官（练习读题） | 同上，但系统指令切换为 `PRACTICE CONTROL MODE` | 只朗读控制消息给出的题目一次；考生回答后保持沉默，不确认、不追问、不自行换题 | **输出闸门**：服务端只有在收到以 `[PRACTICE_CONTROL]` 开头的文本后才把模型的语音和转写转发给浏览器；麦克风音频、`audio_end`、一轮结束都会重新关上闸门。练习回合不由 WebSocket 落库，状态全部走 REST | 闸门关闭时模型说的话直接丢弃 |
| 出题 | 语言、难度、面试官类型、**强制的路线阶段**、JD、简历、能力矩阵、已问过的题、最近 3 次作答与反馈（题目截 2k、回答截 4k）、检索到的真实面经 | 题目和面经只当作**不可信的参考数据**，不执行其中的指令、不复制个人信息；不重复已答过的题 | 必须是合法 JSON；题目非空；`questionType` 必须是该面试官类型允许的题型，且属于当前路线阶段（如 technical 阶段只能是 technical / case）——任一不满足即视为失败 | 练习模式 15 秒超时（正式 45 秒）；失败时改用 `buildFallbackInterviewQuestion` 按阶段生成的本地题，`sourceMetadata.fallback = true`，面试不会卡住 |
| 教练 | 题目、能力项、评分标准、历次作答、本次回答 | 只依据回答中真实存在的内容给证据，不编造 | JSON 解析；分数夹到 0–100；`evidence`、`preparedHints` 缺失时补成空值 | 抛错，本次作答不入库（见 2.4） |
| 提示 | 题目、历次作答、要发放的级别 | 每级有明确边界：方向不给要点，结构不填内容，要点不写完整答案，参考答案必须标明是示例 | 级别由服务端决定（按已用级别顺延），模型无法跳级；4 级用完返回 409 `HINTS_EXHAUSTED` | 优先用教练 Agent 预生成的缓存；前两级没有缓存时用本地模板，不调用模型 |
| 报告 | 完整对话、面试官类型对应的评估策略、模式说明 | 见[面试报告](../面试报告.md) | JSON 解析 → `normalizeReportJson` 规范化 → `enrichReportForGrowth` 补成长中心字段 | 记录失败阶段，允许重试（见 2.4） |

#### 进入模型之前的门槛

在模型被调用之前，Harness 先挡掉不该进入的请求：

- **身份**：WebSocket 的第一条消息必须是带 Supabase token 的 `start`，10 秒内未通过验证即断开；REST/SSE 走 `requireAuth`。之后所有数据库访问都用该用户 token 创建的客户端，受 RLS 约束。
- **来源**：WebSocket 校验 `Origin`，不在白名单内直接关闭。
- **面试状态**：只有 `active` / `draft` 的面试能继续；每次加载都先执行 `expire_formal_interview_if_due`，正式面试到点后由服务端（不是模型）结束。
- **业务规则**：练习题量上限、"先解决当前题再出下一题"、"重答前必须先申请重答"、正式模式不给提示和中间反馈等规则，都在路由层判断，不依赖模型自觉。
- **配置来源**：语言、模式、难度、面试官类型一律从数据库里的面试记录读取，客户端在请求里传的配置会被覆盖，模型拿不到被篡改的配置。

### 2.3 持久化：状态怎么保存

**PostgreSQL 是唯一的事实来源。** 后端实例不在内存里保留任何面试状态；LangGraph 编译时也没有挂 checkpointer，
`thread_id: interviewId` 只是标签，每一轮的初始状态都从 `interviews.graph_state_json` 读出来。所以服务重启、Cloud Run 扩容到多实例、请求落到另一台机器，都不影响面试进度。各张表的用途见[第 10 节](#10-agent-会话接入)。

#### 两个保护机制

| 机制 | 解决什么问题 | 怎么实现 |
|---|---|---|
| **幂等键** `idempotencyKey` | 网络重试、用户连点、断线重发不会生成两道题、两次作答或扣两次能量 | 每个写请求带一个键。`claim_interview_request` 先在 `interview_requests` 插入一条 `{"pending":true}`：插入成功 → `claimed`，继续执行；已有 pending → 返回"正在处理"（409）；已完成 → 直接**重放**当时保存的响应，不再调用模型 |
| **乐观锁** `state_version` | 两个标签页、两个实例同时基于旧状态提交时，后来者不能覆盖新状态 | 读取时拿到当前版本，提交时作为 `expectedVersion` 传回。RPC 先 `SELECT … FOR UPDATE` 锁住面试行，版本不一致就返回 `{conflict: true, currentVersion}`，**不改动任何业务数据** |

#### 写库的四个原语

| RPC | 用在哪里 | 一个事务里做什么 |
|---|---|---|
| `claim_interview_request` | 所有写请求的第一步 | 登记 pending；超过 2 分钟仍 pending 的认领视为进程已崩溃，可被同一个键重新认领（返回 `recovered`） |
| `commit_interview_turn` | 一轮对话（SSE、Live） | 校验版本 → 追加 `interview_messages` → 更新 checkpoint、`transcript_json`、题号、状态 → `state_version + 1` → 把响应写入 `interview_requests` 供重放 |
| `apply_interview_action` | 题目级动作：出题、作答、提示、笔记、暂停/继续、重答、掌握、跳过、重连 | 校验版本和状态 → 写对应的题目/作答/提示/笔记/能力证据 → `state_version + 1` → 写 `interview_events` 审计记录 → 保存响应 |
| `release_interview_request` | 出错时 | **只删除 pending 的认领**，已完成的记录不会被删，所以重放永远可用 |

另外两个独立的"认领"也遵循同样思路：`create_interview_session` 把检查余额、扣 300 能量、创建面试和初始 checkpoint 放在同一个事务里，同一个键重试只会重放、不会重复扣费；`claim_interview_finalize` 用 `finalize_status = 'processing'` 加 2 分钟锁，保证同一场面试只有一个报告生成请求在跑。

#### 一轮对话的落库时序

以 SSE 通道为例（Live 通道的顺序相同，只是由 Gemini 的 `turnComplete` 事件触发）：

```mermaid
sequenceDiagram
    autonumber
    participant C as 前端
    participant R as 路由（Harness）
    participant S as 会话存储层
    participant M as 模型
    participant DB as PostgreSQL

    C->>R: 用户回答 + interviewId + idempotencyKey
    R->>S: claim(key)
    S->>DB: 插入 pending
    alt 已完成
        DB-->>R: 保存过的响应
        R-->>C: 重放，不调用模型
    else 正在处理
        R-->>C: 409
    else claimed
        R->>S: 读取 checkpoint、消息、state_version = v
        R->>M: 调用模型
        M-->>R: 面试官回复
        R->>S: commit(expectedVersion = v)
        S->>DB: 单事务：消息 + checkpoint + transcript + 版本 v+1 + 响应
        R->>S: apply_interview_action(key:question)
        S->>DB: 把回复登记为新题目，版本 v+2
        R-->>C: 流式返回回复
    end
```

一轮里如果有多个写步骤，就从主键派生出子键，让每一步都能单独幂等：

| 子键 | 写什么 | 用在 |
|---|---|---|
| `<key>:answer` | 正式模式下考生对当前题的作答，**先于模型调用保存** | SSE、Live |
| `<key>` | 本轮对话（消息 + checkpoint） | SSE、Live（Live 的主键是服务端生成的 `live-<uuid>`） |
| `<key>:question` | 把面试官这轮说的话登记成下一道题 | SSE、Live |
| `<key>:deadline-answer` | 正式面试过了截止时间后的最后一次作答，随后直接进入结束流程 | Live |

Live 通道还用一条串行的 Promise 链（`persistChain`）保证同一连接里的回合按顺序落库，后一轮不会抢在前一轮之前提交。

### 2.4 错误回滚：出错后怎么办

核心原则是**先算后写、一次提交**，所以大多数情况下根本不需要"回滚"：

1. 模型调用都在写库之前完成。模型失败 = 事务从未开始，数据库保持上一轮的样子。
2. 每次写库都是一个数据库事务，要么全部写入，要么全部不写，不存在"消息写了、checkpoint 没写"。
3. 出错后唯一要清理的是幂等认领：`release_interview_request` 删掉 pending 记录，让同一个键可以重新执行。
4. 客户端拿到 409 时重新加载面试状态，再用新的版本号重试。

#### 各类故障的处理

| 故障 | 服务端怎么处理 | 数据库最终状态 | 怎么恢复 |
|---|---|---|---|
| 练习出题模型超时或返回不合规 | 改用本地备用题，照常提交 | 新题目已写入，标记 `fallback` | 无需处理 |
| 教练/提示模型失败 | 释放认领，返回 500 | 本次作答或提示未写入 | 用户再提交一次 |
| SSE 一轮中模型失败 | 释放认领；还没发 SSE 头就返回 JSON 错误，已经开始流式输出就发 `{type:'error'}` | 停在上一轮，没有半轮 checkpoint | 前端重发 |
| 版本冲突（多标签页、多实例） | RPC 不改动业务数据，返回 `conflict`；路由释放认领，返回 409 + `currentVersion`（SSE 中为 `SESSION_CONFLICT`） | 保持对方提交后的新状态 | 重新加载后重试 |
| 重复请求 | 同键 pending → 409；同键已完成 → 重放原响应 | 不重复写入 | 无需处理 |
| 进程在认领后、提交前崩溃 | 无人释放认领 | pending 残留，业务数据未变 | 2 分钟后同一个键可以重新认领（`recovered`） |
| 主轮已提交，`:question` 子步骤失败 | 主轮保留；SSE 重试时重放分支会用同一个 `:question` 键补做这一步 | 对话已保存，题目登记在重试时补齐 | 用同一个键重试 |
| 状态已提交，后续非事务步骤失败（如练习题同步到收藏夹） | 返回 500，但认领已是"完成"状态，释放不会删掉它 | 作答已保存 | 用同一个键重试会直接拿到重放结果 |
| Live 回合持久化失败 | 释放 `<key>`、`<key>:answer`、`<key>:question` 三个认领，向浏览器发送通用错误 `Interview state could not be saved` | 停在最后一次成功提交的回合；这一轮语音已经播出但没有保存 | 重连后从数据库恢复 |
| Live 断线或 Gemini 连接关闭 | Gemini 会话是临时资源，直接丢弃 | 不受影响 | 新连接重新读取 checkpoint 和最近 12 条对话，系统指令提示模型"接着上次继续，不要重复问候和旧题" |
| 正式面试到达截止时间 | 每次加载先执行 `expire_formal_interview_if_due`；当前题允许按宽限规则完成一次 | 进入 `finalizing` | 前端进入报告生成，见[面试流程 · 正式计时](面试流程.md#8-正式计时与最后一题宽限) |
| 报告生成失败 | `finalize_status = 'failed'`，记录失败阶段和错误摘要；模型、解析、保存三个阶段返回 `retryable: true` | 面试记录与对话完整保留，报告为空 | 重新点击生成；已成功的报告默认直接复用，只有主动要求重新生成才会覆盖 |
| 余额不足 | 创建事务内检查，返回 403 `INSUFFICIENT_TOKENS` | 不创建面试，不扣费 | 充值后重试 |

#### 有意不回滚的内容

- **正式模式的考生作答**：在调用模型之前就用 `:answer` 子键保存。即使面试官回复生成失败，考生已经说出的回答也不会丢，重试时子键保证不会存两次。
- **`interview_events` 审计记录与 `live_turn_timing` 等观测事件**：用于事后排查，失败的尝试也会留下记录。

#### 目前做不到的

- **没有"回退到某个版本"的功能。** `graph_state_json` 每轮被覆盖，不保存历史快照；需要追查时只能从 `interview_messages`（按序号保存的完整对话）和 `interview_events` 还原过程。
- **Live 语音已播出但未保存的回合**无法补救：模型的声音已经到达用户，而数据库停在上一轮。重连后模型看到的是上一轮之前的对话。
- **能量扣除后面试中途失败不会自动退款**，扣费只保证"同一次创建不重复扣"。

更完整的失败与降级清单见[面试流程 · 失败与降级](面试流程.md#18-失败与降级)，幂等和事务边界的定义见[面试流程 · 一致性、幂等与并发](面试流程.md#12-一致性幂等与并发)。

---

## 3. LangGraph 架构图

### 面试图结构

```
                        ┌─────────────────┐
               START ──►│   route_turn    │
                        └───────┬─────────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
            phase=opening   otherwise    planIndex≥len
                 │              │              │
                 ▼              ▼              ▼
        ┌────────────┐  ┌──────────────┐  ┌──────────────┐
        │  generate   │  │   analyze    │  │    give      │
        │  _opening   │  │   _answer    │  │   _feedback  │
        └─────┬──────┘  └──────┬───────┘  └──────┬───────┘
              │                │                  │
              ▼         ┌──────┴──────┐           ▼
             END        │ route_question│         END
                        └──┬───┬───┬──┘
                           │   │   │
              ┌────────────┘   │   └────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌──────────┐   ┌──────────┐   ┌──────────────┐
        │   ask    │   │   ask    │   │     ask      │
        │ _explore │   │_technical│   │  _behavioral │
        └────┬─────┘   └────┬─────┘   └──────┬───────┘
             │              │                 │
             ▼              ▼                 ▼
            END            END              END
```

### 单轮请求的完整链路

```
前端: POST /api/chat/message
      (interviewId + idempotencyKey + 当前输入)
         │
         ▼
┌─────────────────────────────┐
│ 认领本轮请求并锁定面试版本    │
│ 从 Supabase 恢复 checkpoint  │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ graph.stream(initialState)  │ ← LangGraph 图执行
│ thread_id: interviewId      │
│ streamMode: messages+values │
└────────┬────────────────────┘
         │ for await (mode, payload)
         ▼
┌─────────────────────────────┐
│ SSE 逐 token 推送到前端      │
│ {type:'agent'} → 节点切换    │
│ {type:'text'}  → 内容 token  │
│ {type:'done'}  → 完成        │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ 原子提交消息 + checkpoint     │
│ + transcript + state_version │
└─────────────────────────────┘
```

---

## 4. LangGraph 状态定义

`InterviewStateAnnotation` 定义了图内所有共享状态：

| 字段 | 类型 | Reducer | 说明 |
|------|------|---------|------|
| `messages` | `Message[]` | 追加（concat） | LangChain 消息对象（由节点生成） |
| `rawMessages` | `{role, content}[]` | 覆盖 | 前端传入的原始对话历史 |
| `config` | `object` | 覆盖 | 面试配置（position, language 等） |
| `phase` | `string` | 覆盖 | `'opening'` → `'questioning'` → `'closed'` |
| `questionCount` | `number` | 覆盖 | 已问总题数 |
| `technicalCount` | `number` | 覆盖 | 技术题计数 |
| `behavioralCount` | `number` | 覆盖 | 行为题计数 |
| `exploreCount` | `number` | 覆盖 | 经历深挖题计数 |
| `plan` | `string[]` | 覆盖 | 面试计划槽位序列 |
| `planIndex` | `number` | 覆盖 | 当前执行到的槽位索引 |
| `interviewerName` | `string` | 覆盖 | 面试官姓名（如 "Dr. Schmidt"） |
| `nextQuestionType` | `string` | 覆盖 | 分析器输出的下一题类型 |
| `analysisNotes` | `string[]` | 追加 | 每轮分析器的评估记录 |
| `lastAnswerQuality` | `string` | 覆盖 | `strong/adequate/weak`，供 Adaptive 难度确定下一题 |

### 阶段流转

```
opening → questioning → closed
   │          │            │
   │          │            └─ give_feedback 后设置
   │          └─ generate_opening 后设置
   └─ 初始化时设置
```

---

## 5. 节点详解

### 5.1 route_turn（路由节点）

**类型**：空节点（无 LLM 调用），仅用于条件分支

**输出**：`{}`（不修改状态）

### 5.2 analyze_answer（分析器 — 内部节点）

**角色**：对用户最新回答进行结构化评估，不直接与用户交流

**LLM**：`analyzerLLM`（temperature: 0.3，低随机性确保稳定分析）

**Prompt 模板**：`analyzer.md`

**输入变量**：`POSITION`, `LANGUAGE`, `PLAN_INDEX`, `PLAN_LENGTH`, `QUESTION_COUNT`, `TECHNICAL_COUNT`, `BEHAVIORAL_COUNT`, `EXPLORE_COUNT`, `JOB_DESCRIPTION`, `RESUME_SNAPSHOT`, `USER_ANSWER`, `ANALYSIS_HISTORY`

**输出 JSON 格式**：

```json
{
  "quality": "strong|adequate|weak",
  "strengths": ["具体优势1", "具体优势2"],
  "gaps": ["不足或不清楚的领域1", "不足或不清楚的领域2"],
  "notes": "一句话总结观察到的情况",
  "suggested_focus": "下一个面试官消息应强调或探究的方向",
  "end_interview": false
}
```

**状态更新**：
- `nextQuestionType`：若 `end_interview: true` 则设为 `'feedback'`，否则 `'continue'`
- `analysisNotes`：追加本轮分析记录

**特殊规则**：
- 仅当候选人明确要求停止、拒绝继续或回答无法使用时才设 `end_interview: true`
- 分析器不在 `RESPONSE_NODES` 中，其输出不会通过 SSE 发送给前端

### 5.3 generate_opening（开场节点）

**角色**：以面试官身份问候并请求自我介绍

**LLM**：`responseLLM`（temperature: 0.85）

**Prompt 模板**：`opening_agent.md`

**输入变量**：`INTERVIEWER_NAME`, `POSITION`, `LANGUAGE`, `JOB_DESCRIPTION`, `RESUME_SNAPSHOT`

**行为规则**：
- 用一句话问候候选人并自我介绍
- 请求候选人自我介绍
- 不得解释面试结构或议程
- 严格 ≤ 80 字限制
- 不得输出方括号 `[]`

**状态更新**：`phase → 'questioning'`，所有计数器归零

### 5.4 ask_explore（经历深挖节点）

**角色**：深入了解候选人的简历、项目、实习经历

**LLM**：`responseLLM`（temperature: 0.85）

**Prompt 模板**：`explore_agent.md`

**输入变量**：`INTERVIEWER_NAME`, `POSITION`, `LANGUAGE`, `MAX_QUESTIONS`, `JOB_DESCRIPTION`, `RESUME_SNAPSHOT`, `ANALYSIS_NOTES`, `QUESTION_NUMBER`, `CONVERSATION_HISTORY`

**回复结构**：
1. **批判性分析与反应**（0-1 句）：基于分析笔记，指出回答不足或自然过渡
2. **一个问题**：追问不充分的答案，或转向简历中的新项目/经历

**行为规则**：
- 每条消息只问一个问题
- 不问 STAR 行为题
- 严格 ≤ 50 字限制
- 基于简历和对话证据，不编造信息

**状态更新**：`planIndex + 1`, `questionCount + 1`, `exploreCount + 1`

### 5.5 ask_technical（技术提问节点）

**角色**：围绕职位需求提出技术问题

**LLM**：`responseLLM`（temperature: 0.85）

**Prompt 模板**：`technical_agent.md`

**输入变量**：`INTERVIEWER_NAME`, `POSITION`, `LANGUAGE`, `MAX_QUESTIONS`, `JOB_DESCRIPTION`, `RESUME_SNAPSHOT`, `DOMAIN_TOPICS`, `ANALYSIS_NOTES`, `QUESTION_NUMBER`, `CONVERSATION_HISTORY`

**回复结构**：
1. **技术评判与反应**（0-1 句）：评估技术深度，指出浅层或错误回答
2. **一个技术问题**：关联 JD 和简历

**特殊能力**：
- 通过 `findRelevantDomain()` 匹配最相关的技术领域，注入 `DOMAIN_TOPICS`
- 对比简历技术栈和 JD 要求，探查匹配与缺口

**状态更新**：`planIndex + 1`, `questionCount + 1`, `technicalCount + 1`

### 5.6 ask_behavioral（行为提问节点）

**角色**：使用 STAR 方法进行行为面试

**LLM**：`responseLLM`（temperature: 0.85）

**Prompt 模板**：`behavioral_agent.md`

**输入变量**：`INTERVIEWER_NAME`, `POSITION`, `LANGUAGE`, `MAX_QUESTIONS`, `JOB_DESCRIPTION`, `RESUME_SNAPSHOT`, `COMPETENCY_NAME`, `COMPETENCY_DESCRIPTION`, `ANALYSIS_NOTES`, `QUESTION_NUMBER`, `CONVERSATION_HISTORY`

**回复结构**：
1. **行为反应**（0-1 句）：检查 STAR 完整性，指出缺失的 Action 或 Result
2. **一个问题**：对不充分的答案追问，或转向新的胜任力

**特殊能力**：
- 通过 `findUnusedCompetency()` 随机选择未考察的行为胜任力
- 结合德国/欧盟学习和工作背景（Praktikum、Werkstudent、论文项目）

**状态更新**：`planIndex + 1`, `questionCount + 1`, `behavioralCount + 1`

### 5.7 give_feedback（反馈节点）

**角色**：SSE 通道面试结束时在对话中输出的反馈。报告页的结构化报告由 `finalize` 另行生成，见[面试报告](../面试报告.md)

**LLM**：`feedbackLLM`（temperature: 0.75，maxTokens: 4096 — 需要更长输出）

**Prompt 模板**：`feedback_agent.md`

**输入变量**：`POSITION`, `LANGUAGE`, `QUESTION_COUNT`, `TECHNICAL_COUNT`, `BEHAVIORAL_COUNT`, `ANALYSIS_NOTES`, `CONVERSATION_HISTORY`

**输出结构**：

```
[温暖的结束寒暄 2-4 句]

---

### 🎯 Overall Assessment
[2-3 句总体印象]

### ✅ Strengths
[3-4 个具体优势]

### 📈 Areas for Improvement
[3-4 个改进建议，附具体方法]

### 💡 Actionable Next Steps
[2-3 个实际行动建议]

### 🌟 Final Encouragement
[1-2 句鼓励]
```

**状态更新**：`phase → 'closed'`

---

## 6. 路由逻辑

### 6.1 routeTurnEdge（第一级路由）

从 `route_turn` 节点出发，决定进入哪条主路径：

```
if phase === 'opening'     → generate_opening   // 首轮：开场问候
if planIndex >= planLength  → give_feedback      // 计划题目全部完成
otherwise                   → analyze_answer     // 分析用户回答
```

### 6.2 routeQuestionEdge（第二级路由）

从 `analyze_answer` 节点出发，决定下一个提问节点：

```
if nextQuestionType === 'feedback'  → give_feedback  // 分析器判断应结束
if planIndex >= planLength          → give_feedback  // 安全兜底

otherwise → plan[planIndex]  // 按计划执行
  'explore'    → ask_explore
  'behavioral' → ask_behavioral
  'technical'  → ask_technical (默认)
```

### 路由决策示意

```
用户第1次发言 (面试刚开始)
  → phase='opening' → generate_opening → "Good morning, I'm Dr. Schmidt..."

用户第2次发言 (自我介绍后)
  → phase='questioning', planIndex=0 → analyze_answer → plan[0]='explore' → ask_explore

用户第3次发言
  → planIndex=1 → analyze_answer → plan[1]='technical' → ask_technical

...

用户第N次发言 (planIndex >= planLength)
  → give_feedback → "Thank you for your time..." + 结构化反馈
```

---

## 7. 面试计划生成

### buildInterviewPlan(maxQ, interviewerType)

根据面试总题数和面试官类型生成有序的题型槽位序列。`mixed` 使用综合分配算法；`hr`
只生成经历/行为槽位；`technical` 只生成经历/技术/案例槽位。难度调整只能在当前类型允许的
题型集合内进行。

**正式模拟题数计算规则**（`getMaxQuestions`）：

正式时长允许 5–60 分钟。核心题槽约为 `floor(duration / 2.5) + 1`，最少 3 个、最多 20 个；
开场自我介绍独立于这些核心题槽。练习模式不限时，题量改由难度决定：Easy 对应约 10 分钟路线，
Medium/Adaptive 对应约 20 分钟路线，Hard 对应约 45 分钟路线。

**正式模拟时间感知**：

- PostgreSQL 的 `deadline_at` 是权威截止时间。
- LangGraph 每轮通过 `timeBudgetInstruction` 获得总时长、剩余分钟和剩余题槽。
- Gemini Live 建连时获得总时长、服务端截止时间和计划题量。
- 练习模式复用 Gemini Live 音频和输入转写，但题目推进仍由持久化练习状态机控制；Live 不直接保存
  attempt，也不自行创建下一题。应用发送控制消息朗读当前题，用户编辑转写并提交后才保存回答。
- 练习模式在 WebSocket 服务端设有输出闸门：默认只转发候选人的输入转写，屏蔽停顿后 Gemini 自行
  产生的文本和音频；只有带 `[PRACTICE_CONTROL]` 的题目朗读消息可以临时打开一次输出。
- 提交答案只执行 `answer` 动作和反馈分析，不生成问题。用户明确执行 `master` 或 `skip` 后，
  `/questions/next` 才把最近三道题的最新已提交答案及反馈交给问题规划器，在当前必经阶段内生成下一题。
- 练习问题规划使用低延迟模型并设置 15 秒上限；模型不可用或超时时，服务端按当前必经阶段生成
  本地备用题并正常提交状态机，避免 `current_question_id` 长期为空导致练习无法开始。
- 答案分析使用轻量模型，并在一次分析中准备四层提示；后续点击优先读取已保存提示。未提交答案时，
  `nudge` 和 `structure` 使用题型模板即时返回，减少重复模型等待。
- AI 负责控制提问节奏，数据库负责强制截止。
- 截止后不再进入问题生成节点；若候选人正在回答已展示的问题，后端保存该答案后直接进入
  `finalizing`，不生成下一题。

**Mixed 槽位分配算法**：

```
总题数 N:
  行为题 B = ceil(N × 0.28), 至少 1 题, 至多 N-2 题
  剩余题 = N - B
  技术题 T = floor(剩余 × 0.5), 至少 1 题
  经历题 E = 剩余 - T, 至少 1 题

排列规则:
  经历和技术交替排列 → 行为题全部放末尾
```

**示例**（10 分钟面试，maxQ=5）：

```
B = ceil(5 × 0.28) = 2
剩余 = 5 - 2 = 3
T = floor(3 × 0.5) = 1
E = 3 - 1 = 2

交替排列: [explore, technical, explore]
行为题:   [behavioral, behavioral]

最终 plan = ['explore', 'technical', 'explore', 'behavioral', 'behavioral']
```

**特殊情况**：
- `N=1`：`['explore']`
- `N=2`：`['explore', 'behavioral']`

---

## 8. Prompt 模板体系

### 模板位置

`backend/data/prompts/`

### 渲染机制

`renderPrompt(template, vars)` 将模板中所有 `{{KEY}}` 占位符替换为实际值。

### 各模板概览

| 文件 | 角色 | 核心指令 | 字数限制 |
|------|------|---------|---------|
| `opening_agent.md` | 面试官开场 | 问候 + 请求自我介绍 | ≤ 80 字 |
| `explore_agent.md` | 经历深挖 | 基于简历追问项目/经历细节 | ≤ 50 字 |
| `technical_agent.md` | 技术面试官 | 与 JD 相关的技术深度问题 | ≤ 50 字 |
| `behavioral_agent.md` | 行为面试官 | STAR 方法的行为提问 | ≤ 50 字 |
| `feedback_agent.md` | 反馈教练 | SSE 通道结束时在对话中给出的反馈（不是报告页的面试报告） | 无限制（长文） |
| `analyzer.md` | 内部分析 | JSON 格式的答案评估 | 仅 JSON |
| `motivation_letter.md` | 动机信写作 | 专业动机信生成 | 按用户指定 |

### 共通变量

| 变量名 | 来源 | 说明 |
|--------|------|------|
| `{{INTERVIEWER_NAME}}` | `getInterviewerName(userId)` | 面试官姓名 |
| `{{POSITION}}` | 用户输入 | 应聘职位 |
| `{{LANGUAGE}}` | 用户选择 | `"English"` 或 `"Deutsch"` |
| `{{JOB_DESCRIPTION}}` | 用户输入 | 职位描述全文 |
| `{{RESUME_SNAPSHOT}}` | 用户上传 | 简历文本（≤ 12000 字符） |
| `{{CONVERSATION_HISTORY}}` | `formatConversationHistory()` | 格式化对话记录 |
| `{{ANALYSIS_NOTES}}` | 上轮分析器输出 | 最近 2-3 条分析笔记 |
| `{{QUESTION_NUMBER}}` | `planIndex + 1` | 当前题号 |
| `{{MAX_QUESTIONS}}` | `getMaxQuestions()` | 最大题数 |

### Prompt 设计原则

1. **严格字数限制**：提问节点 ≤ 50 字，开场 ≤ 80 字，确保语音播放自然
2. **批判性反应**：所有提问节点必须先评价用户答案质量再出题
3. **禁止客套话**：严禁 "Thank you"、"I see" 等无意义短语
4. **单一问题**：每轮只问一个问题
5. **简历锚定**：优先基于简历和 JD 的具体内容提问
6. **德国语境**：行为题结合 Praktikum、Werkstudent、论文项目等场景

---

## 9. 知识库

### 9.1 技术领域库

**文件**：`backend/data/knowledge_base/technical_domains.json`

**结构**：

```json
{
  "domains": [
    {
      "id": "software_frontend",
      "keywords": ["frontend", "react", "vue", ...],
      "name": "Frontend / Web Development",
      "topics": [
        "Component architecture and state management",
        "Browser rendering performance and optimization",
        ...
      ],
      "common_question_patterns": [
        "How do you handle state management in large React applications?",
        ...
      ]
    }
  ]
}
```

**包含领域**：

| 领域 ID | 名称 | 关键词示例 |
|---------|------|-----------|
| `software_frontend` | 前端/Web 开发 | frontend, react, vue, angular |
| `software_backend` | 后端/API 开发 | backend, api, node, microservices |
| `software_fullstack` | 全栈开发 | fullstack, full-stack |
| `data_science` | 数据科学 | data science, machine learning |
| `devops` | DevOps/云 | devops, cloud, kubernetes |
| ... | ... | ... |

**匹配算法**（`findRelevantDomain`）：
- 将职位名转为小写
- 遍历所有领域的 keywords，完整匹配 +2 分，部分词匹配 +1 分
- 返回最高分的领域
- 无匹配时回退到 `software_fullstack`

### 9.2 行为胜任力库

**文件**：`backend/data/knowledge_base/behavioral_competencies.json`

**包含 10 项胜任力**：

| ID | 英文名 | 德文名 | 德国语境 |
|----|--------|--------|---------|
| `teamwork` | Teamwork & Collaboration | Teamarbeit & Zusammenarbeit | Praktikum、论文、大学项目团队 |
| `problem_solving` | Problem Solving Under Pressure | Problemlösung unter Druck | 论文截止日、Werkstudent 紧急任务 |
| `initiative` | Initiative & Proactivity | Initiative & Eigeninitiative | 德国公司高度重视 Eigeninitiative |
| `adaptability` | Adaptability & Learning Agility | Anpassungsfähigkeit & Lernbereitschaft | 新行业 Praktikum、技术栈切换 |
| `communication` | Communication & Stakeholder Mgmt | Kommunikation & Stakeholder-Mgmt | 演讲、报告、跨部门会议 |
| `leadership` | Leadership & Taking Ownership | Führung & Verantwortung übernehmen | 研讨小组、论文项目、学生组织 |
| `conflict_resolution` | Conflict Resolution | Konfliktlösung | 德国文化重视直接沟通 |
| `time_management` | Time Management & Prioritization | Zeitmanagement & Priorisierung | 德国文化核心：Pünktlichkeit |
| `failure_learning` | Learning from Failure | Lernen aus Misserfolgen | 德国面试官重视诚实和系统学习 |
| `cross_cultural` | Cross-Cultural Collaboration | Interkulturelle Zusammenarbeit | 国际学生在德国公司的经验 |

**每项胜任力包含**：
- `star_cues`：STAR 追问线索（如 "What was your specific role?"）
- `german_context`：德国语境说明
- `description` / `description_de`：双语描述

**选择算法**（`findUnusedCompetency`）：
- 检查 `analysisNotes` 中是否已出现某胜任力的 id 或名称
- 从未使用的胜任力池中随机选择
- 若全部使用过则从全集中随机选

---

## 10. Agent 会话接入

### 持久化存储

`interviewSessionStore.js` 使用 Supabase PostgreSQL 保存事实状态，不再存在全局
`Map<userId, SessionState>`。核心数据分为：

| 数据 | 存储位置 | 用途 |
|------|----------|------|
| 面试配置与状态 | `interviews` | 面试官类型、模式、难度、状态、截止时间、版本和当前问题 |
| LangGraph checkpoint | `interviews.graph_state_json` | phase、类型化计划、计数器、分析记录和最近答案质量 |
| 消息 | `interview_messages` | 按轮次、角色和序号保存可恢复对话 |
| 兼容 transcript | `interviews.transcript_json` | 旧报告和旧客户端兼容读取 |
| 规范化学习数据 | `interview_questions/attempts/hints/notes` | 练习操作、正式答案和证据链 |
| 幂等记录 | `interview_requests`、`interview_creation_requests` | 网络重试时重放已提交结果 |

所有查询同时约束 `interviewId` 和当前认证用户，避免同一用户的多场面试串线。
写库原语、幂等子键和故障回滚的全景见[第 2.3 节](#23-持久化状态怎么保存)和[第 2.4 节](#24-错误回滚出错后怎么办)。

### 会话生命周期

```
POST /api/interviews (idempotencyKey)
  → 数据库事务检查积分并只扣除一次
  → 创建 interview + 初始 checkpoint + deadline/matrix

POST /api/chat/message (interviewId, idempotencyKey)
  → expire_formal_interview_if_due()
  → claim request + load interview/messages/checkpoint
  → graph.stream(thread_id=interviewId)
  → commit messages/checkpoint/transcript with expected state_version

POST /api/chat/reset (interviewId)
  → 兼容旧客户端的初始化/恢复检查，不删除已保存状态

GET /api/chat/session?interviewId=<uuid>
  → 返回该面试的持久化进度
```

同一幂等键重试返回原结果；两个实例使用相同旧版本提交时，后提交者收到版本冲突，
不会覆盖新状态。Gemini 调用失败发生在提交之前，因此不会产生半轮 checkpoint。

### 与业务状态机的边界

Agent 可以读取 mode、difficulty、interviewer type、路线与最近回答证据，但不拥有暂停、重答、掌握、
跳过、deadline、finalize 等业务状态转换。练习/正式状态机、Live 输出闸门和报告生命周期统一见
[面试流程](面试流程.md)；本文只说明这些状态如何成为 Agent 的输入，以及 Agent 输出如何在事务提交前被消费。

### 面试官姓名

基于 `userId` 确定性分配（同一用户始终看到同一面试官）：

```javascript
const INTERVIEWER_NAMES = [
  'Dr. Schmidt', 'Ms. Müller', 'Mr. Wagner', 'Ms. Fischer', 'Dr. Weber'
]
// idx = userId.charCodeAt(0) % 5
```

### 语音断线恢复

Gemini Live 的网络连接本身是临时资源。重新连接必须提供 `interviewId`，后端只加载该面试
当前问题和最近有限条消息，不会恢复同一用户其他面试的内容。每个完成的用户/面试官语音
回合仍通过同一套版本与幂等机制持久化。

---

## 11. SSE 流式通信

### 端点

`POST /api/chat/message`

### SSE 事件类型

| 事件 | 格式 | 说明 | 示例 |
|------|------|------|------|
| `agent` | `{type:'agent', name, label, emoji}` | 当前说话的角色切换 | `{type:'agent', name:'technical', label:'技术面试官', emoji:'💡'}` |
| `text` | `{type:'text', content}` | 文本 token 流 | `{type:'text', content:'What frameworks'}` |
| `done` | `{type:'done'}` | 图执行完成 | `{type:'done'}` |
| `error` | `{type:'error', message}` | 错误 | `{type:'error', message:'Internal server error'}` |

### 节点 → SSE 标签映射

| 图节点 | `name` | `label` | `emoji` | 是否流式输出文本 |
|--------|--------|---------|---------|----------------|
| `generate_opening` | `opening` | 面试官 | 👔 | ✅ |
| `ask_explore` | `explore` | 经历深挖 | 📎 | ✅ |
| `ask_technical` | `technical` | 技术面试官 | 💡 | ✅ |
| `ask_behavioral` | `behavioral` | 行为面试官 | 🤝 | ✅ |
| `give_feedback` | `feedback` | 面试反馈 | 📋 | ✅ |
| `analyze_answer` | `analyzer` | 分析中... | 🔍 | ❌（内部推理） |

### 流式执行机制

```javascript
const stream = await graph.stream(initialState, {
  configurable: { thread_id: interviewId },
  streamMode: ['messages', 'values'],
})

for await (const [mode, payload] of stream) {
  if (mode === 'values') {
    finalGraphState = payload // 用于生成完整持久化 checkpoint
    continue
  }
  const [chunk, metadata] = payload
  const node = metadata?.langgraph_node
  
  // 仅 RESPONSE_NODES 中的节点才向前端发送
  if (RESPONSE_NODES.has(node)) {
    // 节点切换时发送 agent 事件
    if (node !== currentNode) {
      sseWrite(res, { type: 'agent', ...AGENT_LABELS[node] })
    }
    // 有内容时发送 text 事件
    if (chunk?.content) {
      sseWrite(res, { type: 'text', content: chunk.content })
    }
  }
}
```

---

## 12. LLM 配置

### 三个 LLM 实例

| 实例 | 用途 | temperature | maxOutputTokens | streaming |
|------|------|-------------|-----------------|-----------|
| `analyzerLLM` | 答案分析（JSON） | 0.3 | 1024 | true |
| `responseLLM` | 开场 + 三类提问 | 0.85 | 1024 | true |
| `feedbackLLM` | 结束反馈报告 | 0.75 | 4096 | true |

### 安全设置

所有 LLM 实例均设置为 `BLOCK_NONE`：

```javascript
safetySettings: [
  { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',   threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',   threshold: 'BLOCK_NONE' },
]
```

### 消息构造

`toGeminiMessages(rawMessages, limit, fallbackHuman)` 将前端传入的原始消息转为 LangChain 格式：

- 取最近 `limit` 条消息
- 确保以 `HumanMessage` 开头（Gemini 要求）
- 无有效消息时使用 `fallbackHuman`

### 简历文本处理

`resumeSnapshotFromConfig(config)` 限制简历文本长度：

- 最大 12,000 字符（超出截断 + `[…truncated…]`）
- 空值时返回 `"(No resume text provided for this session.)"`

---

## 13. 辅助 Agent：动机信生成

### 端点

`POST /api/ai-assistant/generate-motivation-letter`

### 独立于面试图

此功能不使用 LangGraph，是单次 LLM 调用：

```
用户输入 (position, jobDescription, resumeText, targetLength, language)
  → 加载 motivation_letter.md 模板
  → renderPrompt 填充变量
  → ChatGoogleGenerativeAI.invoke()
  → 返回生成的动机信文本
```

### 请求体

```json
{
  "position": "Software Engineer",
  "jobDescription": "We are looking for...",
  "resumeText": "John Doe, TUM...",
  "targetLength": 200,
  "language": "English"
}
```

### Prompt 特点

- 专业动机信写作者角色
- 支持德语 Anschreiben 格式
- STAR 方法连接简历与 JD
- 直接从 Subject 行开始，不含信头

---

## 14. LangGraph 执行流程示例

以一个 10 分钟英语面试（Software Engineer 职位）为例：

```
时间线    plan=['explore','technical','explore','behavioral','behavioral']
─────────────────────────────────────────────────────────────────

轮次 0:   [用户进入面试]
          → phase='opening'
          → generate_opening
          ← "Good morning! I'm Dr. Schmidt, hiring manager for the
             Software Engineer role. Could you start by telling me
             about yourself?"

轮次 1:   [用户自我介绍]
          → phase='questioning', planIndex=0
          → analyze_answer → {quality:"adequate", focus:"Probe React experience"}
          → plan[0]='explore' → ask_explore
          ← "You mentioned React in your internship. What was the most
             complex component you built?"

轮次 2:   [用户回答 React 经验]
          → planIndex=1
          → analyze_answer → {quality:"strong", focus:"Test system design knowledge"}
          → plan[1]='technical' → ask_technical
          ← "How would you handle state management across 50+ components
             in a large-scale app?"

轮次 3:   [用户回答技术问题]
          → planIndex=2
          → analyze_answer → {quality:"adequate", focus:"Dig into thesis project"}
          → plan[2]='explore' → ask_explore
          ← "Your CV mentions a thesis on ML pipelines. What was your
             biggest engineering challenge there?"

轮次 4:   [用户回答论文经历]
          → planIndex=3
          → analyze_answer → {quality:"strong", focus:"Assess teamwork"}
          → plan[3]='behavioral' → ask_behavioral
          ← competency: "Teamwork & Collaboration"
          ← "Tell me about a time you had to coordinate with team members
             who disagreed on the technical approach."

轮次 5:   [用户讲述团队合作经历]
          → planIndex=4
          → analyze_answer → {quality:"strong", focus:"Test conflict handling"}
          → plan[4]='behavioral' → ask_behavioral
          ← competency: "Problem Solving Under Pressure"
          ← "Describe a situation where you faced an unexpected deadline
             change. How did you handle it?"

轮次 6:   [用户回答行为题]
          → planIndex=5 ≥ planLength(5)
          → routeTurnEdge → 'feedback'
          → give_feedback
          ← "Thank you so much for your time today, [Name]..."
             ---
             ### 🎯 Overall Assessment
             ...
          → phase='closed'
```

---

## 15. 配置参考

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `GEMINI_API_KEY` | 是 | — | Gemini API Key（LLM + TTS 回退） |
| `GEMINI_MODEL` | 否 | `gemini-3.7-flash` | 文本 LLM 模型名；配额耗尽时由封装层尝试 Flash-Lite |

### npm 依赖

| 包名 | 作用 |
|------|------|
| `@langchain/langgraph` | 有状态图执行引擎 |
| `@langchain/google-genai` | Gemini LLM 封装 |
| `@langchain/core` | Message 类型、基础抽象 |

### 目录结构

```
backend/
├── src/
│   ├── agents/
│   │   ├── interviewGraph.js   ← 图定义 + 全部节点
│   │   └── utils.js            ← Prompt、知识库和计划工具（无会话存储）
│   ├── lib/
│   │   ├── interviewSessionStore.js ← checkpoint、消息、锁与幂等提交
│   │   └── interviewLearning.js     ← 难度、RAG、证据与进步汇总
│   ├── live/
│   │   └── interviewLiveSocket.js  ← Gemini Live 与断线恢复
│   ├── routes/
│   │   ├── chat.js             ← 面试 SSE + TTS 端点
│   │   ├── interviewSessions.js← 练习/正式状态机 API
│   │   └── aiAssistant.js      ← 动机信生成
│   └── index.js                ← Express 入口
├── data/
│   ├── prompts/
│   │   ├── analyzer.md
│   │   ├── opening_agent.md
│   │   ├── explore_agent.md
│   │   ├── technical_agent.md
│   │   ├── behavioral_agent.md
│   │   ├── feedback_agent.md
│   │   └── motivation_letter.md
│   └── knowledge_base/
│       ├── technical_domains.json
│       └── behavioral_competencies.json
└── .env
```
