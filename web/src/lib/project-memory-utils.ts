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
    label: "Decision Record",
    defaultTitle: "decision-record",
    description: "Capture a key technical/product decision with trade-offs.",
    content: [
      "# Decision Record",
      "",
      "## Context",
      "- Problem:",
      "- Constraints:",
      "",
      "## Decision",
      "- Chosen option:",
      "- Why:",
      "",
      "## Consequences",
      "- Positive:",
      "- Risks:",
      "",
      "## Follow-ups",
      "- [ ]",
      "",
    ].join("\n"),
  },
  {
    id: "handoff",
    label: "Handoff",
    defaultTitle: "handoff",
    description: "Summarize current status and next steps for seamless continuation.",
    content: [
      "# Handoff",
      "",
      "## Done",
      "-",
      "",
      "## In Progress",
      "-",
      "",
      "## Next",
      "- 1)",
      "- 2)",
      "",
      "## Risks",
      "-",
      "",
    ].join("\n"),
  },
  {
    id: "risk-log",
    label: "Risk Log",
    defaultTitle: "risk-log",
    description: "Track known risks, impact, and mitigation owners.",
    content: [
      "# Risk Log",
      "",
      "## Risk Items",
      "- Risk:",
      "  - Impact:",
      "  - Probability:",
      "  - Mitigation:",
      "  - Owner:",
      "",
    ].join("\n"),
  },
  {
    id: "daily-sync",
    label: "Daily Sync",
    defaultTitle: "daily-sync",
    description: "Capture daily status updates and blockers.",
    content: [
      "# Daily Sync",
      "",
      "## Yesterday",
      "-",
      "",
      "## Today",
      "-",
      "",
      "## Blockers",
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
