#!/usr/bin/env node
/**
 * 补丁镜像版本身份的唯一解析/校验 helper（无第三方依赖，无网络/时间/提交数猜测）。
 *
 * 上游源码 tag 保持 vX.Y.Z；canonical 镜像 tag 为 vX.Y.Z-pN；
 * N 唯一来源是仓库根 PATCH_REVISION（全局单调、永不重置）。
 * 完整 tag 或 workflow patch_revision 输入中的 N 必须与之相等，否则拒绝——
 * 历史回填应 checkout 对应历史 commit，而不是把当前补丁塞进旧 N。
 * 旧无后缀 vX.Y.Z = p0，仅历史/回滚，不发布、不参与幂等判断。
 * 临时架构 tag 为 vX.Y.Z-pN-<arch>-<run_id>；canonical tag 不可覆写。
 */

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REVISION_FILE = "PATCH_REVISION";
export const ARCHES = Object.freeze(["amd64", "arm64"]);
export const TAG_EXISTS = "exists";
export const TAG_ABSENT = "absent";
export const TAG_ERROR = "error";

/** patches/** 与构建/调度输入变更时，CI 强制要求 PATCH_REVISION 严格递增。 */
export const IMAGE_AFFECTING_EXACT = Object.freeze([
  ".github/workflows/release-docker.yml",
  ".github/workflows/watch-upstream.yml",
  ".github/workflows/release-cron.yml",
  ".github/workflows/check-image-version.yml",
  "scripts/image-version.mjs",
  "scripts/registry-tag-state.mjs",
  "scripts/check-image-version.mjs",
]);
export const IMAGE_AFFECTING_PREFIXES = Object.freeze(["patches/"]);

const UPSTREAM_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const FULL_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-p([1-9][0-9]*)$/;
const FOUR_PART_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.[0-9]+$/;
const REVISION_RE = /^[1-9][0-9]*$/;
const RUN_ID_RE = /^[1-9][0-9]*$/;
const IMAGE_REF_RE = /^ghcr\.io\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/;
const OUTPUT_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export class VersionError extends Error {
  constructor(message) {
    super(message);
    this.name = "VersionError";
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new VersionError(`${label} 不能为空`);
  }
}

function parseSemverComponent(digits, label) {
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 0 || String(value) !== digits) {
    throw new VersionError(
      `${label} 必须是 ASCII 安全非负整数（不得溢出或丢精度），实际为 ${JSON.stringify(digits)}`,
    );
  }
  return value;
}

function parseRevisionNumber(digits, label) {
  const value = parseSemverComponent(digits, label);
  if (value < 1) {
    throw new VersionError(`${label} 必须 >= 1，实际为 ${JSON.stringify(digits)}`);
  }
  return value;
}

/** 纯文本正整数；只允许一个结尾换行，拒绝空白/符号/前导零/多行。 */
export function parseRevisionText(text, label = REVISION_FILE) {
  if (typeof text !== "string") {
    throw new VersionError(`${label} 必须是文本`);
  }
  let body = text;
  if (body.endsWith("\r\n")) body = body.slice(0, -2);
  else if (body.endsWith("\n")) body = body.slice(0, -1);
  if (!REVISION_RE.test(body)) {
    throw new VersionError(
      `${label} 必须是十进制正整数文本（无符号、无前导零、无空白、单行），实际为 ${JSON.stringify(text)}`,
    );
  }
  return parseRevisionNumber(body, label);
}

export function readRevisionFile(path = REVISION_FILE) {
  try {
    return parseRevisionText(readFileSync(path, "utf8"), path);
  } catch (error) {
    if (error instanceof VersionError) throw error;
    throw new VersionError(`读取受控修订文件 ${path} 失败：${error.message}`);
  }
}

export function parseImageTag(raw) {
  assertString(raw, "版本/tag");
  if (raw !== raw.trim()) {
    throw new VersionError(`版本/tag 不允许前后空白：${JSON.stringify(raw)}`);
  }
  const tag = raw;
  const full = FULL_RE.exec(tag);
  if (full) {
    parseSemverComponent(full[1], "完整 tag 的 X");
    parseSemverComponent(full[2], "完整 tag 的 Y");
    parseSemverComponent(full[3], "完整 tag 的 Z");
    return {
      kind: "full",
      upstreamTag: `v${full[1]}.${full[2]}.${full[3]}`,
      patchRevision: parseRevisionNumber(full[4], "完整 tag 的 pN"),
    };
  }
  if (UPSTREAM_RE.test(tag)) {
    const upstream = UPSTREAM_RE.exec(tag);
    parseSemverComponent(upstream[1], "上游 tag 的 X");
    parseSemverComponent(upstream[2], "上游 tag 的 Y");
    parseSemverComponent(upstream[3], "上游 tag 的 Z");
    return { kind: "upstream", upstreamTag: tag, patchRevision: null };
  }
  if (FOUR_PART_RE.test(tag)) {
    throw new VersionError(`${tag} 是四段版本号；镜像 tag 使用 vX.Y.Z-pN，禁止第四段 semver`);
  }
  throw new VersionError(
    `无法识别的版本/tag：${JSON.stringify(tag)}。上游 tag 必须形如 vX.Y.Z，自构建 tag 必须形如 vX.Y.Z-pN`,
  );
}

