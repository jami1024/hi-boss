# 设计文档：项目级 Agent 绑定与对话隔离

> 版本: v1.1 draft
> 日期: 2026-03-07
> 状态: 待评审
> 更新: v1.1 — 整合 Edict (三省六部) 项目的设计借鉴

---

## 1. 背景与动机

### 1.1 当前问题

Hi-Boss 当前的 Agent 与 Project 绑定模型存在以下不足：

1. **对话无项目上下文**: Boss 可以与任何 speaker agent 直接对话，但对话不与特定项目关联，导致 agent 无法感知应在哪个项目目录下工作。
2. **workspace 全局固定**: Agent 的 workspace 在注册时设定，无论处理哪个项目的任务都使用同一个 workspace，无法按项目隔离。
3. **leader 调度无约束**: Speaker agent 理论上可以调度任何 leader，没有"项目内 leader 白名单"的约束。
4. **执行路径无限制**: Agent 在执行时可以切换到任意路径，无法强制限制在项目根目录内操作。

### 1.2 目标

- Boss 在**项目上下文**中与项目的 speaker 对话，对话自动携带项目信息。
- Agent 在项目上下文中执行时，**workspace 锁定**为 `project.root`。
- Speaker 在项目上下文中只能**调度该项目绑定的 active leader**。
- 未绑定任何项目的 speaker 仍可自由对话（自由模式）。
- Leader agent 不能被直接对话。

---

## 2. 业界方案调研

### 2.1 CrewAI — Manager-Worker 层级委派

`allowed_agents` 限制可委派 agent 名单 ≈ Hi-Boss 的 `project_leaders` 表。**启发**: 需要运行时强制执行，不仅是数据模型。

### 2.2 OpenClaw — 工作区隔离 + 多 Agent 路由

每个 Agent 独立 workspace + session store，`allowAgents` 约束 spawn，可选 Sandbox 模式。**启发**: 需要"项目级 workspace 覆盖"——同一 agent 在不同项目使用不同 workspace。

### 2.3 Claude Code Agent Teams — 协作式编排

Team Lead + Teammates，共享任务列表 + 邮箱通信，每个 Teammate 有文件边界。**启发**: Speaker = Lead，Leader = Teammate，"文件边界" ≈ 项目根路径约束。

### 2.4 Ruflo/Claude Flow — 分布式 Swarm

Queen-Worker 拓扑 + 60+ 预定义角色。**启发**: 角色越细分，`allowed_agents` 约束越重要。

### 2.5 Forge Code — Git Worktree 沙盒

为每个 agent 任务创建 Git worktree。**启发**: Hi-Boss 的 `project.root` 已是路径级隔离，未来可扩展为 worktree。

### 2.6 Edict (三省六部) — 可借鉴的运维机制

Edict 本身是 12 角色分权制衡架构（基于 OpenClaw runtime），与 Hi-Boss 的 Boss → Speaker → Leader 模型差异较大，整体架构不适用。但其中几个**运维机制**值得借鉴：任务状态机（简化为 5 状态）、Agent 间权限矩阵、停滞检测与故障恢复（简化为 3 阶段）、实时进度上报、远程 Skill 管理（GitHub URL + checksum）。注: Edict 的**强制审核门**不适用——Boss 通过 Chat 自然行使控制权。

---

## 3. 方案总结与选型

| 特性 | CrewAI | OpenClaw | Claude Code Teams | Edict (借鉴机制) | Hi-Boss 现状 | Hi-Boss 目标 |
|------|--------|----------|-------------------|-----------------|-------------|-------------|
| Agent 角色分离 | role + goal | agent list | lead + teammate | 12 固定角色 | speaker + leader | 不变 |
| 可调度 Agent 约束 | `allowed_agents` | `allowAgents` | spawn prompt | `allowAgents` + 权限矩阵 | `project_leaders` (仅数据) | 运行时强制 |
| Workspace 隔离 | 无（无文件执行） | 每 agent 独立 workspace | 每 teammate 文件边界 | 每 agent 独立 workspace | 全局 agent.workspace | 项目级覆盖 |
| 沙盒/路径约束 | N/A | sandbox 模式 | N/A | 无 | 无 | prompt 级约束 |
| 对话上下文关联 | Task 自动传递 | binding 路由 | 共享 task list | 看板 + flow_log | 无 | 项目级 chat |
| 任务状态机 | 无 | 无 | 无 | 9 状态严格递进 | 无 | 项目任务生命周期 |
| 故障恢复 | 无 | 无 | 无 | 4 阶段自动恢复 | idle timeout | 停滞检测 + 自动重试 |
| 进度上报 | 无 | 无 | 无 | 强制 progress 命令 | 无 | 进度报告机制 |
| 远程 Skill | 无 | 无 | 无 | GitHub URL + checksum | 本地 SKILL.md | 远程 skill 管理 |

