# Web UI

Hi-Boss Web 管理界面规格文档。

## 概述

在 daemon 进程中内嵌 HTTP/WebSocket 服务器，提供浏览器端管理界面，覆盖：项目管理、Agent 管理（提示词/Skills）、CLI 配置、与 Agent 对话。

## 架构

```
Browser (React SPA)
  │
  ├── HTTP REST ──▶ Daemon HTTP Server ──▶ DaemonContext ──▶ SQLite
  │                      │
  └── WebSocket ───▶ WS Handler ──▶ Envelope Router ──▶ Agent Executor
```

- HTTP Server 与 IPC Server 共存于同一 daemon 进程，共享 `DaemonContext`。
- 前端构建产物（静态文件）打包在 `dist/web/` 中，daemon 直接 serve。
- WebSocket 用于实时对话和状态推送。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端框架 | React 19 + TypeScript | 完整生态 |
| 构建工具 | Vite | 快速构建，产出静态文件 |
| UI 组件库 | shadcn/ui + Tailwind CSS | 现代、可定制、组件丰富 |
| 动画 | Framer Motion | React 动画标准方案 |
| HTTP Server | Node.js `http` 模块 | 零依赖，daemon 内嵌 |
| WebSocket | `ws` 库 | 轻量、生产级 |

## 启动与配置

```bash
# 默认开启 Web UI，端口 7749
hiboss daemon start --token <boss-token>

# 自定义端口
hiboss daemon start --token <boss-token> --web-port 8080

# 禁用 Web UI
hiboss daemon start --token <boss-token> --no-web
```

- 默认端口: `7749`
- 默认行为: 启用
- 访问地址: `http://localhost:7749`

## 认证

复用现有 token 机制：

- 浏览器首次访问时输入 boss token
- Token 存储在浏览器 `localStorage`
- 每个 HTTP 请求携带 `Authorization: Bearer <token>` header
- WebSocket 连接时通过首条消息传递 token
- 后端通过 `DaemonContext.resolvePrincipal(token)` 验证

## REST API

所有 API 前缀: `/api/v1/`

### Daemon 状态

| Method | Path | RPC 映射 | 说明 |
|--------|------|---------|------|
| GET | `/status` | `daemon.status` | daemon 运行状态 |
| GET | `/time` | `daemon.time` | 时区信息 |

### Agent 管理

| Method | Path | RPC 映射 | 说明 |
|--------|------|---------|------|
| GET | `/agents` | `agent.list` | 列出所有 agent |
| GET | `/agents/:name/status` | `agent.status` | 单个 agent 状态 |
| POST | `/agents` | `agent.register` | 注册新 agent |
| PUT | `/agents/:name` | `agent.set` | 更新 agent 配置 |
| DELETE | `/agents/:name` | `agent.delete` | 删除 agent |
| POST | `/agents/:name/refresh` | `agent.refresh` | 刷新 session（可选 body: `{ projectId }`，用于定向刷新项目会话） |
| POST | `/agents/:name/abort` | `agent.abort` | 中止当前运行 |
| GET | `/agents/:name/skills/remote` | `skill.remote.list` | 列出该 agent 的远程技能 |
| POST | `/agents/:name/skills/remote` | `skill.remote.add` | 安装远程技能 |
| POST | `/agents/:name/skills/remote/:skillName/update` | `skill.remote.update` | 更新远程技能 |
| DELETE | `/agents/:name/skills/remote/:skillName` | `skill.remote.remove` | 删除远程技能 |
| PUT | `/agents/:name/session-policy` | `agent.session-policy.set` | 设置 session 策略 |
| POST | `/agents/:name/bind` | `agent.bind` | 绑定 adapter |
| POST | `/agents/:name/unbind` | `agent.unbind` | 解绑 adapter |

### 项目管理

| Method | Path | RPC 映射 | 说明 |
|--------|------|---------|------|
| GET | `/projects` | `project.list` | 列出项目 |
| GET | `/projects/:id` | `project.get` | 项目详情 |
| POST | `/projects/:id/select-leader` | `project.select-leader` | 选择 leader |
| POST | `/projects/:id/tasks` | — | 创建项目任务（可自动派发给 speaker） |
| GET | `/projects/:id/tasks` | — | 列出项目任务 |
| GET | `/projects/:id/tasks/:taskId` | — | 项目任务详情（含进度与关联消息） |
| POST | `/projects/:id/tasks/:taskId/state` | — | 更新项目任务状态 |
| POST | `/projects/:id/tasks/:taskId/progress` | — | 追加项目任务进度 |
| GET | `/projects/:id/skills/remote` | `skill.remote.list` | 列出项目远程技能 |
| POST | `/projects/:id/skills/remote` | `skill.remote.add` | 安装项目远程技能 |
| POST | `/projects/:id/skills/remote/:skillName/update` | `skill.remote.update` | 更新项目远程技能 |
| DELETE | `/projects/:id/skills/remote/:skillName` | `skill.remote.remove` | 删除项目远程技能 |
| GET | `/projects/:id/memory` | — | 列出项目共享记忆条目 |
| GET | `/projects/:id/memory/:entryName` | — | 获取单条项目共享记忆内容 |
| PUT | `/projects/:id/memory/:entryName` | — | 新增/更新项目共享记忆并触发会话刷新 |
| DELETE | `/projects/:id/memory/:entryName` | — | 删除项目共享记忆并触发会话刷新 |