function parseExplicitRevision(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  return text ? parseRevisionText(text, "workflow patch_revision 输入") : null;
}

/**
 * 解析唯一镜像身份：N 必须等于仓库 PATCH_REVISION（单一来源，无自由 override）。
 */
export function resolveImageIdentity({ version, patchRevision, controlledRevision }) {
  if (!Number.isSafeInteger(controlledRevision) || controlledRevision < 1) {
    throw new VersionError(`缺少有效的受控 ${REVISION_FILE}`);
  }
  const parsed = parseImageTag(version);
  const explicit = parseExplicitRevision(patchRevision);
  let revision;
  let revisionSource;
  if (parsed.kind === "full") {
    revision = parsed.patchRevision;
    revisionSource = "full-tag";
    if (explicit !== null && explicit !== revision) {
      throw new VersionError(
        `完整 tag 的 N=${revision} 与 patch_revision 输入 ${explicit} 不一致：拒绝构建`,
      );
    }
  } else if (explicit !== null) {
    revision = explicit;
    revisionSource = "explicit";
  } else {
    revision = controlledRevision;
    revisionSource = "controlled";
  }
  if (revision !== controlledRevision) {
    throw new VersionError(
      `镜像 tag 的 N=${revision} 与仓库 ${REVISION_FILE}=${controlledRevision} 不一致：` +
        "拒绝构建。历史回填请 checkout 对应历史 commit，而不是把当前补丁塞进旧 N。",
    );
  }
  const imageTag = `${parsed.upstreamTag}-p${revision}`;
  if (imageTag.length > 128) {
    throw new VersionError(`canonical 镜像 tag 超过 Docker 上限 128 字符：${JSON.stringify(imageTag)}`);
  }
  return {
    upstreamTag: parsed.upstreamTag,
    patchRevision: revision,
    imageTag,
    revisionSource,
  };
}

/** 临时架构 tag：<canonical>-<arch>-<run_id>，与 canonical tag 分离。 */
export function archStagingTag(imageTag, arch, runId) {
  assertString(imageTag, "canonical image tag");
  if (!FULL_RE.test(imageTag.trim())) {
    throw new VersionError(`staging 基准必须是完整 canonical tag vX.Y.Z-pN：${JSON.stringify(imageTag)}`);
  }
  if (!ARCHES.includes(arch)) {
    throw new VersionError(`不支持的架构 ${JSON.stringify(arch)}；允许：${ARCHES.join(", ")}`);
  }
  const runText = String(runId ?? "").trim();
  if (!RUN_ID_RE.test(runText)) {
    throw new VersionError(`run_id 必须是十进制正整数文本：${JSON.stringify(runId)}`);
  }
  const staging = `${imageTag.trim()}-${arch}-${runText}`;
  if (staging.length > 128) {
    throw new VersionError(`staging 镜像 tag 超过 Docker 上限 128 字符：${JSON.stringify(staging)}`);
  }
  return staging;
}

/** 200 → exists；404 → absent；其余（401/403/429/5xx）→ error（fail closed）。 */
export function classifyManifestStatus(status) {
  if (status === 200) return TAG_EXISTS;
  if (status === 404) return TAG_ABSENT;
  return TAG_ERROR;
}

export function parseImageRef(image) {
  assertString(image, "镜像名");
  const match = IMAGE_REF_RE.exec(image.trim());
  if (!match) {
    throw new VersionError(`镜像名必须形如 ghcr.io/<owner>/<repo> 且全小写：${JSON.stringify(image)}`);
  }
  return { repository: `${match[1]}/${match[2]}` };
}

export function decidePrepare(canonicalState) {
  if (canonicalState === TAG_ABSENT) return "build";
  if (canonicalState === TAG_EXISTS) return "skip";
  throw new VersionError(
    `canonical tag 状态为 ${JSON.stringify(canonicalState)}；registry 查询失败必须 fail closed`,
  );
}

export function decidePublish(canonicalState, stagingStates) {
  if (canonicalState === TAG_EXISTS) {
    throw new VersionError("canonical tag 已存在：拒绝覆写不可变镜像 tag（并发发布或重复触发）");
  }
  if (canonicalState !== TAG_ABSENT) {
    throw new VersionError(
      `canonical tag 状态为 ${JSON.stringify(canonicalState)}；发布前校验失败必须 fail closed`,
    );
  }
  const names = Object.keys(stagingStates ?? {});
  if (names.length === 0) throw new VersionError("缺少临时架构 tag 状态，无法发布");
  for (const name of names) {
    if (stagingStates[name] !== TAG_EXISTS) {
      throw new VersionError(
        `临时架构 tag ${name} 状态为 ${JSON.stringify(stagingStates[name])}；缺少可发布的架构镜像`,
      );
    }
  }
  return "publish";
}

function normalizePath(path) {
  let text = String(path ?? "").trim().replaceAll("\\", "/");
  while (text.startsWith("./")) text = text.slice(2);
  return text;
}

