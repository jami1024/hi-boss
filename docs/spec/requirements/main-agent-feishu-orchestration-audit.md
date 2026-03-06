# Main-Agent + Feishu Orchestration Audit

Source requirement: `docs/spec/requirements/main-agent-feishu-orchestration.md`

Audit date: 2026-03-06

Status legend:
- `done`: implemented with code-level enforcement and/or tests
- `partial`: partially implemented, or mainly prompt/policy-level without full daemon constraints
- `missing`: not implemented yet

## FR Coverage Matrix

| Item | Status | Evidence | Notes / Gap |
|---|---|---|---|
| FR-1 Intent Gate | partial | `prompts/system/sections/roles/speaker.md:18` | Intent classes are defined in speaker prompt, but there is no daemon-side hard classifier/enforcer. |
| FR-2 Work Item Model | partial | `src/daemon/db/schema.ts:94`, `src/shared/work-item.ts:15`, `src/daemon/rpc/envelope-handlers.ts:169` | Durable `work_items` + linkage exist, but required fields `orchestratorAgent`, `mainGroupChannel`, `requirementGroupChannel`, `specialists[]` are not persisted in the work item model. |
| FR-3 Main-Agent Delegation | partial | `prompts/system/sections/roles/speaker.md:64`, `src/daemon/rpc/envelope-handlers.ts:205`, `src/daemon/rpc/envelope-handlers.test.ts:129` | Delegation protocol and `work-item-id` propagation exist, but no explicit orchestrator-level subtask graph/tracker in daemon. |
| FR-4 Specialist Constraints | partial | `prompts/system/sections/roles/leader.md:16`, `src/shared/work-item.ts:73`, `src/daemon/rpc/envelope-handlers.ts:247` | Constraints are a mix of prompt discipline + role/channel policy. Missing strict daemon rule: specialist accepts delegated tasks only from orchestrator for that work item. |
| FR-5 Channel/Group Topology | done | `docs/spec/adapters/feishu.md:41`, `src/daemon/rpc/work-item-handlers.ts:200`, `src/shared/work-item.ts:128` | Main group + requirement-group topology is supported through manual channel binding/allowlist in v1 (as required). |
| FR-6 Reporting Requirements | partial | `prompts/system/sections/roles/speaker.md:20` | Final/daily reporting behavior is guided by prompt, but no built-in daily digest generator or enforced report schema in daemon. |
| FR-7 Security and Authority | partial | `src/shared/work-item.ts:69`, `src/daemon/rpc/work-item-handlers.ts:225`, `src/daemon/rpc/envelope-handlers.ts:256`, `src/daemon/bridges/channel-bridge.ts:14` | `done` authority and channel boundary are enforced. Injection resistance is partially covered by prompt precedence/confirmation gate, but not a full policy engine over group instructions. |
| FR-8 Failure Handling | partial | `src/daemon/bridges/channel-bridge.ts:43`, `src/agent/background-executor.ts:154`, `src/daemon/db/database.ts:284`, `docs/spec/components/session.md:113` | Explicit binding failure hints and durable recovery exist. Missing explicit first-class subtask failure state machine tied to orchestrator-level task model. |
| FR-9 Observability and Audit | partial | `src/daemon/rpc/envelope-handlers.ts:463`, `src/daemon/rpc/envelope-handlers.ts:303`, `docs/spec/envelope.md:74` | Envelope-thread tracing + work-item linkage exist. Missing dedicated work-item state transition history table (current model has current state + timestamps only). |
| FR-10 Compatibility | done | `src/adapters/registry.ts:1`, `src/daemon/daemon.ts:403`, `docs/spec/adapters/telegram.md:1`, `docs/spec/adapters/feishu.md:1` | Feishu is additive; Telegram remains supported; envelope lifecycle remains intact. |

## Section 6 (Feishu Capability) Coverage

