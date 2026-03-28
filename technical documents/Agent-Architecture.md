# Agent 智能体架构技术文档

## 目录

1. [系统概览](#1-系统概览)
2. [架构图](#2-架构图)
3. [LangGraph 状态定义](#3-langgraph-状态定义)
4. [节点详解](#4-节点详解)
5. [路由逻辑](#5-路由逻辑)
6. [面试计划生成](#6-面试计划生成)
7. [Prompt 模板体系](#7-prompt-模板体系)
8. [知识库](#8-知识库)
9. [会话管理](#9-会话管理)
10. [SSE 流式通信](#10-sse-流式通信)
11. [LLM 配置](#11-llm-配置)
12. [辅助 Agent：动机信生成](#12-辅助-agent动机信生成)
13. [面试全流程示例](#13-面试全流程示例)
14. [配置参考](#14-配置参考)

---

## 1. 系统概览

本系统基于 **LangGraph** 构建多智能体面试系统，模拟真实的德国公司面试流程。核心设计原则：

- **多角色协作**：分析器（内部推理）、开场、经历深挖、技术、行为、反馈共 6 个角色
- **有状态图执行**：每轮用户消息触发一次图遍历，产生一个面试官回复
- **动态路由**：根据面试进度计划（plan）自动选择下一个提问类型
- **流式输出**：通过 SSE 将 LLM token 实时推送到前端

### 技术栈

| 层级 | 技术 | 作用 |
|------|------|------|
| 图引擎 | `@langchain/langgraph` (StateGraph) | 有状态多节点图 |
| LLM | `@langchain/google-genai` (Gemini 2.5 Flash) | 文本生成 |
| 提示词 | Markdown 模板 + `{{变量}}` 渲染 | 角色指令 |
| 知识库 | JSON 文件 | 技术领域、行为胜任力 |
| 会话存储 | 内存 Map（按 userId） | 面试进度持久化 |
| 通信 | Server-Sent Events (SSE) | 实时流式推送 |

### 文件清单

| 文件路径 | 行数 | 作用 |
|----------|------|------|
| `backend/src/agents/interviewGraph.js` | 446 | 图定义、全部节点实现、LLM 实例化 |
| `backend/src/agents/utils.js` | 227 | 工具函数：prompt 加载、知识库、会话管理、面试计划 |
| `backend/src/routes/chat.js` | 525 | HTTP 路由：SSE 消息流、TTS、会话 API |
| `backend/src/routes/aiAssistant.js` | 58 | 动机信生成（独立于面试图） |
| `backend/data/prompts/*.md` | 7 文件 | 各角色的 Prompt 模板 |
| `backend/data/knowledge_base/*.json` | 2 文件 | 技术领域和行为胜任力库 |

---

## 2. 架构图

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
前端: POST /api/chat/message (含完整对话历史)
         │
         ▼
┌─────────────────────────────┐
│ chat.js: 会话恢复/初始化     │
│ 构建 initialState            │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ graph.stream(initialState)  │ ← LangGraph 图执行
│ streamMode: 'messages'      │
└────────┬────────────────────┘
         │ for await (chunk, metadata)
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
│ 更新 sessionStore            │
│ (planIndex++, 计数器, phase) │
└─────────────────────────────┘
```

---

## 3. LangGraph 状态定义

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

### 阶段流转

```
opening → questioning → closed
   │          │            │
   │          │            └─ give_feedback 后设置
   │          └─ generate_opening 后设置
   └─ 初始化时设置
```

---

## 4. 节点详解

### 4.1 route_turn（路由节点）

**类型**：空节点（无 LLM 调用），仅用于条件分支

**输出**：`{}`（不修改状态）

### 4.2 analyze_answer（分析器 — 内部节点）

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

### 4.3 generate_opening（开场节点）

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

### 4.4 ask_explore（经历深挖节点）

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

### 4.5 ask_technical（技术提问节点）

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

### 4.6 ask_behavioral（行为提问节点）

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

### 4.7 give_feedback（反馈节点）

**角色**：面试结束后的专业反馈报告

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

## 5. 路由逻辑

### 5.1 routeTurnEdge（第一级路由）

从 `route_turn` 节点出发，决定进入哪条主路径：

```
if phase === 'opening'     → generate_opening   // 首轮：开场问候
if planIndex >= planLength  → give_feedback      // 计划题目全部完成
otherwise                   → analyze_answer     // 分析用户回答
```

### 5.2 routeQuestionEdge（第二级路由）

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

## 6. 面试计划生成

### buildInterviewPlan(maxQ)

根据面试总题数生成有序的题型槽位序列：

**题数计算规则**（`getMaxQuestions`）：

| 面试时长 | 最大题数 |
|----------|---------|
| ≤ 5 分钟 | 3 |
| ≤ 10 分钟 | 5 |
| ≤ 15 分钟 | 7 |
| > 15 分钟 | 9 |

**槽位分配算法**：

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

## 7. Prompt 模板体系

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
| `feedback_agent.md` | 反馈教练 | 结构化反馈报告 | 无限制（长文） |
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

## 8. 知识库

### 8.1 技术领域库

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

### 8.2 行为胜任力库

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

## 9. 会话管理

### sessionStore

**存储方式**：进程内 `Map<userId, SessionState>`

**SessionState 结构**：

```javascript
{
  userId:          string,
  phase:           'opening' | 'questioning' | 'closed',
  questionCount:   number,
  technicalCount:  number,
  behavioralCount: number,
  exploreCount:    number,
  plan:            string[],    // ['explore', 'technical', 'explore', 'behavioral', ...]
  planIndex:       number,
  analysisNotes:   string[],
  config:          { position, jobDescription, language, duration, resumeSnapshot },
  interviewerName: string,
  createdAt:       number,     // Date.now()
}
```

**API**：

| 方法 | 说明 |
|------|------|
| `init(userId, config)` | 初始化新会话，生成面试计划 |
| `get(userId)` | 获取当前会话状态 |
| `update(userId, patch)` | 部分更新会话字段 |
| `delete(userId)` | 删除会话 |

### 会话生命周期

```
POST /api/chat/message (sessionId='new')
  → sessionStore.init() → phase='opening'
  
POST /api/chat/message (后续)
  → sessionStore.get() → 恢复状态
  → 图执行
  → sessionStore.update() → 更新 planIndex、计数器、phase

POST /api/chat/reset
  → sessionStore.init() → 重置全部状态

GET /api/chat/session
  → 返回当前进度 JSON（调试/前端状态展示）
```

### 面试官姓名

基于 `userId` 确定性分配（同一用户始终看到同一面试官）：

```javascript
const INTERVIEWER_NAMES = [
  'Dr. Schmidt', 'Ms. Müller', 'Mr. Wagner', 'Ms. Fischer', 'Dr. Weber'
]
// idx = userId.charCodeAt(0) % 5
```

### 已知限制

- **内存存储**：服务重启后会话丢失
- **`analysisNotes` 同步**：`sessionStore` 未显式更新 `analysisNotes`，跨请求的分析历史主要依赖客户端传入的 `rawMessages` 重建

---

## 10. SSE 流式通信

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
const stream = await graph.stream(initialState, { streamMode: 'messages' })

for await (const [chunk, metadata] of stream) {
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

## 11. LLM 配置

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

## 12. 辅助 Agent：动机信生成

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

## 13. 面试全流程示例

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

## 14. 配置参考

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `GEMINI_API_KEY` | 是 | — | Gemini API Key（LLM + TTS 回退） |
| `GEMINI_MODEL` | 否 | `gemini-2.5-flash` | LLM 模型名 |

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
│   │   └── utils.js            ← 工具函数 + 会话管理
│   ├── routes/
│   │   ├── chat.js             ← 面试 SSE + TTS 端点
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