**选型结论**: 采用 **OpenClaw 的 workspace 覆盖 + CrewAI 的 `allowed_agents` 运行时约束** 的混合模式，适配 Hi-Boss 现有的 envelope 路由架构。从 Edict 中借鉴**任务状态机、停滞检测、进度上报、远程 Skill 管理**等运维机制（简化后适配 local-first 场景），增强可观测性和可靠性。

---

## 4. 详细设计

### 4.1 绑定关系模型

```
┌─────────────────────────────────────────────────────┐
│                     Project                          │
│  id, name, root (workspace 路径)                     │
│                                                      │
│  speaker_agent ──────► Agent (role=speaker)          │
│       │                    │                         │
│       │                    ├── 自由模式: 使用 agent    │
│       │                    │   自身 workspace         │
│       │                    └── 项目模式: 使用 project  │
│       │                        .root 作为 workspace   │
│       │                                              │
│  project_leaders ───► Agent[] (role=leader)          │
│       │                    │                         │
│       │                    └── 只接收来自本项目        │
│       │                        speaker 的 envelope    │
│       │                                              │
│  main_group_channel  (可选, 群消息入口)               │
└─────────────────────────────────────────────────────┘
```

**多重关系**:
```
Speaker A ◄──── Project X ────► Leader 1, Leader 2
Speaker A ◄──── Project Y ────► Leader 2, Leader 3
Speaker B ◄──── Project Z ────► Leader 1
(自由 Speaker C, 无项目绑定)
```

- 一个 Speaker 可服务多个 Project（一对多）。
- 一个 Leader 可服务多个 Project（多对多）。
- 每个 Project 有且只有一个 Speaker。
- Speaker 与 Leader 不能是同一个 Agent。

### 4.2 对话入口与路由

#### 4.2.1 对话入口分类

| 入口 | 适用场景 | 对话目标 | workspace | 可调度 Leader |
|------|---------|---------|-----------|-------------|
| 项目详情页 → Chat | 项目级对话 | 项目的 speaker | `project.root` | 仅该项目 active leaders |
| Agent 列表 → Chat | 自由对话 | 未绑定项目的 speaker | agent 自身 workspace | 任意 leader |
| Leader 详情页 | — | 不可对话 | — | — |

#### 4.2.2 Envelope 元数据扩展

在项目级对话中，envelope 的 metadata 携带项目上下文：

```typescript
{
  from: "channel:web:boss",
  to: "agent:<speaker-name>",
  fromBoss: true,
  content: { text: "..." },
  metadata: {
    source: "web",
    projectId: "prj-xxxxxxxxxxxx",  // 新增: 关联项目 ID
    // 注: 不携带 projectRoot, 由 daemon 从 DB 反查
    // projectRoot 仅存在于 DB 的 projects.root 字段, 不作为 envelope 输入
  }
}
```

> **设计决策**: metadata 中仅携带 `projectId`，`projectRoot` 由 daemon 在运行时从 DB 查询 `projects.root` 获得。这避免了调用方伪造路径的完整性风险，也保证了项目路径变更后无需修改历史 envelope。

#### 4.2.3 项目级 Chat API

新增端点：

```
POST /api/v1/projects/:id/chat/send
  Body: { text: string }
  → 创建 envelope, metadata 仅携带 projectId
  → projectRoot 由 daemon 从 DB 查 projects.root 获得

GET /api/v1/projects/:id/chat/messages?limit=50&before=<ms>
  → 返回该项目上下文的对话记录
    (通过 metadata.projectId 过滤)
  → 注: 需要为 envelopes 表增加 metadata->>projectId 索引 (Phase 1)
```

### 4.3 执行约束

#### 4.3.1 Workspace 覆盖

Agent executor 在读取 envelope 时检查 `metadata.projectId`：