| Capability | Status | Evidence | Notes / Gap |
|---|---|---|---|
| 1) Receive group messages -> `channel:feishu:<chat-id>` | done | `src/adapters/feishu/incoming.ts:74`, `src/daemon/bridges/channel-bridge.ts:191`, `src/daemon/bridges/channel-bridge.feishu.test.ts:217` | Implemented and tested. |
| 2) Send messages to Feishu channel addresses | done | `src/adapters/feishu/outgoing.ts:134`, `src/adapters/feishu.adapter.ts:45`, `src/adapters/feishu.adapter.test.ts:232` | Implemented and tested. |
| 3) Parse sender identity for policy decisions | done | `src/adapters/feishu/incoming.ts:87`, `src/daemon/bridges/channel-bridge.ts:132`, `src/daemon/bridges/channel-bridge.ts:216` | Implemented for boss-identity/policy routing path. |
| 4) Phase 2+ group-management APIs | missing | `docs/spec/adapters/feishu.md:61` | MVP does not implement auto-create/add-members; manual provisioning remains the path. |

## Phase Plan Coverage

| Phase | Status | Evidence | Notes / Gap |
|---|---|---|---|
| Phase A: orchestration baseline | partial | `src/shared/work-item.ts:3`, `src/daemon/rpc/work-item-handlers.ts:142`, `prompts/system/sections/roles/speaker.md:18` | Core work-item lifecycle exists; intent gate and orchestrator protocol are not fully daemon-enforced. |
| Phase B: Feishu adapter MVP | done | `src/adapters/feishu.adapter.ts:22`, `src/adapters/feishu/incoming.ts:37`, `src/adapters/feishu/outgoing.ts:134` | Ingress/egress and binding path are implemented. |
| Phase C: policy hardening | partial | `src/shared/work-item.ts:128`, `src/daemon/rpc/envelope-handlers.ts:256`, `src/daemon/rpc/work-item-handlers.ts:251` | Channel allowlist and authority checks exist; audit views/history model are not yet complete. |
| Phase D: Feishu automation | missing | `docs/spec/adapters/feishu.md:61` | No auto group creation/member sync/thread mapping yet. |

## Acceptance Criteria Assessment

| AC | Status | Evidence | Notes / Gap |
|---|---|---|---|
| AC-1 New request creates exactly one work item + one requirement discussion context | partial | `src/daemon/rpc/envelope-handlers.ts:249`, `prompts/system/sections/roles/speaker.md:27` | Work item creation exists, but requirement discussion context is manual and not enforced as exactly one. |
| AC-2 Main agent delegates to >=3 specialist roles and aggregates outputs | partial | `prompts/system/sections/roles/speaker.md:64`, `prompts/system/sections/roles/leader.md:5` | Protocol exists at prompt level; no daemon KPI/assertion for role count or aggregation completion. |
| AC-3 Specialist outputs traceable to one `workItemId` | partial | `src/daemon/rpc/envelope-handlers.ts:303`, `prompts/system/sections/roles/leader.md:21` | Linkage supported, but not hard-required for every specialist output path. |
| AC-4 Final summary appears in main group with linked work-item reference | partial | `prompts/system/sections/roles/speaker.md:44`, `src/daemon/rpc/envelope-handlers.ts:247` | Supported by conventions/transport, not enforced as mandatory finalization step. |
| AC-5 Daily digest available with completed/in-progress/blocked sections | missing | `docs/spec/requirements/main-agent-feishu-orchestration.md:147` | No dedicated digest command/scheduler/report schema implemented. |
| AC-6 One specialist failure does not lose work-item state or break orchestration | partial | `src/agent/background-executor.ts:154`, `src/daemon/db/database.ts:284`, `docs/spec/components/session.md:113` | Durable state/recovery exists, but no explicit orchestrator subtask graph to guarantee flow continuity semantics end-to-end. |

## Recommended Next Implementation Slice (Priority)

1. Add project-scoped orchestration fields to work item (Phase A hardening):
   - `orchestratorAgent`, `mainGroupChannel`, `requirementGroupChannel`, `specialists[]`, optional `projectRoot`.
2. Enforce orchestrator/specialist relation in daemon:
   - specialist update must match delegated `work-item-id` and allowed upstream relation.
3. Add work-item transition history table for FR-9:
   - append-only transition log with actor/time/reason.
4. Add daily digest capability for AC-5:
   - deterministic sections (`completed`, `in-progress`, `blocked`) with scheduler entry.
5. Keep Feishu group automation in Phase D as optional:
   - retain manual provisioning path as fallback.
