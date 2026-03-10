export type ProjectChatIntentKind = "requirement" | "qa";

const REQUIREMENT_OVERRIDE_PATTERN = /^\s*\[(?:req|requirement|task|需求|任务|工单)\]/i;
const QA_OVERRIDE_PATTERN = /^\s*\[(?:qa|q&a|问答|chat)\]/i;
const REQUEST_PATTERN = /(帮我|请你|请帮|麻烦|需要你|给我|can you|please)/i;
const REQUIREMENT_VERB_PATTERN =
  /(实现|开发|新增|添加|修复|优化|重构|改造|搭建|部署|接入|集成|设计|编写|完成|推进|落地|交付|implement|build|create|fix|refactor|optimi[sz]e)/i;
const REQUIREMENT_HINT_PATTERN =
  /(需求|任务|工单|待办|里程碑|排期|交付|验收|feature|bug|issue|ticket|todo)/i;
const QUESTION_PREFIX_PATTERN =
  /^\s*(什么|怎么|如何|为何|为什么|是否|能否|可以|请问|介绍|解释|what|how|why|when|where|which|can)\b/i;
const ACTION_STRUCTURE_PATTERN =
  /(?:^|\n)\s*(目标|范围|验收|要求|步骤|输出|截止|deadline|priority|优先级|todo)\s*[:：]/i;
const QUESTION_MARK_PATTERN = /[?？]/;

function stripIntentPrefix(text: string): string {
  return text
    .replace(REQUIREMENT_OVERRIDE_PATTERN, "")
    .replace(QA_OVERRIDE_PATTERN, "")
    .trim();
}

export function classifyProjectChatIntent(text: string): ProjectChatIntentKind {
  const normalized = text.trim();
  if (!normalized) return "qa";
  if (REQUIREMENT_OVERRIDE_PATTERN.test(normalized)) return "requirement";
  if (QA_OVERRIDE_PATTERN.test(normalized)) return "qa";

  const hasQuestionMark = QUESTION_MARK_PATTERN.test(normalized);
  const hasQuestionPrefix = QUESTION_PREFIX_PATTERN.test(normalized);
  const hasRequirementVerb = REQUIREMENT_VERB_PATTERN.test(normalized);
  const hasRequirementHint = REQUIREMENT_HINT_PATTERN.test(normalized);
  const hasRequest = REQUEST_PATTERN.test(normalized);
  const hasActionStructure = ACTION_STRUCTURE_PATTERN.test(normalized);

  if (hasActionStructure || hasRequirementHint) return "requirement";
  if (hasRequirementVerb && (hasRequest || !hasQuestionMark)) return "requirement";
  if (hasRequirementVerb && hasQuestionMark && !hasQuestionPrefix) return "requirement";
  if (hasQuestionMark || hasQuestionPrefix) return "qa";

  return hasRequirementVerb ? "requirement" : "qa";
}

export function deriveProjectTaskTitleFromMessage(text: string, maxLength = 80): string {
  const cleaned = stripIntentPrefix(text);
  const firstLine = cleaned
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const normalized = (firstLine ?? cleaned ?? "")
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "自动识别需求";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}
