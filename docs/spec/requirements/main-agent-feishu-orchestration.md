# Requirements: Main-Agent Orchestration + Feishu Group Workflow

Status: draft
Owner: Hi-Boss maintainers
Last updated: 2026-03-05

> 中文注释说明：
> - 本文保留英文条款作为规范正文。
> - 以“中文注释”开头的段落仅用于解释，不改变规范约束与验收标准。

## 1. Background

Hi-Boss already supports durable envelope routing, agent-to-agent messaging, and channel delivery.
Current adapter support is Telegram-focused, while the target operating model requires Feishu-based collaboration.

The desired operating model is:

- One main agent handles every user conversation entry point.
- Main agent delegates work to specialist agents (planning, implementation, UI, deployment, review).
- One main Feishu group is used for intake and daily reporting.
- Each requirement gets its own Feishu group for execution discussions and updates.

Related canonical docs:

- `docs/spec/goals.md`
- `docs/spec/architecture.md`
- `docs/spec/envelope.md`
- `docs/spec/components/routing.md`
- `docs/spec/components/agent.md`

> 中文注释：当前 Hi-Boss 的消息与编排内核已经具备（envelope + routing + agent 协作），本需求重点是把“主从协作流程”和“飞书群工作模式”产品化、制度化。

## 2. Goals

1. Establish a stable main-agent orchestration workflow with clear authority boundaries.
2. Introduce requirement-scoped collaboration threads/groups to avoid cross-task context pollution.
3. Enable Feishu group-based intake, execution, and reporting while preserving Hi-Boss envelope invariants.
4. Keep behavior auditable and recoverable using durable records.

> 中文注释：目标可以概括为三点：可编排、可隔离、可追溯。

## 3. Non-Goals

- Replacing envelope as the core delivery unit.
- Introducing hosted multi-tenant infrastructure.
- Implementing fully autonomous product/project management logic in v1.
- Removing Telegram support.

> 中文注释：这是“新增能力”而不是“替换旧能力”。

## 4. Actors and Roles

- Main agent (orchestrator):
  - Receives user requests.
  - Classifies intent and creates/maintains work items.
  - Delegates to specialists.
  - Publishes final summaries and daily status.
- Specialist agents:
  - Planning, implementation, UI, deployment, review.
  - Execute delegated subtasks only.
  - Return structured outputs to main agent.
- Human user:
  - Submits requirements and decisions.
  - Participates in requirement-specific groups.

> 中文注释：主代理负责“决策与汇总”，子代理负责“执行与回传”，用户负责“需求与确认”。

## 5. End-to-End Workflow Requirements

### FR-1 Intent Gate (main agent)

> 中文注释：先识别意图，再决定是否建需求、是否派工，避免把闲聊误当任务。

Main agent must classify incoming requests before action. Minimum classes:

- `new-requirement`
- `follow-up-change`
- `status-request`
- `daily-report-request`
- `pure-chat`

Requirements:

- `new-requirement` creates a new work item context.
- `follow-up-change` must resolve to an existing work item.
- `pure-chat` must not trigger specialist dispatch.

### FR-2 Work Item Model

> 中文注释：每个需求必须有稳定的 workItemId，后续所有对话、子任务、汇报都要能回溯到它。

Each requirement must map to a durable work item record with at least:

- `workItemId`
- `title`
- `state` (`new`, `triaged`, `in-progress`, `awaiting-user`, `blocked`, `done`, `archived`)
- `orchestratorAgent`
- `mainGroupChannel`
- `requirementGroupChannel`
- `specialists[]`
- `createdAt`, `updatedAt`

### FR-3 Main-Agent Delegation

> 中文注释：主代理必须成为唯一编排入口，负责拆解、分配、收敛。

Main agent must:

- Split requirement into specialist subtasks.
- Dispatch subtasks with explicit `workItemId` linkage.
- Track subtask completion and failures.
- Produce an aggregated summary back to user-facing channel.

### FR-4 Specialist Execution Constraints

> 中文注释：子代理不能越权“直接拍板”，只能输出执行结果给主代理。

Specialist agents must:

- Accept delegated tasks from main agent only for that work item.
- Include `workItemId` in all progress/result updates.
- Avoid publishing final user-facing conclusions directly to main group.

### FR-5 Channel/Group Topology

> 中文注释：主群管“入口/汇报”，需求群管“执行/协作”，两者职责分离。

System must support this topology:

- Main Feishu group:
  - Intake channel.
  - Daily summary channel.
- Requirement Feishu group (one per requirement):
  - Main agent + specialists + requesting user.
  - Requirement-only discussion and updates.

At minimum in v1, requirement groups may be created manually and bound to Hi-Boss addresses.