```
如果 envelope.metadata.projectId 存在:
  1. 从 DB 查 project.root
  2. 将本次 run 的 workspace 设为 project.root
  3. 在 system prompt 中注入项目上下文信息
否则:
  使用 agent 自身的 workspace (现有逻辑)
```

> **实现要点 — session 缓存键必须包含 projectId**:
>
> 现有 `AgentExecutor` 的 session 缓存键是 `agentName`（`sessions: Map<string, AgentSession>`），workspace 在 session 创建时固定。如果一个 speaker 服务多个项目，session 缓存会导致 workspace 串线。
>
> 解决方案：将缓存键改为 `agentName:projectId`（无 projectId 时退化为 `agentName`）。项目上下文切换时视为不同 session，各自独立的 workspace、system prompt、session ID：
>
> ```
> sessions.get("nex")              → 自由模式 session
> sessions.get("nex:prj-abc123")   → 项目 abc123 的 session
> sessions.get("nex:prj-def456")   → 项目 def456 的 session
> ```
>
> 同时，session refresh 和 policy check 也需要按此组合键操作。

#### 4.3.2 Leader 调度约束

在 agent session 的 system prompt 中注入项目上下文：

```
## project-context (自动注入, 项目对话时生效)

project-id: prj-xxxxxxxxxxxx
project-name: my-project
project-root: /home/user/projects/my-project
allowed-leaders: leader-a, leader-b
workspace-restriction: 只在 project-root 内操作, 禁止 cd 到其他路径

规则:
- 发送 envelope 只能发给: agent:leader-a, agent:leader-b
- 所有文件操作必须在 /home/user/projects/my-project 内
- 禁止使用 cd 切换到 project-root 之外的目录
```

> **与现有自动 upsert 行为的关系**: 现有 `envelope-handlers.ts` 在 speaker 派发时会自动 `upsertProjectLeader`，隐式扩张白名单。项目上下文中必须禁用：`projectId` 存在时禁止自动 upsert，白名单只能通过 `project.select-leader` API 修改，目标不在白名单中则拒绝路由（Phase 1 即生效）。自由模式保持现有行为。

#### 4.3.3 Leader 间调度权限矩阵 (借鉴 Edict)

当项目有多个 leader 时，可选的权限矩阵约束 leader 间 dispatch。在 `project_leaders` 表增加 `allow_dispatch_to TEXT`（JSON array，null 表示不限制）。

**运行时行为**: leader-A dispatch 给 leader-B 时，若 `allow_dispatch_to` 为 null 则放行，否则检查 leader-B 是否在列表中，不在则拒绝并记录审计日志。

**Prompt 注入**: `you-can-dispatch-to: coder-leader, tester-leader`。

**实施优先级**: P2（Phase 3），与进度上报一同实施。

#### 4.3.4 路由层约束

在 envelope router 层增加硬约束（**Phase 1 即实现**，与项目 Chat 同步交付）：

```typescript
if (envelope.metadata?.projectId) {
  const project = db.getProjectById(envelope.metadata.projectId);
  const sender = parseAddress(envelope.from);
  const target = isAgentAddress(envelope.to) ? parseAddress(envelope.to) : null;

  // 兜底: boss/channel 在项目上下文中只能投递给 project speaker
  if (sender.type !== "agent" && target?.type === "agent") {
    if (target.agentName !== project.speakerAgent) {
      throw new Error(`In project context, boss/channel can only send to speaker '${project.speakerAgent}'`);
    }
  }

  // agent→agent dispatch: 双向校验成员关系
  if (sender.type === "agent" && target?.type === "agent") {
    const senderName = sender.agentName;
    const targetName = target.agentName;
    const activeLeaders = db.getProjectLeaders(project.id)
      .filter(l => l.active).map(l => l.agentName);

    // 发送方校验: sender 必须是该项目的 speaker 或 active leader
    if (senderName !== project.speakerAgent && !activeLeaders.includes(senderName)) {
      throw new Error(`Agent '${senderName}' is not a member of project '${project.name}'`);
    }
    // 目标校验: 回报给 speaker 放行; dispatch 给其他 agent 必须是 active leader
    if (targetName !== project.speakerAgent && !activeLeaders.includes(targetName)) {
      throw new Error(`Agent '${targetName}' is not an active leader of project '${project.name}'`);
    }
  }
}
```

#### 4.3.5 项目上下文强制沙箱

