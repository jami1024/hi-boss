# Proposal: Project-Scoped Speaker + Multi-Leader Orchestration

Status: proposed (implementation-ready)
Owner: Hi-Boss maintainers
Last updated: 2026-03-06

> 中文注释说明：
> - 本文保留英文条款作为规范正文。
> - 以“中文注释”开头的段落仅用于解释，不改变规范约束。

Related docs:
- `docs/spec/requirements/main-agent-feishu-orchestration.md`
- `docs/spec/requirements/main-agent-feishu-orchestration-audit.md`
- `docs/spec/components/routing.md`
- `docs/spec/components/agent.md`

## 1. Intent

> 中文注释：目标是把“每项目一个 speaker + 多个 leader 分工”从提示词习惯升级为系统硬约束，避免串项目、串线程、串权限。

Define a practical operating model for multi-project collaboration:

1. One `speaker` is the single user-facing orchestrator for one project.
2. Multiple `leader` agents are attached to that same project and split by capability (for example: analysis, implementation, UI, deployment, review).
3. Routing and authority must be enforced by daemon rules, not prompt discipline only.

## 2. Why This Plan

> 中文注释：当前主要风险不是功能缺失，而是“约束落在提示词里而不是守卫逻辑里”；本方案重点是把这些约束下沉到 daemon。

Current behavior is workable but partially policy-driven. The audit shows key gaps:

- project isolation is not a hard runtime boundary yet;
- orchestrator/specialist relation is not fully enforced in daemon;
- work-item audit history is not append-only.

This plan closes those gaps while preserving the existing envelope model and adapter compatibility.

## 3. Target Operating Model

> 中文注释：运行模型是“speaker 负责对人沟通和收敛，leader 负责执行和回传，且都在项目边界内活动”。

### 3.1 Project Ownership

- Each project has exactly one active `speaker`.
- A project can have multiple `leader` agents.
- Every `leader` in a project uses a workspace that belongs to that project root.

### 3.2 Authority

- `speaker`: intake, user communication, orchestration, final summary.
- `leader`: execution and progress/result feedback to `speaker`.
- Only orchestrator authority can close requirement stages to `done`.

### 3.3 Communication Topology

- Main group: intake + cross-requirement reporting.
- Requirement group: requirement-scoped execution discussion.
- In strict mode, requirement channel boundaries are enforced per work item.

## 4. Required Hard Constraints

> 中文注释：这四条是红线，必须由运行时直接拒绝违规请求，不能仅靠 agent 自觉遵守。

1. No cross-project delegation for work-item traffic.
2. No cross-project reply-to inheritance.
3. Specialist updates must be linked to delegated `work-item-id`.
4. User-facing final summary is emitted by `speaker` (relay allowed, but owner is speaker).

## 5. Data Model Additions

> 中文注释：先在 work item 维度补齐最小字段，再视规模上升为项目一等实体（projects）。

## 5.1 Phase A (minimal schema extension)

Extend work-item persistence with explicit orchestration fields:

- `projectId`
- `projectRoot`
- `orchestratorAgent`
- `mainGroupChannel`
- `requirementGroupChannel`

Add a separate relation table for specialists per work item:

- `work_item_specialists(work_item_id, agent_name, capability, assigned_at, assigned_by)`

Add append-only transition history:

- `work_item_transitions(id, work_item_id, from_state, to_state, actor, reason, created_at)`

## 5.2 Phase B (first-class project model)

Introduce a `projects` aggregate:

- `projects(id, name, root, speaker_agent, main_group_channel, created_at, updated_at)`
- `project_leaders(project_id, agent_name, capabilities_json, active)`

Work items reference `project_id` as required foreign key.

## 6. Runtime Enforcement Rules

> 中文注释：核心思路是“发送前校验 + 委派关系校验 + 完结权限校验”三层守卫。

## 6.1 Envelope Send Guards

When `work-item-id` is present:

1. Resolve work item and project context.
2. Verify sender agent is in same project membership.
3. Verify destination channel is allowed by work-item policy.
4. Reject if `reply-to` chain points to different project context.

## 6.2 Delegation Guards

When `speaker` delegates to a `leader`:

- persist delegated assignment relation (`work_item_specialists`);
- require subsequent specialist updates to match that relation.

When `leader` sends a completion update:

- require matching `work-item-id`;
- require same `projectId`;
- require reply chain to a known delegated envelope.

## 6.3 Completion Guards

- `done` transition remains leader/orchestrator-authorized only.
- `speaker` must include source attribution when relaying specialist output.

