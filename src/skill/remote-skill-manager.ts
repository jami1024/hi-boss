import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REMOTE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SOURCE_METADATA_FILENAME = ".source.json";

export type RemoteSkillErrorCode =
  | "invalid-skill-name"
  | "invalid-source-url"
  | "insecure-source-url"
  | "unsupported-source-host"
  | "invalid-source-url-shape"
  | "unsafe-source-path"
  | "git-not-available"
  | "git-command-failed"
  | "source-path-not-found"
  | "invalid-skill-entry"
  | "missing-skill-md"
  | "unsafe-package-entry"
  | "unsupported-package-entry"
  | "skill-file-count-exceeded"
  | "skill-file-size-exceeded"
  | "skill-total-size-exceeded"
  | "metadata-invalid"
  | "install-failed"
  | "remote-skill-not-found";

export interface RemoteSkillInstallLimits {
  maxFileCount: number;
  maxSingleFileBytes: number;
  maxTotalBytes: number;
}

export interface RemoteSkillPackageStats {
  fileCount: number;
  totalBytes: number;
}

export const DEFAULT_REMOTE_SKILL_INSTALL_LIMITS: RemoteSkillInstallLimits = {
  maxFileCount: 200,
  maxSingleFileBytes: 512 * 1024,
  maxTotalBytes: 5 * 1024 * 1024,
};

export class RemoteSkillError extends Error {
  readonly errorCode: RemoteSkillErrorCode;
  readonly hint?: string;

  constructor(params: { errorCode: RemoteSkillErrorCode; message: string; hint?: string; cause?: unknown }) {
    super(params.message);
    this.name = "RemoteSkillError";
    this.errorCode = params.errorCode;
    this.hint = params.hint;
    if (params.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: params.cause,
        enumerable: false,
        configurable: true,
      });
    }
  }
}

function remoteSkillError(params: {
  errorCode: RemoteSkillErrorCode;
  message: string;
  hint?: string;
  cause?: unknown;
}): never {
  throw new RemoteSkillError(params);
}

function toRemoteSkillError(
  err: unknown,
  fallbackCode: RemoteSkillErrorCode,
  fallbackMessage: string
): RemoteSkillError {
  if (err instanceof RemoteSkillError) {
    return err;
  }
  if (err instanceof Error) {
    return new RemoteSkillError({
      errorCode: fallbackCode,
      message: err.message || fallbackMessage,
      cause: err,
    });
  }
  return new RemoteSkillError({
    errorCode: fallbackCode,
    message: fallbackMessage,
    cause: err,
  });
}

export type RemoteSkillTargetType = "agent" | "project";

export interface RemoteSkillTarget {
  type: RemoteSkillTargetType;
  id: string;
  rootDir: string;
}

export interface RemoteSkillRecord {
  skillName: string;
  sourceUrl: string;
  repositoryUrl: string;
  sourcePath: string;
  sourceRef: string;
  commit: string;
  checksum: string;
  fileCount: number;
  status: "valid" | "error";
  addedAt: string;
  lastUpdated: string;
  targetType: RemoteSkillTargetType;
  targetId: string;
}

export interface InstallRemoteSkillOptions {
  target: RemoteSkillTarget;
  skillName: string;
  sourceUrl: string;
  ref?: string;
}

export interface UpdateRemoteSkillOptions {
  target: RemoteSkillTarget;
  skillName: string;
  sourceUrl?: string;
  ref?: string;
}

interface ParsedRemoteSkillSource {
  sourceUrl: string;
  repositoryUrl: string;
  sourceRef: string;
  sourcePath: string;
}

function normalizePathSlashes(input: string): string {
  return input.replace(/\\/g, "/");
}

function assertNoTraversal(input: string): void {
  const segments = normalizePathSlashes(input)
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (segments.includes("..")) {
    remoteSkillError({
      errorCode: "unsafe-source-path",
      message: "Source path must not contain '..'",
      hint: "Use a repository-relative directory path without parent traversal.",
    });
  }
}