当 envelope 携带 `projectId` 时，execution policy **强制 `workspace-sandbox`**，覆盖现有的 `trusted-boss-channel-input → full-access` 和 `trusted-agent-input → full-access` 策略。reason 记为 `"project-scoped-sandbox"`。

**原因**: 项目上下文中 workspace 被覆盖为 `project.root`，`full-access` 意味着 agent 可修改 project.root 之外的文件。沙箱模式将写入限制在 workspace 内。Codex 的 `--sandbox workspace-write` 提供硬隔离；Claude 的 `--permission-mode default` 依赖 provider 权限确认。

#### 4.3.6 projectId 自动传播

项目上下文中，agent 发出的 envelope 必须自动继承 `projectId`，形成闭环。

**多 envelope 混批问题**: 当前执行模型一次取最多 10 条 pending envelope 组成同一 turn（`executor.ts:183`），且 `getPendingEnvelopesForAgent` 仅按 agent 维度取数，不按 project 分组。如果同一 agent 队列中混入了不同项目的 envelope，会导致 projectId 冲突。

**解决方案：按 projectId 分桶执行**。修改 `getPendingEnvelopesForAgent` 查询逻辑：

```
1. 取第一条 pending envelope, 读取其 projectId (可能为 null)
2. 后续只取相同 projectId 的 envelope (WHERE projectId = ? 或 IS NULL)
3. 不同 projectId 的 envelope 留到下一轮 run 处理
4. 本轮 run 的所有 envelope 共享同一个 projectId 上下文
```

这样 agent 在同一 turn 内只处理一个项目的消息，session/workspace/传播都是一致的。不同项目的消息自然排到后续 turn。

**传播实现**: daemon 在 `envelope.send` RPC 中，从当前 run 的 projectId 上下文（非 agent 输入）自动注入到新 envelope 的 metadata 中。`EnvelopeSendParams` 不暴露 metadata 写入能力，防止 agent 伪造。

**无运行上下文的处理规则**:

当前 RPC 入口只拿到 agent token，没有 run-id 参数，需通过 agent 名查找 running run 来获取 projectId。projectId 注入规则**仅在项目上下文相关场景生效**，不改变现有自由模式行为：

```
场景                               行为                          RPC 错误码
─────────────────────────────────  ────────────────────────────  ──────────────
agent 有 running run + projectId   正常注入 projectId             —
agent 有 running run, 无 projectId 不注入 (自由模式, 行为不变)      —
agent 无 running run               不注入 (自由模式, 行为不变)      —
```

> 设计原则：projectId 传播是**增量行为**——有明确的项目 run 上下文才注入，没有则保持现有行为原样通过。不引入新的拒绝规则，不破坏自由模式。

> **与现有 work-item 系统的关系**: 当前 projectId 传播部分通过 work-item 的 `projectId`/`projectRoot` 字段间接实现。项目上下文机制是对此的显式补充——直接在 envelope metadata 层传播，不依赖 work-item 存在。

### 4.4 提示词与技能的层级设计

> 详细设计见 [prompts-and-skills-tiers.md](./prompts-and-skills-tiers.md)。

| 子章节 | 内容 | 核心要点 |
|--------|------|---------|
| 4.4.1 | 当前层次 (现状分析) | 系统级 (`prompts/`) + Agent 级 (`SOUL.md/MEMORY.md`) + 项目级 (缺失) |
| 4.4.2 | 三层提示词体系 | 系统级 "怎么工作" + Agent 级 "我是谁" + 项目级 "这个项目怎么做" |
| 4.4.3 | 项目级提示词 | `HIBOSS.md` 自动读取注入 system prompt，优先级合并规则 |
| 4.4.4 | 技能 (Skills) | 指令型 SKILL.md (兼容 Claude Code)，三层来源 (项目 > Agent > 系统)，渐进式加载 |
| 4.4.5 | 记忆层级 | Agent 级记忆 (现有) + 项目级共享记忆 (未来) |
| 4.4.6 | 各层级职责总结 | 系统/Agent/项目三层叠加架构 |

### 4.5 数据模型变更

**Phase 1 不修改现有 schema**。当前的 `projects` + `project_leaders` 表已支持所需的绑定关系。Phase 1 仅需为 `envelopes` 表增加 `metadata->>projectId` 索引以支持项目消息查询。

