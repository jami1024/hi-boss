# Hi-Boss

[English README](README.md)

通过 Telegram / Feishu 编排 Codex / Claude Code 智能体，支持持久化通信、可编辑记忆，以及非阻塞并行执行。

亮点：
- 多适配器接入：支持 Telegram 与 Feishu。
- 提供商灵活：支持官方直连与中转方案。
- 项目级编排：work-item 可绑定项目根目录、speaker 与多 leader。
- 内置记忆系统：每个智能体都有可读、可直接编辑的 Markdown 记忆。
- 信封（Envelope）系统：提供可持久化、可审计的 agent↔agent / agent↔user 通信流。
- 非阻塞委派：后台/leader 智能体可并行处理重任务，也可按领域注册专用智能体。
- 声明式 setup v2：`setup --config-file` 支持全量对齐与启动时自动对账。

## 赞助

[![YesCode logo](docs/assets/sponsors/yescode-logo.png)](https://co.yes.vg)

YesCode 是稳定可靠、价格合理的 Claude Code/Codex 中转服务提供商。

## 安装

在 setup 前，请先确保至少安装并可运行一个 provider CLI：
- **Claude Code** (`claude --version`)
- **Codex** (`codex exec --help`)

通过 npm 安装：

```bash
npm i -g hiboss
hiboss setup
hiboss daemon start --token <boss-token>
```

首次启动（setup + 启动 daemon）：

```bash
hiboss setup
hiboss daemon start --token <boss-token>
```

升级：

```bash
hiboss daemon stop --token <boss-token>
npm i -g hiboss@latest
```

提示：升级后重启 daemon：

```bash
hiboss daemon start --token <boss-token>
```

源码开发说明见：`docs/index.md`。

## Setup

`hiboss setup` 会初始化本地状态，并且仅输出一次 token。

| 项目 | 路径 |
|---|---|
| 数据根目录（默认） | `~/hiboss/` |
| 数据根目录（覆盖） | `$HIBOSS_DIR` |
| Daemon 内部文件（db/socket/log/pid） | `${HIBOSS_DIR:-$HOME/hiboss}/.daemon/` |
| Agent 长期记忆文件 | `${HIBOSS_DIR:-$HOME/hiboss}/agents/<agent-name>/internal_space/MEMORY.md` |
| Agent 每日记忆目录 | `${HIBOSS_DIR:-$HOME/hiboss}/agents/<agent-name>/internal_space/memories/` |

目录结构示意：

```text
${HIBOSS_DIR:-$HOME/hiboss}/
  .daemon/
  agents/<agent-name>/internal_space/
    MEMORY.md
    memories/
```

修复 / 重置：
- 健康 setup 重跑（安全无副作用）：`hiboss setup`
- setup 异常/不完整（非破坏）建议走配置导出+回放流程：

```bash
hiboss daemon stop --token <boss-token>
hiboss setup export --out ./hiboss.setup.json
# 编辑 ./hiboss.setup.json
hiboss setup --config-file ./hiboss.setup.json --token <boss-token> --dry-run
hiboss setup --config-file ./hiboss.setup.json --token <boss-token>
hiboss daemon start --token <boss-token>
```

- 标准修复模板（speaker + leader + 可选项目目录）。保存为 `./hiboss.repair.v2.json`，并填写占位符：

```json
{
  "version": 2,
  "boss-name": "<your-name>",
  "boss-timezone": "<IANA-timezone>",
  "adapters": {
    "telegram": {
      "adapter-boss-id": "<telegram-username-without-@>"
    },
    "feishu": {
      "adapter-boss-id": "<feishu-user-id>"
    }
  },
  "agents": [
    {
      "name": "nex",
      "role": "speaker",
      "provider": "<claude-or-codex>",
      "description": "Telegram speaker agent",
      "workspace": "<absolute-workspace-path>",
      "model": null,
      "reasoning-effort": null,
      "permission-level": "standard",
      "bindings": [
        {
          "adapter-type": "telegram",
          "adapter-token": "<telegram-bot-token>"
        }
      ]
    },
    {
      "name": "kai",
      "role": "leader",
      "provider": "<claude-or-codex>",
      "description": "Background leader agent",
      "workspace": "<absolute-workspace-path>",
      "model": null,
      "reasoning-effort": null,
      "permission-level": "standard",
      "bindings": []
    }
  ],
  "projects": [
    {
      "id": "prj-<stable-id>",
      "name": "<project-name>",
      "root": "<absolute-project-root>",
      "speaker-agent": "nex",
      "main-group-channel": "channel:feishu:oc_xxx",
      "leaders": [
        {
          "agent-name": "kai",
          "capabilities": ["implementation", "review"],
          "active": true
        }
      ]
    }
  ]
}
```

```bash
hiboss daemon stop --token <boss-token>
hiboss setup --config-file ./hiboss.repair.v2.json --token <boss-token> --dry-run
hiboss setup --config-file ./hiboss.repair.v2.json --token <boss-token>
hiboss daemon start --token <boss-token>
```

说明：setup config apply 是全量对齐（full reconcile），会重新生成 agent token（只打印一次）。
apply 成功后会记录配置文件路径和指纹，daemon 重启时可自动对账。

启动自动对账示例：

```bash
# 使用已记录的配置文件路径/指纹
hiboss daemon start --token <boss-token>

# 启动时显式指定配置文件（并更新后续自动加载来源）
hiboss daemon start --token <boss-token> --config-file ./hiboss.repair.v2.json
```

完整重置（破坏性）：

```bash
hiboss daemon stop --token <boss-token>
rm -rf "${HIBOSS_DIR:-$HOME/hiboss}"
hiboss setup
hiboss daemon start --token <boss-token>
```

提示：大多数命令都支持 `--token <token>`；省略时会读取 `HIBOSS_TOKEN`。

## Telegram

Hi-Boss 通过 Telegram Bot 将智能体接入 Telegram。

1) 通过 @BotFather 创建 Telegram Bot Token。