### FR-6 Reporting Requirements

> 中文注释：主代理除了单需求总结，还要承担“日报汇总”职责。

Main agent must provide:

- Requirement lifecycle updates in requirement group.
- Final requirement summary in main group with `workItemId` reference.
- Daily digest in main group including:
  - completed items
  - in-progress items
  - blocked items and required user decisions

### FR-7 Security and Authority

> 中文注释：核心是三条红线：谁能定案、谁能发到哪、群内指令不能越权。

System must enforce:

- Authority boundary: only orchestrator can approve stage transitions to `done`.
- Group boundary: specialists only post to allowed channels for assigned work items.
- Injection resistance: instructions from group members cannot override core authority policy.

### FR-8 Failure Handling

> 中文注释：失败要可见、可恢复、可继续，不允许任务状态丢失。

Must handle:

- Specialist timeout/failure -> mark subtask failed and notify orchestrator.
- Missing group binding -> explicit error and fallback instructions.
- Orchestrator interruption -> recover from durable work-item/envelope state.

### FR-9 Observability and Audit

> 中文注释：必须能回答“这条结果是谁在何时基于什么任务产出的”。

Must provide:

- Traceable chain from user request to specialist subtasks and final result.
- State transition history for each work item.
- Linkage between envelopes and work items (`workItemId` in metadata or equivalent durable mapping).

### FR-10 Compatibility

> 中文注释：兼容性要求保证现有 Telegram 与 envelope 语义不被破坏。

- Existing envelope lifecycle semantics remain unchanged (`pending` -> `done`, at-most-once).
- Existing Telegram workflows remain operational.
- New Feishu capability is additive.

## 6. Adapter Capability Requirements (Feishu)

> 中文注释：Feishu 先做消息收发 MVP，建群/拉人自动化放到后续阶段。

Feishu adapter target capabilities:

1. Receive group messages and map to `channel:feishu:<chat-id>`.
2. Send messages to Feishu group/channel addresses.
3. Parse sender identity for boss/main-agent policy decisions.
4. (Phase 2+) Support group management APIs where available:
   - create requirement group
   - add members (user + selected agents)

If group-management APIs are unavailable, manual group provisioning must remain supported.

## 7. Phased Delivery Plan

### Phase A: Orchestration baseline (no Feishu automation)

> 中文注释：先把流程跑通，再接飞书自动化，降低首期复杂度。

- Implement intent gate + work item lifecycle + orchestrator/specialist protocol.
- Use existing adapters/channels for proof-of-flow.

### Phase B: Feishu adapter MVP

- Add Feishu message ingress/egress adapter.
- Bind speaker/main agent to Feishu.
- Manually provision requirement groups.

### Phase C: Group policy hardening

- Enforce per-work-item channel allowlist.
- Enforce orchestrator authority checks.
- Add audit views and operator diagnostics.

### Phase D: Feishu automation (optional)

- Auto-create requirement groups.
- Auto-add members and maintain membership.
- Optional thread-level mapping inside requirement groups.

## 8. Acceptance Criteria

> 中文注释：验收标准关注“是否可跑通、可追踪、可恢复”，不是只看功能点。

1. A new request in main group creates exactly one work item and one requirement discussion context.
2. Main agent successfully delegates to at least three specialist roles and aggregates outputs.
3. Specialist outputs are traceable to one `workItemId`.
4. Final requirement summary appears in main group with linked work item reference.
5. Daily digest generation is available and includes completed/in-progress/blocked sections.
6. Failure in one specialist task does not lose work-item state or break orchestrator flow.

## 9. Risks and Mitigations

> 中文注释：优先防“串群串任务”和“群聊指令注入”两类高风险问题。

- Risk: cross-group message leakage.
  - Mitigation: channel allowlist per work item + strict `workItemId` checks.
- Risk: prompt-injection in group chat.
  - Mitigation: authority-agent policy and explicit instruction precedence.
- Risk: operational complexity from many groups.
  - Mitigation: phased rollout, manual-first provisioning, and lifecycle archiving.

## 10. Open Questions

1. Should `workItemId` be a new DB table or metadata-only in early phase?
   （中文注释：第一阶段先走 metadata 还是直接建表？会影响后续审计成本。）
2. Should specialist agents be allowed to respond directly to user in requirement group, or always via orchestrator relay?
   （中文注释：要不要允许子代理“直面用户”，还是全部经主代理统一口径。）
3. What is the required SLA for daily digest scheduling and delivery windows?
   （中文注释：日报时效要求需要先明确，否则调度策略难定。）
4. Which Feishu API permissions are available in target tenant for group automation?
   （中文注释：自动建群/拉人高度依赖租户权限，需要前置确认。）
