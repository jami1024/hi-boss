# 设计文档：借鉴 Edict 的运维扩展功能

> 本文档是 [project-scoped-agent-binding.md](./project-scoped-agent-binding.md) 的扩展部分。
> 参考来源: [Edict](https://github.com/jami1024/edict) 项目。Edict 整体架构（12 角色分权制衡 + OpenClaw runtime）与 Hi-Boss 差异较大，本文档仅借鉴其中适用于 local-first 场景的运维机制，并做了简化适配。

---

## 4.7 项目任务生命周期

> 借鉴点: Edict 的 9 状态状态机 + `STATE_AGENT_MAP` 自动派发。Hi-Boss 简化为 5 状态，去掉强制审核门。

### 4.7.1 动机

Hi-Boss 当前的 envelope 是"一次性消息"--发送后由 agent 处理，但缺少**任务级别**的生命周期管理。对于复杂的项目任务（涉及多个 leader 协作），需要知道：
- 任务当前在哪个阶段？
- 谁在负责？
- 卡住了多久？

### 4.7.2 任务状态机

```
created --> planning --> dispatched --> executing --> completed
   |            |             |              |
   +------------+-------------+--------------+
                        |
                    cancelled
```

| 状态 | 含义 | 负责角色 |
|------|------|---------|
| `created` | Boss 下达任务 | -- |
| `planning` | Speaker 分析和规划 | speaker |
| `dispatched` | Speaker 已派发给 leader | speaker |
| `executing` | Leader 执行中 | leader |
| `completed` | 任务完成 | -- |
| `cancelled` | 任务取消（任意状态可触发） | boss |

**与 Edict 的差异**: Hi-Boss 不硬编码固定角色链和强制审核门。Boss 通过 Chat 自然行使控制权——随时可以看到 Speaker 的规划、随时可以打断或取消。不需要形式化的审批流程。

### 4.7.3 任务与 Agent 运行状态分离

任务状态（调度层）和 Agent 运行状态（进程层）是**两个独立维度**：

```
┌─ 任务 (task) ──────────────────────────────────────────┐
│  state: executing                                       │
│  assignee: coder-leader                                 │
│                                                         │
│  ┌─ Agent 运行 (agent run) ──────────────────────────┐  │
│  │  run-state: running                                │  │
│  │  pid: 12345                                        │  │
│  │  started-at: 2026-03-07T10:30:00Z                  │  │
│  │  elapsed: 3m 20s                                   │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

UI 在任务详情页同时展示两层信息，Boss 可以清楚看到任务在哪个阶段、agent 是否还在跑。

### 4.7.4 任务取消机制

Boss 取消任务时有两个操作：

| 操作 | 效果 | 适用场景 |
|------|------|---------|
| **Cancel Task** | task → `cancelled`，排队中的 envelope 标记 skip，不发新 envelope 给 agent，正在跑的 agent 自然结束 | 默认操作，已完成的工作保留 |
| **Force Stop Agent** | Cancel Task + 直接终止 agent 子进程 | 紧急情况，agent 做到哪算哪 |

**核心原则**: 取消是对调度系统说的，不是对 agent 说的。不会给 agent 发"任务已取消"的 envelope，避免 agent 把已完成的工作全部撤销。

#### 与现有 abort 机制的映射

Hi-Boss 已有完整的 agent abort 基础设施（`AgentExecutor.abortCurrentRun`），任务取消直接复用：

```
现有机制                              任务取消复用
──────────                           ──────────────
AgentExecutor.abortCurrentRun()  →   Force Stop 的底层实现
  - AbortController.abort()            终止子进程 (SIGTERM)
  - process.kill(-pid, "SIGTERM")      杀进程组
  - db.cancelAgentRun(runId)           记录 run 取消
db.markDuePendingEnvelopesDone() →   Cancel Task 跳过排队 envelope
```

**Cancel Task 实现流程**:

```
1. task.state → cancelled, 记录 flow_log
2. 查找该 task 关联的排队 envelope (metadata.taskId 匹配)
3. 调用 db.markDuePendingEnvelopesDone(envelopeIds) 跳过
4. 如果 agent 正在执行该 task 的 envelope → 不干预, 跑完自然停
5. 后续自动派发逻辑检查 task.state, cancelled 则跳过
```

**Force Stop Agent 实现流程**:

```
1. 执行上述 Cancel Task 全部步骤
2. 额外调用 executor.abortCurrentRun(agentName, "task-cancelled:<taskId>")
   → AbortController.abort()
   → SIGTERM 子进程组
   → executeCliTurn resolve 为 status: "cancelled"
   → db.cancelAgentRun(runId, reason)
```

**调用入口** (扩展现有):

| 入口 | Cancel Task | Force Stop |
|------|------------|------------|
| **Web UI** | 任务详情页 `[Cancel Task]` 按钮 | 任务详情页 `[Force Stop Agent]` 按钮 |
| **CLI** | `hiboss task cancel --id <task-id>` | `hiboss task cancel --id <task-id> --force` |
| **API** | `POST /api/v1/tasks/:id/cancel` | `POST /api/v1/tasks/:id/cancel?force=true` |
| **Telegram** | — | 现有 `/abort <agent>` 已可用（agent 级别，不感知 task） |

### 4.7.5 数据模型

```sql
CREATE TABLE IF NOT EXISTS project_tasks (
  id          TEXT PRIMARY KEY,       -- task-<short-uuid>
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'created',
  priority    TEXT DEFAULT 'normal',  -- low | normal | high | critical
  assignee    TEXT,                   -- 当前负责的 agent name
  output      TEXT,                   -- 最终产出 (URL/路径/摘要)
  flow_log    TEXT,                   -- JSON: 状态流转记录
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  completed_at INTEGER
);
```

### 4.7.6 自动派发

类似 Edict 的 `STATE_AGENT_MAP`，状态变更时自动创建 envelope 给下一个 agent：

```
created    --> 创建 envelope 给 speaker, metadata 携带 taskId
dispatched --> 创建 envelope 给 leader, metadata 携带 taskId + 任务说明
completed  --> 通知 boss (通过 speaker 回复)
```

**实施优先级**: P1（Phase 2）。

---

## 4.8 实时进度上报

> 借鉴点: Edict 的 `progress` 命令上报 + 三层数据融合。Hi-Boss 简化为 envelope 上报 + daemon 自动注入 metadata。

### 4.8.1 动机

当 agent 执行一个需要数小时的复杂任务时，boss 在看板上只能看到"running"状态，无法了解具体进展。

### 4.8.2 进度上报工具

在 agent prompt 中注入一个进度上报指令：

```
## progress-reporting (项目任务上下文自动注入)

当你在执行项目任务时，在每个关键步骤通过 envelope 上报进度:

hiboss envelope send \
  --to agent:<speaker-name> \
  --text "progress: <当前在做什么>\ntodos: <计划1 done|计划2 doing|计划3>"

注: taskId 和 type:"progress" 由 daemon 自动注入 envelope metadata（从当前 run 的任务上下文继承），agent 无需手动指定。

什么时候必须上报:
1. 开始分析任务需求时
2. 方案/计划制定完成时
3. 关键子任务完成时
4. 遇到阻塞时
5. 全部完成准备回报时
```

### 4.8.3 进度存储

```sql
CREATE TABLE IF NOT EXISTS task_progress (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES project_tasks(id),
  agent_name  TEXT NOT NULL,
  content     TEXT NOT NULL,         -- 进度描述
  todos       TEXT,                  -- JSON: 当前 todo 快照
  created_at  INTEGER NOT NULL
);
```

### 4.8.4 看板展示

Web UI 项目任务详情页展示统一活动流：

```
kind      含义
---------------------------------
flow      状态流转 (created --> planning --> ...)
progress  Agent 进展汇报 (实时文字描述)
todos     待办快照 (进度条可视化)
envelope  相关 envelope 历史
```

**实施优先级**: P2（Phase 3）。

---

## 4.9 停滞检测与故障恢复

> 借鉴点: Edict 的四阶段故障恢复（重试 → 升级 L1 → 升级 L2 → 自动回滚）。Hi-Boss 简化为三阶段，适配 local-first 场景。

### 4.9.1 动机

当 leader agent 进程崩溃、LLM provider 超时或 agent 进入无限循环时，任务会停滞。需要自动检测并恢复。

### 4.9.2 停滞检测

```
检测条件:
  任务 state 不在 (completed, cancelled)
  AND 距离上次 progress 上报 > stallThreshold (默认 300s)
  AND 当前 agent run 状态不是 running
```

### 4.9.3 恢复策略

Hi-Boss 采用**简化版**的三阶段恢复（相比 Edict 的四阶段更适合 local-first 场景）：

```
阶段 1: 自动重试 (T + stallThreshold)
  - 重新创建 envelope 给当前负责的 agent
  - 记录 flow_log: "停滞 N 秒, 自动重试"

阶段 2: 通知 Boss (T + stallThreshold * 2)
  - 通过 speaker 给 boss 发送通知: "任务 xxx 长时间未进展"
  - Boss 可选择: 手动干预 / 取消 / 继续等待

阶段 3: 自动回退 (T + stallThreshold * 3, 可选)
  - 将任务状态回退到上一个稳定状态
  - 重新派发给 speaker 处理
```

### 4.9.4 配置

在项目级或全局可配置：

```typescript
interface StallPolicy {
  stallThresholdSec: number;   // 默认 300 (5 分钟)
  maxRetry: number;            // 默认 1
  autoRollback: boolean;       // 默认 false
  notifyBoss: boolean;         // 默认 true
}
```

**实施优先级**: P2（Phase 3）。

---

## 4.10 远程 Skill 管理

> 借鉴点: Edict 的 `skill_manager.py` — 从 GitHub URL 下载 SKILL.md，带 checksum 和版本追踪。

### 4.10.1 管理方式

支持三种管理方式（参考 Edict 设计）：

| 方式 | 使用场景 |
|------|---------|
| **CLI** | `hiboss skill add-remote --agent <name> --name <skill> --source <url>` |
| **Web UI** | 项目/Agent 设置页 -> 技能管理 -> 添加远程技能 |
| **API** | `POST /api/v1/agents/:name/skills/remote` |

### 4.10.2 远程 Skill 元数据

每个远程 skill 在本地存储 `.source.json`：

```json
{
  "skillName": "code-review",
  "sourceUrl": "https://raw.githubusercontent.com/.../SKILL.md",
  "description": "...",
  "addedAt": "2026-03-07T10:00:00Z",
  "lastUpdated": "2026-03-07T10:00:00Z",
  "checksum": "a1b2c3d4e5f6g7h8",
  "status": "valid"
}
```

### 4.10.3 CLI 命令设计

```bash
# 添加远程 skill
hiboss skill add-remote --agent nex --name code-review \
  --source https://raw.githubusercontent.com/.../SKILL.md

# 列出所有远程 skills
hiboss skill list-remote

# 更新远程 skill 到最新
hiboss skill update-remote --agent nex --name code-review

# 移除远程 skill
hiboss skill remove-remote --agent nex --name code-review
```

**实施优先级**: P3（Phase 4）。