**后续阶段新增 schema**:

| 阶段 | Schema 变更 | 说明 |
|------|------------|------|
| Phase 1 | `envelopes` 表新增索引: `idx_envelopes_project_id` | 按 `json_extract(metadata, '$.projectId')` 过滤项目消息 |
| Phase 2 | 新建 `project_tasks` 表 | 任务状态机 (详见 4.7) |
| Phase 3 | 新建 `task_progress` 表 | 进度上报 (详见 4.8) |
| Phase 3 | `project_leaders` 表新增列: `allow_dispatch_to TEXT` | Leader 间权限矩阵 (详见 4.3.3) |

需要的**运行时行为变更**:

| 层 | 变更 | 优先级 |
|----|------|--------|
| Web API | 新增 `POST/GET /api/v1/projects/:id/chat/send\|messages` | P0 |
| Web UI | 项目详情页增加 Chat 入口 | P0 |
| Web UI | Agent 列表页 Chat 按钮只对无项目绑定的 speaker 显示 | P0 |
| Prompt | 项目对话注入 project-context 指令 | P1 |
| Envelope Router | 项目 leader 白名单校验 + 禁用自动 upsert + boss/channel 投递限制 | P0 |
| Envelope Send RPC | projectId 自动传播 (从 running run 上下文注入) | P0 |
| Execution Policy | 项目上下文强制 `workspace-sandbox` | P0 |
| DB | `envelopes` 表新增 `metadata->>projectId` 索引 | P0 |
| Agent Executor | session 缓存键改为 `agentName:projectId`, 覆盖 workspace | P1 |

### 4.6 UI 交互设计

**项目详情页**: 新增 `[Chat]` 按钮，显示 Speaker、Leaders (active/total)、Root 路径。Leaders 列表支持 Active/Toggle 操作。

**项目级 Chat 页面**: 标题显示项目名 + speaker agent 名，顶部状态栏显示项目根路径。消息区显示 Boss 与 speaker 的对话，底部输入框 + Send 按钮。

**Agent 列表页 Chat 按钮逻辑**: 仅对 `role === "speaker"` 且未绑定任何项目的 agent 显示 Chat 按钮。绑定了项目的 speaker 需通过项目详情页进入 Chat。

### 4.7 - 4.10 借鉴 Edict 的运维扩展功能

