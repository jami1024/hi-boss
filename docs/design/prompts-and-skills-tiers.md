# 设计文档：提示词与技能的层级设计

> 本文档是 [project-scoped-agent-binding.md](./project-scoped-agent-binding.md) 的 4.4 节详细展开。

---

## 4.4.1 当前层次 (现状分析)

```
全局 (系统级)
|-- prompts/system/         -> 角色模板 (speaker.md, leader.md)
|-- prompts/turn/           -> 每轮对话模板
|-- prompts/envelope/       -> envelope 指令格式模板
|-- ~/hiboss/BOSS.md        -> Boss 人格描述

Agent 级
|-- ~/hiboss/agents/<name>/SOUL.md               -> Agent 身份/人格
|-- ~/hiboss/agents/<name>/internal_space/MEMORY.md -> Agent 长期记忆
|-- ~/hiboss/agents/<name>/internal_space/memories/ -> Agent 每日记忆

项目级
+-- (当前不存在)
```

## 4.4.2 设计原则：三层提示词体系

提示词和技能应当是**多层级叠加**的，从上到下覆盖/补充：

| 层级 | 解决的问题 | 内容示例 | 存储位置 |
|------|-----------|---------|---------|
| **系统级** | "Hi-Boss 怎么工作" | 角色行为规范、CLI 工具说明、通信协议 | `prompts/` (全局模板) |
| **Agent 级** | "我是谁" | 人格特征、擅长领域、通用偏好 | `~/hiboss/agents/<name>/SOUL.md` |
| **项目级** | "这个项目怎么做" | 编码规范、技术栈、架构约定、项目专属工具 | `<project.root>/HIBOSS.md` 或 `<project.root>/.hiboss/` |

## 4.4.3 项目级提示词设计

**方案：从 `project.root` 自动读取项目指令文件**

当 agent 在项目上下文中执行时，自动读取项目根目录下的指令文件并注入 system prompt：

```
project.root/
|-- HIBOSS.md              -> 项目级指令 (类似 CLAUDE.md 的作用)
|                            包含: 编码规范、技术栈、架构约定、
|                            项目背景、团队协作规则等
+-- .hiboss/               -> (未来可扩展)
    |-- skills/            -> 项目专属技能/脚本
    +-- context/           -> 项目上下文文件
```

**优先级与合并规则**:

```
最终 system prompt =
  系统模板 (prompts/system/)     <- 基础框架
  + Agent SOUL.md                <- Agent 身份
  + Agent Memory                 <- Agent 记忆
  + BOSS.md                      <- Boss 人格
  + 项目上下文 (metadata.projectId 存在时)
    + project-context 指令       <- 项目信息、allowed leaders
    + HIBOSS.md 内容             <- 项目级自定义指令
```

**示例 HIBOSS.md**:

```markdown
# Project: my-awesome-app

## 技术栈
- TypeScript + Node.js 20
- React 19 + Vite
- PostgreSQL + Drizzle ORM

## 编码规范
- 使用 ESM 模块
- 函数命名 camelCase, 文件命名 kebab-case
- 每个文件不超过 300 行
- 所有 API 端点需要写测试

## 架构约定
- src/api/ 下是 REST API handler
- src/services/ 下是业务逻辑
- src/db/ 下是数据库操作
- 不要直接在 handler 中写 SQL

## 项目规则
- PR 标题格式: feat/fix/chore(scope): description
- 发布前必须跑 npm run typecheck && npm test
```

## 4.4.4 技能 (Skills) 设计

**调研结论**: 业界主流 Skills 实现分为两类：

| 类型 | 代表 | 本质 | Hi-Boss 适用性 |
|------|------|------|---------------|
| **指令型 Skill** | Claude Code `SKILL.md`, OpenClaw `SKILL.md` | Markdown 文件，教 agent "怎么做某件事"的 playbook | 高 |
| **工具型 Skill** | CrewAI `@tool`, MCP Server | 可编程函数/API，给 agent 新的能力 | 中 |

Hi-Boss 的 agent 通过 provider CLI (Claude/Codex) 运行，不是自定义 runtime。因此 Skills 应采用**指令型**（Markdown playbook），与 Claude Code 的 `SKILL.md` 对齐。

### Skill 的三层来源

```
优先级 (高 -> 低):

1. 项目级 Skills  -> <project.root>/.hiboss/skills/
   "这个项目怎么构建/测试/部署"
   例: deploy/, test/, review/

2. Agent 级 Skills -> ~/hiboss/agents/<name>/skills/
   "我擅长怎么做某件事"
   例: code-review/, security-audit/

3. 系统级 Skills  -> prompts/ 内置模板 (现有)
   "Hi-Boss 的通用工作协议"
   例: 角色行为、通信协议、CLI 工具
```

### Skill 文件格式 (兼容 Claude Code)

```
<skills-dir>/<skill-name>/
|-- SKILL.md          -> 核心指令 (必须)
|-- scripts/          -> 辅助脚本 (可选)
|   +-- run-tests.sh
+-- docs/             -> 参考文档 (可选)
    +-- api-spec.md
```

**SKILL.md 格式**:

```markdown
---
name: deploy
description: 部署项目到生产环境
scope: project           # project | agent | system
triggers:                # 何时自动触发 (可选)
  - "部署"
  - "发布"
  - "上线"
---

# 部署流程

## 前置检查
1. 运行 `npm run typecheck` 确认无类型错误
2. 运行 `npm run test` 确认测试通过
3. 检查 `git status` 确认无未提交变更

## 部署步骤
1. `npm run build`
2. `npm version patch`
3. `npm publish`
4. 创建 GitHub Release

## 回滚方案
如果部署失败:
1. `npm unpublish <package>@<version>`
2. `git tag -d v<version>`
3. 通知 boss 部署失败原因
```