## 7. Capability-Based Leader Selection

> 中文注释：先按项目过滤，再按能力匹配，最后按健康度与稳定优先级选择，避免“能跑但跑错人”。

Leader selection order:

1. Filter by same project membership.
2. Filter by required capability tags.
3. Prefer healthy/idle agent.
4. Break ties by deterministic priority (config order or stable sort key).

Fallback behavior:

- If no eligible leader exists, return explicit setup blocker (do not guess project/workspace).

## 8. Boss Input UX Rules

> 中文注释：继续保持低输入负担。老板只需自然语言，结构化字段由系统和代理内部补齐。

To keep boss interaction lightweight:

- accept natural language by default;
- infer target work item from thread (`reply-to`) first;
- auto-create `work-item-id` for new requirement when missing;
- keep structural fields internal to agent-to-agent envelopes.

## 9. Observability and Recovery

> 中文注释：必须能回答“谁在何时因何状态迁移”，并在失败后可恢复继续，而不是丢状态重来。

Required operator visibility:

- full request -> delegation -> specialist -> final-summary chain;
- append-only state transition history per work item;
- per-project queue and health diagnostics.

Recovery requirements:

- specialist failure marks delegated subtask failure without losing work item state;
- speaker restart resumes from durable work-item + envelope linkage;
- missing group binding returns actionable remediation text.

## 10. Phased Implementation Plan

> 中文注释：按“先约束后自动化”推进，优先做正确性和边界安全，再做体验增强。

### Phase A (now)

1. Extend work-item schema with project/orchestrator fields.
2. Add `work_item_specialists` and `work_item_transitions` tables.
3. Enforce project/reply-to/delegation guards in envelope/work-item handlers.

### Phase B

1. Introduce first-class `projects` and membership tables.
2. Add project-aware leader selection in orchestrator path.
3. Add project-level CLI read views.

### Phase C

1. Add deterministic daily digest generation (`completed`, `in-progress`, `blocked`).
2. Add operator diagnostics for project-level orchestration health.

### Phase D (optional)

1. Feishu group automation (create group, member sync).
2. Optional thread-level mapping inside requirement groups.

## 11. Acceptance Checklist for This Proposal

> 中文注释：验收关注可执行与可约束，不仅是“功能看起来能用”。

The proposal is considered implemented when all are true:

1. Cross-project delegation with same `work-item-id` is rejected by daemon.
2. Specialist update without delegated relation is rejected.
3. Work-item transition history is queryable and append-only.
4. Speaker can relay multi-leader results with source attribution and stable work-item linkage.
5. Daily digest exists with required three sections.

## 12. Out of Scope (for this proposal)

> 中文注释：本方案是在现有 envelope 模型上增量强化，不涉及大规模范式替换。

- Replacing envelope lifecycle semantics.
- Removing Telegram or changing existing adapter contracts.
- Building hosted multi-tenant control plane.

## 13. Performance Impact Assessment

> 中文注释：这个方案会引入一定的校验与写入开销，但通过索引与批处理可控，主要瓶颈仍在外部 provider 调用而非本地守卫。

### 13.1 Expected Overheads

1. Additional DB reads on `envelope.send` when `work-item-id` is present:
   - resolve work-item/project context;
   - verify membership/delegation relation;
   - verify reply-chain consistency.
2. Additional DB writes on state changes/delegation:
   - append to `work_item_transitions`;
   - persist `work_item_specialists` relation changes.
3. Slightly larger metadata payloads due to project-scoped linkage fields.

### 13.2 Risk Level

- Baseline assessment: **low to medium**.
- Why: most flows are still I/O-bound by provider CLI turns and external APIs (Feishu/provider), while local SQLite guard checks are lightweight under proper indexing.

### 13.3 Required Mitigations

1. Add indexes for all new hot paths:
   - `work_item_specialists(work_item_id, agent_name)`
   - `work_item_transitions(work_item_id, created_at)`
   - project membership lookup keys.
2. Keep guard checks in single transaction where possible to reduce round trips.
3. Bound thread/reply-chain traversal depth for validation.
4. Avoid N+1 lookups in list/status views by using joined queries or batched reads.

### 13.4 Performance Acceptance Targets (Suggested)

- P50 additional daemon-side overhead per guarded `envelope.send`: <= 5ms
- P95 additional daemon-side overhead per guarded `envelope.send`: <= 20ms
- No observable regression in at-most-once delivery semantics.
