export type MemoryDiffLineType = "context" | "add" | "remove";

export interface MemoryDiffLine {
  id: string;
  type: MemoryDiffLineType;
  text: string;
}

export interface MemoryDiffResult {
  lines: MemoryDiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
}

const DEFAULT_MAX_DIFF_LINES = 400;

function normalizeLines(input: string): string[] {
  return input.replace(/\r\n/g, "\n").split("\n");
}

export function computeProjectMemoryDiff(
  beforeText: string,
  afterText: string,
  maxLines = DEFAULT_MAX_DIFF_LINES
): MemoryDiffResult {
  const beforeLines = normalizeLines(beforeText);
  const afterLines = normalizeLines(afterText);

  const cappedBefore = beforeLines.slice(0, maxLines);
  const cappedAfter = afterLines.slice(0, maxLines);
  const truncated = beforeLines.length > maxLines || afterLines.length > maxLines;

  const n = cappedBefore.length;
  const m = cappedAfter.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const currentRow = dp[i];
      const previousRow = dp[i - 1];
      if (!currentRow || !previousRow) continue;
      if (cappedBefore[i - 1] === cappedAfter[j - 1]) {
        currentRow[j] = (previousRow[j - 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(previousRow[j] ?? 0, currentRow[j - 1] ?? 0);
      }
    }
  }

  const reversed: MemoryDiffLine[] = [];
  let i = n;
  let j = m;
  let added = 0;
  let removed = 0;

  while (i > 0 && j > 0) {
    if (cappedBefore[i - 1] === cappedAfter[j - 1]) {
      reversed.push({ id: "", type: "context", text: cappedBefore[i - 1] ?? "" });
      i -= 1;
      j -= 1;
      continue;
    }

    const up = dp[i - 1]?.[j] ?? 0;
    const left = dp[i]?.[j - 1] ?? 0;
    if (up >= left) {
      reversed.push({ id: "", type: "remove", text: cappedBefore[i - 1] ?? "" });
      removed += 1;
      i -= 1;
      continue;
    }

    reversed.push({ id: "", type: "add", text: cappedAfter[j - 1] ?? "" });
    added += 1;
    j -= 1;
  }

  while (i > 0) {
    reversed.push({ id: "", type: "remove", text: cappedBefore[i - 1] ?? "" });
    removed += 1;
    i -= 1;
  }

  while (j > 0) {
    reversed.push({ id: "", type: "add", text: cappedAfter[j - 1] ?? "" });
    added += 1;
    j -= 1;
  }

  return {
    lines: reversed.reverse().map((line, index) => ({
      ...line,
      id: `${line.type}:${index}:${line.text}`,
    })),
    added,
    removed,
    truncated,
  };
}