function trimSlashes(input: string): string {
  return normalizePathSlashes(input).replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeRef(raw: string | undefined): string {
  if (!raw) return "HEAD";
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : "HEAD";
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KiB`;
  }
  return `${value} B`;
}

function resolveInstallLimits(overrides?: Partial<RemoteSkillInstallLimits>): RemoteSkillInstallLimits {
  const fallback = DEFAULT_REMOTE_SKILL_INSTALL_LIMITS;
  if (!overrides) return fallback;
  const maxFileCount =
    typeof overrides.maxFileCount === "number" && Number.isFinite(overrides.maxFileCount)
      ? Math.max(1, Math.trunc(overrides.maxFileCount))
      : fallback.maxFileCount;
  const maxSingleFileBytes =
    typeof overrides.maxSingleFileBytes === "number" && Number.isFinite(overrides.maxSingleFileBytes)
      ? Math.max(1, Math.trunc(overrides.maxSingleFileBytes))
      : fallback.maxSingleFileBytes;
  const maxTotalBytes =
    typeof overrides.maxTotalBytes === "number" && Number.isFinite(overrides.maxTotalBytes)
      ? Math.max(1, Math.trunc(overrides.maxTotalBytes))
      : fallback.maxTotalBytes;

  return {
    maxFileCount,
    maxSingleFileBytes,
    maxTotalBytes,
  };
}

function decodePathSegments(segments: string[]): string {
  return segments.map((segment) => decodeURIComponent(segment)).join("/");
}

export function normalizeRemoteSkillName(rawName: string): string {
  const normalized = rawName.trim().toLowerCase();
  if (!REMOTE_SKILL_NAME_PATTERN.test(normalized)) {
    remoteSkillError({
      errorCode: "invalid-skill-name",
      message: "Invalid skill name (expected lowercase letters/numbers with optional . _ -)",
      hint: "Example: code-review",
    });
  }
  return normalized;
}

export function parseRemoteSkillSource(sourceUrl: string, refOverride?: string): ParsedRemoteSkillSource {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    remoteSkillError({
      errorCode: "invalid-source-url",
      message: "Invalid source URL",
      hint: "Use a full https:// URL from github.com or raw.githubusercontent.com",
    });
  }

  if (url.protocol !== "https:") {
    remoteSkillError({
      errorCode: "insecure-source-url",
      message: "Remote skill source must use https://",
      hint: "HTTP sources are blocked for security reasons.",
    });
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((part) => part.length > 0);

  if (host === "raw.githubusercontent.com") {
    if (segments.length < 4) {
      remoteSkillError({
        errorCode: "invalid-source-url-shape",
        message: "Invalid raw GitHub URL: expected /<owner>/<repo>/<ref>/<path>",
        hint: "Example: https://raw.githubusercontent.com/org/repo/main/skills/code-review/SKILL.md",
      });
    }
    const owner = decodeURIComponent(segments[0]);
    const repo = decodeURIComponent(segments[1]).replace(/\.git$/i, "");
    const sourceRef = normalizeRef(refOverride ?? decodeURIComponent(segments[2]));
    const sourcePath = trimSlashes(decodePathSegments(segments.slice(3)));
    assertNoTraversal(sourcePath);
    return {
      sourceUrl,
      repositoryUrl: `https://github.com/${owner}/${repo}.git`,
      sourceRef,
      sourcePath,
    };
  }

  if (host === "github.com") {
    if (segments.length < 2) {
      remoteSkillError({
        errorCode: "invalid-source-url-shape",
        message: "Invalid GitHub URL: expected /<owner>/<repo>/...",
        hint: "Example: https://github.com/org/repo/tree/main/skills/code-review",
      });
    }

    const owner = decodeURIComponent(segments[0]);
    const repo = decodeURIComponent(segments[1]).replace(/\.git$/i, "");
    let parsedRef = "HEAD";
    let parsedPath = "";

    if (segments.length >= 4 && (segments[2] === "blob" || segments[2] === "tree" || segments[2] === "raw")) {
      parsedRef = decodeURIComponent(segments[3]);
      parsedPath = decodePathSegments(segments.slice(4));
    }

    const sourceRef = normalizeRef(refOverride ?? parsedRef);
    const sourcePath = trimSlashes(parsedPath);
    assertNoTraversal(sourcePath);

    return {
      sourceUrl,
      repositoryUrl: `https://github.com/${owner}/${repo}.git`,
      sourceRef,
      sourcePath,
    };
  }

  remoteSkillError({
    errorCode: "unsupported-source-host",
    message: "Unsupported source host. Use github.com or raw.githubusercontent.com",
    hint: "Only GitHub sources are supported in this version.",
  });
}

function ensureDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveWithin(rootDir: string, relativePath: string): string {
  const resolved = path.resolve(rootDir, relativePath || ".");
  const normalizedRoot = path.resolve(rootDir);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    remoteSkillError({
      errorCode: "unsafe-source-path",
      message: "Resolved path escaped repository root",
      hint: "Use a path inside the selected repository/ref.",
    });
  }
  return resolved;
}

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const gitUnavailable = /ENOENT|spawnSync git/i.test(message);
    remoteSkillError({
      errorCode: gitUnavailable ? "git-not-available" : "git-command-failed",
      message: `git ${args.join(" ")} failed: ${message}`,
      hint: gitUnavailable
        ? "Install git and ensure it is available in PATH."
        : "Verify repository URL/ref and network connectivity.",
      cause: err,
    });
  }
}

function checkoutRepositoryRef(repositoryUrl: string, sourceRef: string): { repoDir: string; commit: string; cleanup: () => void } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-remote-skill-"));
  const repoDir = path.join(tempRoot, "repo");
  fs.mkdirSync(repoDir, { recursive: true });

  try {
    runGit(["init"], repoDir);
    runGit(["remote", "add", "origin", repositoryUrl], repoDir);
    runGit(["fetch", "--depth", "1", "origin", sourceRef], repoDir);
    runGit(["checkout", "FETCH_HEAD"], repoDir);
    const commit = runGit(["rev-parse", "HEAD"], repoDir);
    return {
      repoDir,
      commit,
      cleanup: () => fs.rmSync(tempRoot, { recursive: true, force: true }),
    };
  } catch (err) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw err;
  }
}

function resolveSkillDirectoryFromSource(repoDir: string, sourcePath: string): string {
  const sourceEntry = resolveWithin(repoDir, sourcePath || ".");
  if (!fs.existsSync(sourceEntry)) {
    remoteSkillError({
      errorCode: "source-path-not-found",
      message: `Source path not found in repository: ${sourcePath || "."}`,
      hint: "Check the ref/path points to the skill directory or SKILL.md file.",
    });
  }

  const entryStat = fs.statSync(sourceEntry);
  const skillDir = entryStat.isFile()
    ? path.dirname(sourceEntry)
    : sourceEntry;

  if (entryStat.isFile() && path.basename(sourceEntry).toLowerCase() !== "skill.md") {
    remoteSkillError({
      errorCode: "invalid-skill-entry",
      message: "If source path points to a file, it must be SKILL.md",
      hint: "Point to a directory containing SKILL.md or directly to SKILL.md.",
    });
  }

  const entrySkillFile = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(entrySkillFile) || !fs.statSync(entrySkillFile).isFile()) {
    remoteSkillError({
      errorCode: "missing-skill-md",
      message: "Skill directory must contain SKILL.md",
      hint: "Ensure SKILL.md exists at the root of the selected skill directory.",
    });
  }

  return skillDir;
}

