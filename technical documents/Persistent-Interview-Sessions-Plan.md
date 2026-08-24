# 持久化面试 Session 与练习/正式模式设计计划

## 文档状态

- 开发分支：`feature/persistent-interview-sessions`
- 当前阶段：第一阶段已实现并完成本地自动化验收，等待浏览器人工验收与上线确认
- 开发策略：前后端在同名功能分支中开发，先使用本地 Supabase、本地 Node.js 后端和本地 Vite 前端测试
- 上线限制：在方案通过本地测试并经人工确认前，不合并到 `main`，不执行云端 `supabase db push`，不部署 Firebase Hosting 或 Cloud Run

已落地：持久化 checkpoint/消息、幂等创建与动作、乐观锁、练习/正式状态机、四种难度、
服务端计时、刷新与 Live 重连、四级提示限制、未作答禁止掌握、时长/题数自动结束，以及
HR/Technical/Mixed 面试官类型。五个本地迁移、数据库 lint、事务化 SQL 验收、后端测试和
前端生产构建均已通过；浏览器语音权限和完整组合流程仍需人工验收。

## 目标

将面试业务状态从 Node.js 进程内的 `Map<userId, SessionState>` 迁移到以 `interviewId` 隔离的持久化 Session，使 Cloud Run 后端能够无状态扩展，并支持：

- 每场面试上下文完全隔离
- 练习面试暂停、恢复、提示、笔记、重答、掌握和跳过
- 正式模拟面试连续计时、禁止暂停、结束后统一反馈
- Easy、Medium、Hard 和 Adaptive 难度
- 后端重启、断线重连和多实例情况下的状态恢复

---

## 1. 核心设计

当前实现使用进程内：

```js
Map<userId, SessionState>
```

目标实现改为：

```text
InterviewSession<interviewId, PersistedState>
```

Cloud Run 后端作为无状态计算服务，每次请求必须携带 `interviewId`：

1. 校验当前登录用户拥有该场面试。
2. 从 Supabase 读取该面试的持久化状态。
3. 执行一次 LangGraph 状态转换或 Gemini 调用。
4. 原子保存新状态、新消息和事件。
5. 返回下一道题、即时反馈或最终状态。

Supabase PostgreSQL 是业务状态的事实来源。第一阶段不引入 Redis；以后只有在并发量或锁竞争确实需要时，才将 Redis 用于短期锁、缓存或消息协调，不把 Redis 作为长期面试记录的唯一存储。

## 2. 每场面试完全隔离

创建面试时，为岗位和用户资料保存不可变快照：

```json
{
  "interviewId": "uuid",
  "userId": "uuid",
  "mode": "practice",
  "difficulty": "medium",
  "position": "Backend Developer",
  "jobDescriptionSnapshot": "...",
  "resumeSnapshot": "...",
  "language": "de",
  "status": "active"
}
```

后续 Prompt 只能使用：

- 当前 `interviewId` 的对话和状态
- 创建时保存的岗位要求快照
- 创建时保存的用户资料/简历快照
- 当前面试的模式和难度
- 当前问题及本题的历史尝试

禁止通过 `userId` 复用另一场面试的 Session、消息、分析笔记或问题计划。

LangGraph 的线程标识统一使用：

```text
thread_id = interviewId
```

不再使用 `userId` 作为面试流程状态的主键。同一用户可同时拥有多场互不影响的面试。

## 3. 两种独立的面试状态机

### 3.1 练习模式（Practice）

练习模式以“掌握一道题”为推进单位：

```text
创建面试
  → 生成问题
  → 用户回答
  → 即时分析
  → 用户选择：
      ├─ 获取提示
      ├─ 查看回答结构
      ├─ 再回答一次
      ├─ 记录笔记
      ├─ 标记已掌握并进入下一题
      ├─ 跳过
      └─ 暂停
```

规则：

- 可以随时暂停并在以后恢复。
- 同一道题允许保存多次回答，不能用新回答覆盖旧回答。
- 每次回答后可以获得针对当前回答的即时反馈。
- 用户决定何时进入下一题。
- 可以跳过问题，但必须记录跳过事件和原因（如果用户填写）。
- 最终报告侧重学习过程、首次回答与最终回答的差异及掌握进度。