### Skill 加载与注入机制

```
Agent 执行开始
  |
  |-- 读取系统级提示词 (prompts/)
  |-- 读取 Agent SOUL.md + Memory
  |-- 读取 BOSS.md
  |
  |-- 如果在项目上下文中:
  |   |-- 读取 HIBOSS.md (项目指令)
  |   |-- 扫描 <project.root>/.hiboss/skills/
  |   |   +-- 提取所有 SKILL.md 的 name + description
  |   +-- 注入 skill 目录摘要到 prompt
  |
  |-- 扫描 ~/hiboss/agents/<name>/skills/
  |   +-- 提取所有 SKILL.md 的 name + description
  |
  +-- 生成最终 system prompt
      包含: available-skills 列表 (name + description)
      注: 仅注入摘要, 不注入全部内容 (节省 token)
```

**渐进式加载** (Progressive Disclosure，参考 Claude Code):
- session 启动时只注入 skill 的 **name + description 列表**
- 当 agent 判断需要使用某个 skill 时，再读取完整的 `SKILL.md` 内容
- 这样避免大量 skill 指令占满 context window

### Skill 注入到 prompt 的示例

```
## Available Skills

project-skills:
- deploy: 部署项目到生产环境
- test: 运行完整测试套件并生成报告
- review: 按项目规范执行代码审查

agent-skills:
- security-audit: 执行安全漏洞扫描
- performance-check: 分析性能瓶颈

要使用某个 skill, 读取对应的 SKILL.md 文件获取详细步骤。
项目 skills 位于: <project.root>/.hiboss/skills/<name>/SKILL.md
Agent skills 位于: ~/hiboss/agents/<agent-name>/skills/<name>/SKILL.md
```

### 项目级 vs Agent 级 Skills 的定位

| | 项目级 Skills | Agent 级 Skills |
|---|---|---|
| **位置** | `<project.root>/.hiboss/skills/` | `~/hiboss/agents/<name>/skills/` |
| **生命周期** | 跟随项目仓库 (可 git 管理) | 跟随 agent |
| **可见性** | 该项目所有参与 agent | 仅该 agent |
| **典型内容** | 构建、测试、部署、发布流程 | agent 专长领域的操作规范 |
| **维护者** | 项目负责人 / Boss | Agent 自身 (可通过记忆演化) |
| **示例** | `deploy/`, `test/`, `db-migrate/` | `security-audit/`, `code-review/` |

### 与现有机制的关系

```
现有机制                     Skills 的定位
---------                   ---------------
prompts/ (系统模板)    ->    "Hi-Boss 怎么工作" (不变)
SOUL.md (Agent 身份)   ->    "我是谁" (不变)
MEMORY.md (Agent 记忆) ->    "我记得什么" (不变)
hiboss CLI 工具        ->    "我能做什么" (不变)

新增:
HIBOSS.md (项目指令)   ->    "这个项目的规矩" (Phase 2)
Skills (项目/Agent)    ->    "怎么做某件事" (Phase 3)
```

### 实施优先级

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| Phase 2 | `HIBOSS.md` 自动读取注入 | P1 |
| Phase 3 | 项目级 Skills 扫描 + 摘要注入 | P2 |
| Phase 3 | Agent 级 Skills 扫描 + 摘要注入 | P2 |
| Phase 4 | Skill 渐进式加载 (按需读取全文) | P3 |
| Phase 4 | Skill 市场 / 社区共享 (远期) | P3 |

## 4.4.5 记忆的层级

| 层级 | 存储 | 生命周期 | 可见性 |
|------|------|---------|--------|
| **Agent 级记忆** | `~/hiboss/agents/<name>/internal_space/` | 跟随 agent | 仅该 agent 可见 |
| **项目级记忆** | `<project.root>/.hiboss/memory/` (未来) | 跟随项目 | 该项目所有 agent 可见 |

当前实施建议：
- **Phase 1**: 仅使用 Agent 级记忆（现有机制），项目指令通过 `HIBOSS.md` 注入
- **Phase 2**: 引入项目级共享记忆（让同一项目的不同 agent 共享上下文）

## 4.4.6 总结：各层级职责

```
+--------------------------------------------------+
|  系统级 (prompts/)                                 |
|  "Hi-Boss 的规则是什么"                            |
|  -> 角色行为、CLI 工具、通信协议、格式规范            |
|  -> 所有 agent 共享, 按角色(speaker/leader)区分      |
+--------------------------------------------------+
|  Agent 级 (~/hiboss/agents/<name>/)                |
|  "我是谁、我记得什么"                               |
|  -> SOUL.md (身份人格)                              |
|  -> MEMORY.md + daily memories (长期/短期记忆)       |
|  -> 跟随 agent, 跨项目持久化                        |
+--------------------------------------------------+
|  项目级 (<project.root>/)                          |
|  "这个项目怎么做"                                  |
|  -> HIBOSS.md (编码规范、技术栈、架构约定)           |
|  -> .hiboss/skills/ (项目专属工具, 未来)             |
|  -> 仅在项目上下文中注入                            |
|  -> 所有参与该项目的 agent 共享                      |
+--------------------------------------------------+
```