export function validateRemoteSkillPackageLimits(
  sourceDir: string,
  overrides?: Partial<RemoteSkillInstallLimits>
): RemoteSkillPackageStats {
  const limits = resolveInstallLimits(overrides);
  const stats: RemoteSkillPackageStats = {
    fileCount: 0,
    totalBytes: 0,
  };

  const visit = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;

      const absolutePath = path.join(dir, entry.name);
      const itemStats = fs.lstatSync(absolutePath);
      if (itemStats.isSymbolicLink()) {
        remoteSkillError({
          errorCode: "unsafe-package-entry",
          message: `Symbolic links are not allowed in skill package (${entry.name})`,
          hint: "Replace symlinks with regular files/directories in the source skill.",
        });
      }

      if (itemStats.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (!itemStats.isFile()) {
        remoteSkillError({
          errorCode: "unsupported-package-entry",
          message: `Unsupported file type in skill package (${entry.name})`,
          hint: "Only regular files and directories are supported.",
        });
      }

      const nextFileCount = stats.fileCount + 1;
      if (nextFileCount > limits.maxFileCount) {
        remoteSkillError({
          errorCode: "skill-file-count-exceeded",
          message: `Skill package exceeds max file count (${limits.maxFileCount})`,
          hint: "Reduce files in the skill directory or split the skill into smaller bundles.",
        });
      }

      if (itemStats.size > limits.maxSingleFileBytes) {
        remoteSkillError({
          errorCode: "skill-file-size-exceeded",
          message: `Skill file '${entry.name}' exceeds max size (${formatBytes(limits.maxSingleFileBytes)})`,
          hint: "Keep large binaries outside the skill package and reference them by URL/path.",
        });
      }

      const nextTotalBytes = stats.totalBytes + itemStats.size;
      if (nextTotalBytes > limits.maxTotalBytes) {
        remoteSkillError({
          errorCode: "skill-total-size-exceeded",
          message: `Skill package exceeds max total size (${formatBytes(limits.maxTotalBytes)})`,
          hint: "Trim docs/examples or split this skill into focused smaller skills.",
        });
      }

      stats.fileCount = nextFileCount;
      stats.totalBytes = nextTotalBytes;
    }
  };

  visit(sourceDir);
  return stats;
}

function copyDirectoryTreeSafe(sourceDir: string, targetDir: string): void {
  ensureDirectory(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    const stats = fs.lstatSync(sourcePath);
    if (stats.isSymbolicLink()) {
      remoteSkillError({
        errorCode: "unsafe-package-entry",
        message: `Symbolic links are not allowed in skill package (${entry.name})`,
        hint: "Replace symlinks with regular files/directories in the source skill.",
      });
    }
    if (stats.isDirectory()) {
      copyDirectoryTreeSafe(sourcePath, targetPath);
      continue;
    }
    if (stats.isFile()) {
      ensureDirectory(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
      continue;
    }
    remoteSkillError({
      errorCode: "unsupported-package-entry",
      message: `Unsupported file type in skill package (${entry.name})`,
      hint: "Only regular files and directories are supported.",
    });
  }
}

function collectFilesRecursively(rootDir: string): string[] {
  const results: string[] = [];
  const visit = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizePathSlashes(path.relative(rootDir, absolutePath));
      if (relativePath === SOURCE_METADATA_FILENAME) continue;
      results.push(relativePath);
    }
  };
  visit(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

function computeDirectoryChecksum(rootDir: string): { checksum: string; fileCount: number } {
  const files = collectFilesRecursively(rootDir);
  const hash = createHash("sha256");
  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath);
    const data = fs.readFileSync(absolutePath);
    const fileHash = createHash("sha256").update(data).digest("hex");
    hash.update(relativePath);
    hash.update("\u0000");
    hash.update(fileHash);
    hash.update("\n");
  }

  return {
    checksum: hash.digest("hex"),
    fileCount: files.length,
  };
}

function metadataPathForSkillDir(skillDir: string): string {
  return path.join(skillDir, SOURCE_METADATA_FILENAME);
}