提示采用递进式等级：

1. `nudge`：只提供思考方向。
2. `structure`：提供 STAR、技术分析或案例组织结构。
3. `key_points`：列出应该覆盖的关键点。
4. `example`：最后才提供参考答案。

### 3.2 正式模拟模式（Formal）

```text
创建面试
  → 服务端开始计时
  → 连续提问与追问
  → 时间到或题目完成
  → 锁定面试
  → 生成最终报告
```

规则：

- 用户不能主动暂停计时。
- 面试过程中不显示提示、评分、解析和参考答案。
- 同一道题不能反复重答。
- 服务端保存 `deadline_at`，关闭页面后计时继续。
- 可以短暂断线重连，但断线不停止正式面试计时。
- 可设置 60–120 秒重连宽限；超出宽限后根据状态继续或结束。
- 只在结束后生成完整反馈。

## 4. 推荐的数据结构

### 4.1 `interviews`

保存一场面试的整体状态：

```text
id
user_id
mode                       practice | formal
difficulty                 easy | medium | hard | adaptive
status                     draft | active | paused | finalizing | completed | abandoned
position
job_description_snapshot
resume_snapshot
language
current_question_id
question_index
graph_state_json
state_version
started_at
paused_at
accumulated_seconds
deadline_at
completed_at
report_json
```

关键字段：

- `state_version`：乐观锁版本号，防止并发覆盖。
- `deadline_at`：正式模式的服务端截止时间。
- `graph_state_json`：保存可恢复的 LangGraph 流程状态，不承担完整消息历史存储。
- `job_description_snapshot`、`resume_snapshot`：确保本场面试始终使用创建时的资料，用户以后修改资料不会污染历史面试。

### 4.2 `interview_questions`

每道问题独立保存：

```text
id
interview_id
sequence
question_text
question_type
difficulty
competency
source
status
created_at
completed_at
```

`source` 记录问题来源：简历经历、岗位要求、企业面经知识库、上一轮回答追问或通用题库。

### 4.3 `interview_attempts`

练习模式下一道题允许多次回答：

```text
id
interview_id
question_id
attempt_number
answer_text
feedback_json
hint_level_used
created_at
```

保留每次回答后，才能比较第一次和最终回答，展示用户的真实进步。

### 4.4 `interview_messages`

以追加方式保存完整对话：

```text
id
interview_id
question_id
role
content
sequence
created_at
```

新逻辑逐步迁移到消息表。现有 `transcript_json` 在过渡期保留，用于兼容旧面试、旧报告接口和回滚。

### 4.5 `interview_notes`

保存练习模式笔记：

```text
id
interview_id
question_id
user_id
content
created_at
updated_at
```

笔记可记录数据、真实案例、回答结构、遗漏点和可能的追问。

### 4.6 `interview_events`

沿用现有事件日志，并增加：

```text
session_created
session_resumed
session_paused
question_generated
answer_submitted
hint_requested
answer_retried
question_mastered
question_skipped
formal_deadline_reached
reconnected
```

事件日志不保存 API 密钥、原始音频或完整 Prompt。

## 5. 避免并发覆盖和重复操作

数据库持久化不能单独解决并发问题。所有状态更新采用乐观锁：

```sql
update interviews
set
  graph_state_json = :new_state,
  state_version = state_version + 1
where id = :interview_id
  and user_id = :user_id
  and state_version = :expected_version;
```

如果更新行数为 0，说明其他请求已经推进了状态。当前请求必须重新读取或返回冲突，不能覆盖新状态。

每个会产生副作用的操作必须携带：

```text
requestId / idempotencyKey
```

用于避免网络重试造成：

- 重复生成问题
- 重复保存回答
- 重复请求提示
- 重复扣除积分
- 重复推进题目
- 重复生成报告

数据库需要对 `(interview_id, idempotency_key)` 建立唯一约束或等价的幂等操作表。

## 6. 难度设计

| 难度 | 问题特点 | 追问策略 |
|---|---|---|
| Easy | 常见基础题，问题表达清晰 | 提示较多，追问较少 |
| Medium | 岗位核心能力题 | 针对缺失信息追问 |
| Hard | 复杂场景、权衡、失败和反例 | 深挖决策依据、边界和风险 |
| Adaptive | 根据上一题表现动态调整 | 回答好则提高，薄弱则保持或降低 |