### Envelope

| Method | Path | RPC 映射 | 说明 |
|--------|------|---------|------|
| POST | `/envelopes/send` | `envelope.send` | 发送消息 |
| GET | `/envelopes` | `envelope.list` | 列出消息 |
| GET | `/envelopes/:id/thread` | `envelope.thread` | 消息线程 |

### Cron

| Method | Path | RPC 映射 | 说明 |
|--------|------|---------|------|
| GET | `/crons` | `cron.list` | 列出定时任务 |
| POST | `/crons` | `cron.create` | 创建定时任务 |
| POST | `/crons/:id/enable` | `cron.enable` | 启用 |
| POST | `/crons/:id/disable` | `cron.disable` | 禁用 |
| DELETE | `/crons/:id` | `cron.delete` | 删除 |

### 提示词管理

| Method | Path | 说明 |
|--------|------|------|
| GET | `/prompts` | 列出提示词模板文件树 |
| GET | `/prompts/*path` | 读取模板文件内容 |
| PUT | `/prompts/*path` | 更新模板文件内容 |

### CLI 配置

| Method | Path | 说明 |
|--------|------|------|
| GET | `/cli/providers` | 列出可用 provider（claude/codex）及其状态 |
| GET | `/cli/providers/:name/config` | 读取 provider CLI 配置 |
| PUT | `/cli/providers/:name/config` | 更新 provider CLI 配置 |

## WebSocket

连接地址: `ws://localhost:7749/ws/chat`

### 协议

JSON 消息格式，每条消息包含 `type` 字段：

```typescript
// 客户端 -> 服务端
interface WsClientMessage {
  type: "auth" | "send" | "subscribe";
  // auth: 首次认证
  token?: string;
  // send: 发送消息给 agent
  to?: string;
  text?: string;
  // subscribe: 订阅 agent 状态
  agentName?: string;
}

// 服务端 -> 客户端
interface WsServerMessage {
  type: "auth-ok" | "auth-fail" | "envelope" | "agent-status" | "error";
  // envelope: 新消息推送
  envelope?: Envelope;
  // agent-status: agent 状态变更
  status?: {
    agentState: "running" | "idle";
    agentHealth: "ok" | "error" | "unknown";
    pendingCount: number;
    currentRun?: {
      id: string;
      startedAt: number;
      sessionTarget?: string;
      projectId?: string;
    };
  };
  // error
  message?: string;
}
```

### 流程

1. 客户端连接后发送 `{ type: "auth", token: "..." }`
2. 服务端验证后回复 `{ type: "auth-ok" }`
3. 客户端发送 `{ type: "subscribe", agentName: "nex" }` 订阅 agent 状态
4. 客户端发送 `{ type: "send", to: "agent:nex", text: "hello" }` 发消息
5. 服务端推送 `{ type: "envelope", envelope: {...} }` 新消息
6. 服务端推送 `{ type: "agent-status", status: {...} }` 状态变更

## 前端页面

### 页面结构

```
/                       → Dashboard（总览）
/agents                 → Agent 列表
/agents/:name           → Agent 详情（状态、配置、session 策略）
/agents/:name/chat      → 与 Agent 对话
/projects               → 项目列表
/projects/:id           → 项目详情（路径、speaker、leaders、项目级远程技能管理）
/projects/:id/memory    → 项目共享记忆管理（.hiboss/memory）
/projects/:id/tasks     → 项目任务列表（创建、派发、状态总览）
/projects/:id/tasks/:taskId → 项目任务详情（生命周期、进度、关联消息）
/prompts                → 提示词模板编辑器
/cli                    → CLI 配置管理
/envelopes              → Envelope 列表与检索
```

### Dashboard

- daemon 运行状态（uptime、时区）
- agent 状态概览卡片（idle/running/error）
- 最近消息摘要
- 项目概览

### Agent 管理页

- Agent 列表：名称、角色（speaker/leader）、provider、状态指示灯
- Agent 详情：
  - 基本配置编辑（provider、model、workspace、permission-level）
  - Session 策略编辑（daily-reset-at、idle-timeout、max-context-length）
  - Adapter 绑定管理
  - 运行历史（last run、current run）
- 操作：注册新 agent、刷新 session、中止运行、删除

### 对话页

- 消息列表（类 chat UI，支持滚动加载历史）
- 消息输入框
- 实时消息推送（WebSocket）
- Agent 状态指示（running/idle）
- 支持回复特定消息（reply-to）