export function isImageAffectingPath(path) {
  const normalized = normalizePath(path);
  return (
    IMAGE_AFFECTING_EXACT.includes(normalized) ||
    IMAGE_AFFECTING_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

/**
 * 基线 diff 纪律：首次引入=1；不得回退；镜像相关变更必须严格递增；
 * 无镜像相关变更时允许不变或单独递增（重建）。
 */
export function evaluateRevisionChange({ baseText, headText, changedPaths = [] }) {
  const affecting = [...new Set(changedPaths.filter(isImageAffectingPath).map(normalizePath))].sort();
  const result = { ok: false, errors: [], warnings: [], imageAffectingChanges: affecting, base: null, head: null };
  try {
    result.head = parseRevisionText(headText, "PATCH_REVISION(HEAD)");
  } catch (error) {
    result.errors.push(error.message);
    return result;
  }
  if (baseText === null || baseText === undefined) {
    if (result.head !== 1) result.errors.push(`首次引入 PATCH_REVISION 必须为 1，实际为 ${result.head}`);
    result.ok = result.errors.length === 0;
    return result;
  }
  try {
    result.base = parseRevisionText(baseText, "PATCH_REVISION(BASE)");
  } catch (error) {
    result.errors.push(`基线 PATCH_REVISION 无效：${error.message}`);
    return result;
  }
  if (result.head < result.base) {
    result.errors.push(`PATCH_REVISION 不得回退：${result.base} → ${result.head}`);
  }
  if (affecting.length > 0 && result.head <= result.base) {
    result.errors.push(
      `镜像相关文件发生变更，PATCH_REVISION 必须严格递增：${result.base} → ${result.head}（变更：${affecting.join(", ")}）`,
    );
  }
  if (affecting.length === 0 && result.head > result.base) {
    result.warnings.push(`仅递增 PATCH_REVISION（${result.base} → ${result.head}），允许用于重建镜像`);
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// CLI（供 workflow 调用；只读、无副作用）
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const flags = { staging: [], "changed-path": [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new VersionError(`未知参数：${JSON.stringify(arg)}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new VersionError(`--${key} 缺少值`);
    index += 1;
    if (key === "staging" || key === "changed-path") flags[key].push(value);
    else flags[key] = value;
  }
  return flags;
}

function requireFlag(flags, key) {
  if (flags[key] === undefined) throw new VersionError(`缺少 --${key}`);
  return flags[key];
}

function emit(path, entries) {
  if (path) appendFileSync(path, entries.map(([key, value]) => `${key}=${value}\n`).join(""), "utf8");
  for (const [key, value] of entries) console.log(`${key}=${value}`);
}

function parseNamed(items, label) {
  const states = {};
  for (const item of items) {
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      throw new VersionError(`${label} 参数必须形如 name=value：${JSON.stringify(item)}`);
    }
    const name = item.slice(0, separator);
    if (!OUTPUT_NAME_RE.test(name)) throw new VersionError(`${label} 名称非法：${JSON.stringify(name)}`);
    if (name in states) throw new VersionError(`${label} 名称重复：${JSON.stringify(name)}`);
    states[name] = item.slice(separator + 1);
  }
  if (Object.keys(states).length === 0) throw new VersionError(`至少需要一个 ${label} 参数`);
  return states;
}

const COMMANDS = {
  resolve(argv) {
    const flags = parseFlags(argv);
    const controlled = readRevisionFile(flags.file ?? REVISION_FILE);
    const identity = resolveImageIdentity({
      version: requireFlag(flags, "version"),
      patchRevision: flags["patch-revision"] ?? "",
      controlledRevision: controlled,
    });
    emit(flags["github-output"], [
      ["upstream_tag", identity.upstreamTag],
      ["patch_revision", String(identity.patchRevision)],
      ["image_tag", identity.imageTag],
      ["revision_source", identity.revisionSource],
    ]);
  },
  "staging-tag"(argv) {
    const flags = parseFlags(argv);
    emit(flags["github-output"], [
      ["staging_tag", archStagingTag(requireFlag(flags, "image-tag"), requireFlag(flags, "arch"), requireFlag(flags, "run-id"))],
    ]);
  },
  prepare(argv) {
    const flags = parseFlags(argv);
    const action = decidePrepare(requireFlag(flags, "canonical-state"));
    emit(flags["github-output"], [["action", action]]);
    if (action === "skip") {
      console.log("::warning::canonical tag 已存在，本次安全跳过（不覆写）；如需新构建请递增 PATCH_REVISION");
    }
  },
  "publish-check"(argv) {
    const flags = parseFlags(argv);
    const action = decidePublish(requireFlag(flags, "canonical-state"), parseNamed(flags.staging, "--staging"));
    emit(flags["github-output"], [["action", action]]);
  },
};

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const handler = COMMANDS[command];
  if (!handler) {
    console.log("::error::用法：image-version.mjs <resolve|staging-tag|prepare|publish-check> ...");
    return 1;
  }
  try {
    handler(rest);
    return 0;
  } catch (error) {
    if (error instanceof VersionError) {
      console.log(`::error::${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