难度必须实际控制：

- 问题来源和技术深度
- 场景复杂度
- 追问数量和追问深度
- 提示开放程度
- 回答时间压力
- 评分标准

每道题单独保存 `difficulty`。自适应模式可以形成类似：

```text
medium → medium → hard → hard → medium
```

自适应调整必须有明确规则和事件记录，不能只依赖模型随机判断。

## 7. 练习与正式模式的反馈区别

| 功能 | 练习模式 | 正式模拟 |
|---|---|---|
| 暂停 | 可以 | 不可以 |
| 立即反馈 | 可以 | 不可以 |
| 提示 | 可以，分级提供 | 不可以 |
| 参考结构 | 可以 | 不可以 |
| 重答 | 可以，多次 | 不可以 |
| 跳过 | 可以并记录 | 可以配置，但必须记录 |
| 笔记 | 可以 | 面试过程中关闭 |
| 计时 | 暂停时停止累计 | 服务端连续计时 |
| 最终报告 | 学习进步报告 | 正式综合评估 |

练习模式的即时反馈只分析当前题目；正式模式的中间结果只保存，不展示给用户，结束后再统一生成报告。

## 8. 实时语音处理

WebSocket 和 Gemini Live 连接只能存在于当前 Cloud Run 实例内，这是临时传输连接，不需要持久化连接对象或原始音频。

必须持久化的是业务状态：

- 每轮语音转写完成后立即追加 `interview_messages`。
- 每道题结束后保存 Session checkpoint。
- 断线重连时从 Supabase 恢复当前问题、必要历史和流程状态。
- 建立新的 Gemini Live 连接，并重新注入当前面试的系统配置和有限上下文。
- 只加载当前 `interviewId` 的岗位快照、简历快照、当前问题和相关历史。
- 不把其他面试或同一用户其他 Session 的内容带入新连接。

原则：

> 实时音频连接可以是临时的，但面试业务状态必须持久化并可恢复。

## 9. 推荐实施顺序

### 第一阶段：消除内存 Session 依赖

1. Session 主键从 `userId` 改为 `interviewId`。
2. 给 `interviews` 增加模式、难度、状态、版本和 checkpoint 字段。
3. 每轮结束保存 checkpoint 和消息。
4. LangGraph 使用 `interviewId` 作为 `thread_id`。
5. Cloud Run 请求不再依赖全局 `Map`。
6. 加入乐观锁和幂等请求。
7. 保留 `transcript_json` 兼容旧记录。
8. 本地验证双会话隔离、后端重启恢复和并发冲突。

### 第二阶段：练习与正式模式

1. 增加 `interview_questions`、`interview_attempts` 和 `interview_notes`。
2. 实现练习模式暂停、恢复、重答、分级提示、掌握和跳过。
3. 实现正式模式服务端截止时间和禁止暂停。
4. 分离练习即时反馈与正式最终反馈。
5. 实现语音断线后的状态恢复和重新连接。

### 第三阶段：增强能力

1. 加入 Adaptive 自适应难度。
2. 加入企业面经 RAG。
3. 建立岗位能力矩阵和可追溯评估依据。
4. 生成跨多场练习的长期进步报告。

## 本地验收标准

在考虑上线前，至少验证：

- 同一用户的两场面试上下文完全隔离。
- 两个标签页或设备不会互相覆盖 Session。
- 后端重启后可以恢复当前问题和流程状态。
- 练习模式可以暂停、恢复、提示、记笔记、重答、掌握和跳过。
- 正式模式不能暂停，关闭页面后服务端计时继续。
- 重复请求不会重复出题、保存回答、扣积分或生成报告。
- 两个后端实例并发处理时不会覆盖状态。
- Easy、Medium、Hard 和 Adaptive 会真实改变问题与追问策略。
- Gemini 调用失败或额度耗尽时，已保存状态不会损坏。
- 语音断线重连后只恢复当前面试的必要上下文。

## 最终架构原则

> Supabase 保存事实和可恢复状态，Cloud Run 负责无状态计算，LangGraph 根据当前 `interviewId` 的持久化状态决定下一步，Gemini 只负责生成和分析内容。
