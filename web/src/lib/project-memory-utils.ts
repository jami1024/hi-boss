export interface ProjectMemoryTemplate {
  id: string;
  label: string;
  defaultTitle: string;
  description: string;
  content: string;
}

export const PROJECT_MEMORY_TEMPLATES: ProjectMemoryTemplate[] = [
  {
    id: "decision-record",
    label: "决策记录",
    defaultTitle: "decision-record",
    description: "记录关键技术或产品决策及其权衡。",
    content: [
      "# 决策记录",
      "",
      "## 背景",
      "- 问题：",
      "- 约束：",
      "",
      "## 决策",
      "- 选定方案：",
      "- 原因：",
      "",
      "## 影响",
      "- 正向影响：",
      "- 风险：",
      "",
      "## 后续事项",
      "- [ ]",
      "",
    ].join("\n"),
  },
  {
    id: "handoff",
    label: "交接记录",
    defaultTitle: "handoff",
    description: "总结当前状态与下一步，便于无缝续接。",
    content: [
      "# 交接记录",
      "",
      "## 已完成",
      "-",
      "",
      "## 进行中",
      "-",
      "",
      "## 下一步",
      "- 1)",
      "- 2)",
      "",
      "## 风险",
      "-",
      "",
    ].join("\n"),
  },
  {
    id: "risk-log",
    label: "风险日志",
    defaultTitle: "risk-log",
    description: "跟踪已知风险、影响与缓解负责人。",
    content: [
      "# 风险日志",
      "",
      "## 风险项",
      "- 风险：",
      "  - 影响：",
      "  - 概率：",
      "  - 缓解措施：",
      "  - 负责人：",
      "",
    ].join("\n"),
  },
  {
    id: "daily-sync",
    label: "每日同步",
    defaultTitle: "daily-sync",
    description: "记录每日进展与阻塞项。",
    content: [
      "# 每日同步",
      "",
      "## 昨日",
      "-",
      "",
      "## 今日",
      "-",
      "",
      "## 阻塞项",
      "-",
      "",
    ].join("\n"),
  },
];

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatDateTag(date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function normalizeMemoryTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]/g, " ")
    .replace(/[._\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return normalized || "notes";
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deriveTitleFromEntryName(entryName: string): string {
  const base = entryName.replace(/\.md$/i, "");
  const withoutDate = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const withoutVersion = withoutDate.replace(/-v\d+$/i, "");
  const result = withoutVersion.trim();
  return result.length > 0 ? result : "notes";
}

export function suggestVersionedMemoryEntryName(params: {
  existingNames: string[];
  title: string;
  date?: Date;
}): string {
  const dateTag = formatDateTag(params.date);
  const slug = normalizeMemoryTitle(params.title);
  const base = `${dateTag}-${slug}`;
  const pattern = new RegExp(`^${escapeRegExp(base)}-v(\\d+)\\.md$`, "i");

  let maxVersion = 0;
  for (const name of params.existingNames) {
    const match = name.match(pattern);
    if (!match) continue;
    const version = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(version) && version > maxVersion) {
      maxVersion = version;
    }
  }

  return `${base}-v${maxVersion + 1}.md`;
}