function readRemoteSkillMetadata(skillDir: string): RemoteSkillRecord | null {
  const metadataPath = metadataPathForSkillDir(skillDir);
  if (!fs.existsSync(metadataPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as RemoteSkillRecord;
    if (typeof parsed.skillName !== "string" || typeof parsed.sourceUrl !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRemoteSkillMetadata(skillDir: string, metadata: RemoteSkillRecord): void {
  const metadataPath = metadataPathForSkillDir(skillDir);
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function ensureTargetSkillRoot(target: RemoteSkillTarget): string {
  const normalizedRoot = path.resolve(target.rootDir);
  ensureDirectory(normalizedRoot);
  return normalizedRoot;
}

function installSkillDirectoryAtomic(skillName: string, targetRoot: string, sourceSkillDir: string): string {
  const installDir = path.join(targetRoot, skillName);
  const stagingDir = path.join(targetRoot, `.tmp-${skillName}-${Date.now().toString(36)}`);
  const backupDir = path.join(targetRoot, `.backup-${skillName}-${Date.now().toString(36)}`);

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  copyDirectoryTreeSafe(sourceSkillDir, stagingDir);

  if (!fs.existsSync(installDir)) {
    fs.renameSync(stagingDir, installDir);
    return installDir;
  }

  fs.renameSync(installDir, backupDir);
  try {
    fs.renameSync(stagingDir, installDir);
    fs.rmSync(backupDir, { recursive: true, force: true });
    return installDir;
  } catch (err) {
    if (fs.existsSync(backupDir) && !fs.existsSync(installDir)) {
      fs.renameSync(backupDir, installDir);
    }
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw err;
  }
}

export function installRemoteSkill(options: InstallRemoteSkillOptions): RemoteSkillRecord {
  const skillName = normalizeRemoteSkillName(options.skillName);
  const parsedSource = parseRemoteSkillSource(options.sourceUrl, options.ref);
  const targetRoot = ensureTargetSkillRoot(options.target);
  const installDir = path.join(targetRoot, skillName);
  const existing = readRemoteSkillMetadata(installDir);

  const checkout = checkoutRepositoryRef(parsedSource.repositoryUrl, parsedSource.sourceRef);
  try {
    try {
      const sourceSkillDir = resolveSkillDirectoryFromSource(checkout.repoDir, parsedSource.sourcePath);
      validateRemoteSkillPackageLimits(sourceSkillDir);
      const installedDir = installSkillDirectoryAtomic(skillName, targetRoot, sourceSkillDir);
      const digest = computeDirectoryChecksum(installedDir);
      const nowIso = new Date().toISOString();

      const record: RemoteSkillRecord = {
        skillName,
        sourceUrl: parsedSource.sourceUrl,
        repositoryUrl: parsedSource.repositoryUrl,
        sourcePath: parsedSource.sourcePath,
        sourceRef: parsedSource.sourceRef,
        commit: checkout.commit,
        checksum: digest.checksum,
        fileCount: digest.fileCount,
        status: "valid",
        addedAt: existing?.addedAt ?? nowIso,
        lastUpdated: nowIso,
        targetType: options.target.type,
        targetId: options.target.id,
      };

      writeRemoteSkillMetadata(installedDir, record);
      return record;
    } catch (err) {
      throw toRemoteSkillError(err, "install-failed", "Failed to install remote skill package");
    }
  } finally {
    checkout.cleanup();
  }
}

export function listRemoteSkills(target: RemoteSkillTarget): RemoteSkillRecord[] {
  const targetRoot = ensureTargetSkillRoot(target);
  const entries = fs.readdirSync(targetRoot, { withFileTypes: true });
  const skills: RemoteSkillRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-") || entry.name.startsWith(".backup-")) {
      continue;
    }

    const skillDir = path.join(targetRoot, entry.name);
    const metadata = readRemoteSkillMetadata(skillDir);
    if (!metadata) continue;
    skills.push(metadata);
  }

  return skills.sort((a, b) => a.skillName.localeCompare(b.skillName));
}

export function getRemoteSkill(target: RemoteSkillTarget, skillName: string): RemoteSkillRecord | null {
  const normalizedSkillName = normalizeRemoteSkillName(skillName);
  const targetRoot = ensureTargetSkillRoot(target);
  return readRemoteSkillMetadata(path.join(targetRoot, normalizedSkillName));
}

export function updateRemoteSkill(options: UpdateRemoteSkillOptions): RemoteSkillRecord {
  const skillName = normalizeRemoteSkillName(options.skillName);
  const existing = getRemoteSkill(options.target, skillName);
  if (!existing) {
    remoteSkillError({
      errorCode: "remote-skill-not-found",
      message: `Remote skill '${skillName}' not found`,
    });
  }

  return installRemoteSkill({
    target: options.target,
    skillName,
    sourceUrl: options.sourceUrl ?? existing.sourceUrl,
    ref: options.ref ?? existing.sourceRef,
  });
}

export function removeRemoteSkill(target: RemoteSkillTarget, skillName: string): void {
  const normalizedSkillName = normalizeRemoteSkillName(skillName);
  const targetRoot = ensureTargetSkillRoot(target);
  const skillDir = path.join(targetRoot, normalizedSkillName);
  if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
    remoteSkillError({
      errorCode: "remote-skill-not-found",
      message: `Remote skill '${normalizedSkillName}' not found`,
    });
  }
  fs.rmSync(skillDir, { recursive: true, force: true });
}