2) 将 Bot 绑定到 `speaker` 智能体（`hiboss setup` 创建的 speaker 会自动绑定；这个命令主要用于额外 speaker）：

```bash
hiboss agent set --token <boss-token> --name <speaker-agent-name> --role speaker --bind-adapter-type telegram --bind-adapter-token <telegram-bot-token>
```

3) 在 Telegram 中给 Bot 发消息即可和智能体对话。

仅 Boss 可用的 Telegram 命令：
- `/status`：查看该绑定 agent 的 `hiboss agent status`
- `/new`：请求刷新该绑定 agent 的会话
- `/abort`：取消当前运行并清空该绑定 agent 已到期待处理的 inbox

## Feishu

Hi-Boss 也支持 Feishu 适配器通道。

将 Feishu 绑定到 `speaker` 智能体：

```bash
hiboss agent set --token <boss-token> --name <speaker-agent-name> --role speaker --bind-adapter-type feishu --bind-adapter-token '<feishu-token>'
```

`<feishu-token>` 支持两种形式：
- 短格式：`<appId>:<appSecret>`（仅出站）
- JSON 格式：包含 webhook 字段（支持入站回调）

使用声明式 setup 时，记得：
- 设置 `adapters.feishu.adapter-boss-id`
- 在 `agents[].bindings[]` 中加入 Feishu 绑定

## 项目级编排

Hi-Boss 会在 `projects` / `project_leaders` 中持久化项目视图，并支持项目维度的 leader 选择。

常用命令：

```bash
hiboss project list --token <agent-token>
hiboss project get --id <project-id> --token <agent-token>
hiboss project select-leader --project-id <project-id> --require-capability implementation --token <agent-token>
```

说明：
- leader 候选会做 workspace 一致性过滤（`agent.workspace` 必须等于 `project.root`）。
- leader 选择会综合健康状态、busy 状态和 agent 名称排序。

## Agent

通过 CLI 管理智能体（创建 / 更新 / 删除），也可以通过 `permission-level` 把管理权限委托给可信智能体。

创建/注册新智能体：

```bash
hiboss agent register --token <boss-token> --name ops-bot --role leader --provider codex --description "AI assistant" --workspace "$PWD"
```

更新智能体（手动配置）：

```bash
hiboss agent set --token <boss-token> --name ops-bot --provider codex --permission-level privileged
```

删除智能体：

```bash
hiboss agent delete --token <boss-token> --name ops-bot
```

查看列表 / 状态：

```bash
hiboss agent list --token <boss-token>
hiboss agent status --token <boss-token> --name ops-bot
```

### 权限级别

Hi-Boss 区分两件事：
- **Boss 标记消息**（`fromBoss` / 提示词中的 `[boss]`）对应适配器身份（例如 Telegram 用户名）。
- **授权级别**（`permission-level`）决定某个 token 能执行哪些 CLI/RPC 操作。

可用级别：`restricted`、`standard`、`privileged`、`boss`。

设置权限级别：

```bash
hiboss agent set --token <boss-token> --name <agent-name> --permission-level <level>
```

### Boss 级智能体（委托管理）

如果你希望某个智能体仅通过聊天就能执行 Hi-Boss 管理操作（注册/删除 agent、重绑适配器等），可以给它 `permission-level: boss`：

```bash
hiboss agent set --token <boss-token> --name <agent-name> --permission-level boss
```

然后你可以在 Telegram 里直接让该智能体执行管理任务（例如“新增一个 agent”“删除某个 agent”“更新绑定”）。当然你也可以始终手动使用 `hiboss agent register|set|delete`。

这项权限非常强：boss 级 token 可以执行任何 boss 权限操作。请仅授予你完全信任的智能体。

## 记忆系统

每个 agent 的记忆位于 `${HIBOSS_DIR:-$HOME/hiboss}/agents/<agent-name>/internal_space/`：
- `MEMORY.md`：长期记忆
- `memories/YYYY-MM-DD.md`：每日记忆文件

## 文档

- `docs/index.md`：文档入口（规格索引）
- `docs/spec/index.md`：Spec 总入口与导航
- `docs/spec/cli.md`：CLI 命令面与链接
- `docs/spec/adapters/telegram.md`：Telegram 适配器行为
- `docs/spec/adapters/feishu.md`：Feishu 适配器行为
- `docs/spec/cli/projects.md`：项目 CLI（`list/get/select-leader`）