> 以下功能借鉴自 [Edict](https://github.com/jami1024/edict) 项目中适用于 local-first 场景的运维机制。
> 详细设计见 [edict-inspired-extensions.md](./edict-inspired-extensions.md)。

| 章节 | 功能 | 核心内容 | 实施阶段 |
|------|------|---------|---------|
| 4.7 | 项目任务生命周期 | 任务状态机 (`created -> planning -> dispatched -> executing -> completed`)、任务与 agent 运行状态分离、取消机制（复用现有 `abortCurrentRun`）、`project_tasks` 表、自动派发 | Phase 2 (P1) |
| 4.8 | 实时进度上报 | Agent prompt 注入进度上报指令、`task_progress` 表、统一活动流看板展示 | Phase 3 (P2) |
| 4.9 | 停滞检测与故障恢复 | 三阶段恢复（自动重试 -> 通知 Boss -> 自动回退）、可配置 `StallPolicy` | Phase 3 (P2) |
| 4.10 | 远程 Skill 管理 | CLI/API/UI 三种管理方式、GitHub URL 下载 + checksum 校验 + 版本追踪 | Phase 4 (P3) |

---

## 5. 实施计划

### Phase 1: 项目级对话基础 + 路由硬约束 (P0)

1. 后端：新增 `POST /api/v1/projects/:id/chat/send` 和 `GET /api/v1/projects/:id/chat/messages`
2. 前端：项目详情页增加 Chat 按钮，进入项目级 Chat 页面
3. 前端：Agent 列表页 Chat 按钮仅对未绑定项目的 speaker 显示
4. Envelope metadata 携带 `projectId`（不携带 `projectRoot`，由 daemon 反查）
5. **DB**: 为 `envelopes` 表新增 `metadata->>projectId` 索引
6. **路由层硬约束**: 项目上下文中 envelope router 检查 agent→agent dispatch 是否在白名单中（speaker 回报放行）
7. **禁用自动 upsert**: 项目上下文中 envelope 发送不再自动 `upsertProjectLeader`
8. **projectId 自动传播**: agent 发送 envelope 时 daemon 自动注入当前项目上下文的 projectId
9. **强制沙箱**: 项目上下文中 execution policy 强制 `workspace-sandbox`，不允许 `full-access` bypass

> 安全边界原则：路由层硬约束必须与项目 Chat 在同一阶段交付。不允许出现"有项目 Chat 但无硬约束"的中间状态。

### Phase 2: 项目级提示词 + 执行约束 + 任务生命周期 (P1)

1. Agent executor 读取 `metadata.projectId`，覆盖 workspace 为 `project.root`（从 DB 反查）
2. Session 缓存键改为 `agentName:projectId`，避免多项目 speaker workspace 串线
3. System prompt 注入 project-context 指令（项目信息、allowed leaders、workspace 限制）
4. 自动读取 `<project.root>/HIBOSS.md`，注入 system prompt 作为项目级指令
5. 自动提取 `<project.root>/package.json` scripts 作为项目级 skills 信息
6. 前端 Chat 页面显示项目上下文信息（项目名、根路径、可用 leaders）
7. **新增**: 创建 `project_tasks` 表，实现任务状态机 (4.7)
8. **新增**: 状态变更时自动派发 envelope (4.7.6)

### Phase 3: 权限矩阵 + 进度上报 + 故障恢复 (P2)

1. **新增**: `project_leaders` 表增加 `allow_dispatch_to` 列，Leader 间调度权限矩阵 (4.3.3)
2. **新增**: 创建 `task_progress` 表，实现进度上报机制 (4.8)
3. **新增**: Agent prompt 注入进度上报指令
4. **新增**: 停滞检测 + 三阶段恢复策略 (4.9)
5. **新增**: Web UI 任务详情页展示统一活动流
6. 审计日志记录白名单违规尝试

### Phase 4: 项目级共享记忆 + 高级功能 (P3, 可选)

1. 引入 `<project.root>/.hiboss/memory/` 作为项目级共享记忆
2. 同一项目的所有 agent 可读写该记忆空间
3. 在 system prompt 中注入项目级记忆快照
4. **新增**: 远程 Skill 管理——CLI + API + Web UI (4.10)
5. **新增**: 项目级/Agent 级 Skills 扫描 + 摘要注入 (4.4.4)

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Prompt 级 workspace 约束可被 agent 忽略 | Agent 可能切出项目路径 | Phase 1 路由层硬约束 + provider permission-level 限制 |
| Speaker 同时服务多个项目时上下文混淆 | 不同项目的对话可能交叉 | session 缓存键改为 `agentName:projectId`, 各项目独立 session |
| 自由 Speaker 转为项目绑定后, 历史对话如何处理 | 用户困惑 | 无 projectId 的历史消息保持可见, 但在项目 Chat 中不显示 |
| Leader 被多个项目共享时, 并发冲突 | 同一 leader 同时执行不同项目的任务 | Hi-Boss 已有的 agent 执行队列机制保证串行执行 |
| 停滞检测误判 (agent 正常工作但未上报进度) | 不必要的重试干扰 agent | 结合 agent run 状态检查 (running 时不触发), 初始 stallThreshold 设较大值 (300s) |
| 权限矩阵增加配置复杂度 | 用户上手成本 | `allow_dispatch_to` 默认为 null (不限制), 仅需要时才配置 |
| 远程 Skill 下载安全风险 | 恶意 SKILL.md 注入不安全指令 | checksum 校验 + 仅支持 HTTPS + 下载后可人工审查 |
| 项目消息查询性能 | envelopes 表无 projectId 索引时全表扫描 | Phase 1 新增 `metadata->>projectId` 索引 |

---

## 7. 与现有架构的兼容性

### 7.1 不变的部分

- Agent 注册和管理流程不变
- CLI 命令 (`hiboss envelope send/list`, `hiboss project list/get`) 不变
- Telegram/Feishu adapter 行为不变
- 非项目上下文的对话行为不变（包括自动 upsert）

### 7.2 新增的部分

- Web API: 2 个新端点（项目级 chat send/messages）
- Web UI: 项目详情页 Chat 入口 + 项目级 Chat 页面
- Envelope metadata: `projectId` 字段（不含 `projectRoot`）
- Envelope router: 项目 leader 白名单硬约束 — agent→agent dispatch 仅允许白名单 leader + speaker 回报 (Phase 1)
- Envelope router: 项目上下文禁用自动 upsertProjectLeader (Phase 1)
- Envelope Send RPC: projectId 自动传播 — agent 发 envelope 时从 running run 上下文注入 (Phase 1)
- Execution policy: 项目上下文强制 `workspace-sandbox` (Phase 1)
- DB: `envelopes` 表新增 `metadata->>projectId` 索引 (Phase 1)
- Agent executor: session 缓存键改为 `agentName:projectId` (Phase 2)
- Agent executor: 项目上下文 workspace 覆盖逻辑 (Phase 2)
- System prompt: 项目上下文指令注入 (Phase 2)
- DB: `project_tasks` 表 (Phase 2)
- DB: `task_progress` 表 (Phase 3)
- DB: `project_leaders` 表新增 `allow_dispatch_to` 列 (Phase 3)
- Scheduler: 停滞检测 + 三阶段恢复 (Phase 3)
- CLI/API/UI: 远程 Skill 管理 (Phase 4)

### 7.3 CLI 兼容性

未来可扩展 CLI 命令支持项目级对话: `hiboss envelope send --to agent:worker-agent --project-id prj-xxx --text "..."`。`--project-id` 仅限 boss token 使用，daemon 校验 token 权限和项目成员关系。Agent token 不允许指定 `--project-id`（projectId 由 daemon 从当前 run 上下文自动注入）。

---

## 8. 待定问题

落地前需确认的设计假设：

| # | 问题 | 背景 | 决策 |
|---|------|------|------|
| Q1 | `project.select-leader` 的 workspace 匹配放宽 | 现有实现要求 `agent.workspace === project.root` 才能被选中（`project-handlers.ts:135`）。引入"运行时覆盖 workspace"后，leader 注册时的 workspace 不再需要等于 project.root。 | **已决定放宽**: 只要 leader 在项目白名单中且 active，不再检查 `agent.workspace`。workspace 由运行时从 `projects.root` 覆盖。Phase 2 实施时同步修改 `project-handlers.ts:135` 的过滤条件。 |
| Q2 | Leader-to-leader dispatch 的边界？ | 文档说"Leader 不可直接对话"（1.2），但 4.3.3 允许 leader 间 dispatch。需要更精确的定义。 | 区分两种 dispatch: (1) **工作项内中继** — leader-A 在执行任务时 dispatch 给 leader-B，envelope 携带 taskId，允许；(2) **自由 envelope** — 无 taskId 的 leader 间 envelope，在项目上下文中禁止。"不可直接对话"指 Boss 不能与 leader 发起 Chat，不限制 leader 间的工作项中继。 |
| Q3 | 4.7-4.10 是否独立为后续 RFC？ | v1.1 把状态机、停滞恢复、远程 skill 一并拉入主方案，P0 交付可能被拖慢。 | 建议：主文档保留架构全景和 summary 表（当前已拆分到 `edict-inspired-extensions.md`），但 Phase 1 交付范围严格限定在上述 7 项。4.7-4.10 的实现在 Phase 2/3/4 各自独立交付，按需启动。 |

---

## 9. 参考资料

- [CrewAI Hierarchical Process](https://docs.crewai.com/en/learn/hierarchical-process) — Manager-Worker 层级委派
- [CrewAI `allowed_agents` PR](https://github.com/crewAIInc/crewAI/pull/2068) — 限制可委派对象
- [OpenClaw Multi-Agent Routing](https://openclawlab.com/en/docs/concepts/multi-agent/) — 多 agent 路由 + workspace 隔离
- [Claude Code Agent Teams](https://claudefa.st/blog/guide/agents/agent-teams) — 协作式多 agent 编排
- [Ruflo/Claude Flow](https://github.com/ruvnet/ruflo) — 分布式 swarm 编排
- [Forge Code Sandbox](https://forgecode.dev/docs/sandbox-feature/) — Git Worktree 隔离
- **[Edict / 三省六部](https://github.com/jami1024/edict)** — 制度化多 Agent 协作: 严格状态机 + 权限矩阵 + 故障恢复 + 进度上报
- [Edict 任务分发流转架构](https://github.com/jami1024/edict/blob/main/docs/task-dispatch-architecture.md)
- Hi-Boss 现有架构: `docs/spec/architecture.md`, `docs/spec/definitions.md`