### 项目管理页

- 项目列表：名称、根路径、speaker agent
- 项目详情：
  - 编辑项目路径
  - 指定 speaker agent
  - 管理 leader agents（添加/移除、capabilities）
  - 管理项目任务（创建、状态流转、进度查看）

### 提示词编辑器

- 文件树浏览（`prompts/` 目录）
- 代码编辑器（语法高亮 Markdown + Nunjucks）
- 实时预览（可选）
- 保存/重置

### CLI 配置页

- Provider 可用性检测（claude --version / codex exec --help）
- Provider 配置查看/编辑

## 后端文件结构

```
src/web/
  server.ts              # HTTP + WS 服务器生命周期
  router.ts              # REST 路由分发
  middleware/
    auth.ts              # token 认证
    static.ts            # 静态文件 serve
  handlers/
    agents.ts            # Agent API handlers
    projects.ts          # 项目 API handlers
    envelopes.ts         # Envelope API handlers
    crons.ts             # Cron API handlers
    prompts.ts           # 提示词文件读写
    cli-config.ts        # CLI 配置
    status.ts            # Daemon 状态
  ws/
    chat.ts              # WebSocket 对话
    events.ts            # 事件订阅与推送
```

## 前端文件结构

```
web/                     # 前端源码（项目根目录下）
  index.html
  vite.config.ts
  tsconfig.json
  package.json           # 前端独立 package.json
  src/
    main.tsx
    App.tsx
    api/
      client.ts          # HTTP/WS 客户端封装
      types.ts           # API 类型定义
    components/
      ui/                # shadcn/ui 组件
      layout/
        Sidebar.tsx
        Header.tsx
      agents/
        AgentList.tsx
        AgentDetail.tsx
        AgentForm.tsx
      chat/
        ChatView.tsx
        MessageList.tsx
        MessageInput.tsx
      projects/
        ProjectList.tsx
        ProjectDetail.tsx
      prompts/
        PromptEditor.tsx
        FileTree.tsx
    pages/
      Dashboard.tsx
      Agents.tsx
      AgentChat.tsx
      Projects.tsx
      Prompts.tsx
      CliConfig.tsx
    hooks/
      useWebSocket.ts
      useAgentStatus.ts
    lib/
      utils.ts           # shadcn/ui utils
```

## 构建集成

### package.json scripts 变更

```json
{
  "scripts": {
    "build": "npm run build:server && npm run build:web",
    "build:server": "tsc",
    "build:web": "cd web && npm run build",
    "dev:web": "cd web && npm run dev"
  }
}
```

### 构建流程

1. `npm run build:server` — 编译 TypeScript 后端 → `dist/`
2. `npm run build:web` — Vite 构建前端 → `dist/web/`
3. daemon 启动时从 `dist/web/` serve 静态文件

### npm publish

`package.json#files` 追加 `dist/web/`，确保发布包含前端产物。

## 实现阶段

### Phase 1: 基础框架

- [ ] daemon HTTP/WS 服务器骨架（`src/web/server.ts`）
- [ ] REST 路由框架 + token 认证中间件
- [ ] 静态文件 serve
- [ ] React + Vite + shadcn/ui 项目初始化
- [ ] 布局框架（Sidebar + Header）
- [ ] Dashboard 页面（daemon 状态）

### Phase 2: Agent 管理

- [ ] Agent 列表/详情/编辑 API + 页面
- [ ] Agent 注册/删除流程
- [ ] Session 策略编辑
- [ ] Adapter 绑定管理

### Phase 3: 对话功能

- [ ] WebSocket 连接管理
- [ ] Chat UI（消息列表 + 输入）
- [ ] 实时消息推送
- [ ] Agent 状态实时更新

### Phase 4: 项目管理

- [ ] 项目列表/详情 API + 页面
- [ ] 项目配置编辑（路径、speaker、leaders）
- [ ] Leader 选择与 capabilities 管理

### Phase 5: 提示词与 CLI

- [ ] 提示词文件树浏览 + 编辑器
- [ ] CLI provider 配置管理

## daemon 代码变更

`Daemon` 类需要：

1. 构造函数中创建 `WebServer` 实例，传入 `DaemonContext`
2. `start()` 中启动 HTTP/WS 服务器
3. `stop()` 中关闭 HTTP/WS 服务器
4. `DaemonConfig` 新增 `webPort` 和 `webEnabled` 字段
5. CLI `daemon start` 新增 `--web-port` 和 `--no-web` flags

## 依赖变更

### 后端新增

```
ws                       # WebSocket 服务端
@types/ws                # TypeScript 类型（devDependencies）
```

### 前端（web/package.json，独立管理）

```
react, react-dom
@vitejs/plugin-react
vite
typescript
tailwindcss, @tailwindcss/vite
framer-motion
react-router-dom
```
