#!/usr/bin/env node
/**
 * 版本纪律校验入口（CI 与 release-docker prepare 共用）：
 * - `ci --base-sha <sha>`：比较基线 PATCH_REVISION 与当前值、镜像相关路径变更；
 *   基线复核入口固定在 workflow bash，由 base commit 的旧 checker 独立执行。
 * - `gate --repo <owner/repo> --sha <sha>`：要求该 commit 的最新 check-image-version
 *   push 运行已在 main 上通过（轮询等待），否则拒绝发布。
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { REVISION_FILE, VersionError, evaluateRevisionChange } from "./image-version.mjs";

const ZERO_SHA_RE = /^0+$/;
const GATE_WORKFLOW = "check-image-version.yml";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function gitQuietly(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function objectExists(spec) {
  try {
    execFileSync("git", ["cat-file", "-e", spec], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function requireBaseCommit(sha) {
  if (!objectExists(`${sha}^{commit}`)) {
    throw new VersionError(`base commit ${sha} 不可读，拒绝按首次引入放行`);
  }
}

function readBaseline(baseSha) {
  if (!baseSha || ZERO_SHA_RE.test(baseSha)) {
    console.log("无 base commit（全新分支）：按首次引入校验，N 必须为 1");
    return { start: "", baseText: null, changedPaths: [] };
  }
  const start = gitQuietly(["merge-base", baseSha, "HEAD"])?.trim() || baseSha;
  requireBaseCommit(start);
  let baseText = null;
  if (objectExists(`${start}:${REVISION_FILE}`)) {
    baseText = git(["show", `${start}:${REVISION_FILE}`]);
  } else {
    console.log(`基线 ${start} 无 ${REVISION_FILE}（首次引入，N 必须为 1）`);
  }
  const changedPaths = git(["diff", "--name-only", "-z", start, "HEAD"])
    .split("\0")
    .filter(Boolean);
  return { start, baseText, changedPaths };
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new VersionError(`读取 ${path} 失败：${error.message}`);
  }
}

function reportRevisionResult(result) {
  if (result.imageAffectingChanges.length > 0) {
    console.log(`镜像相关变更：${result.imageAffectingChanges.join(", ")}`);
  } else {
    console.log("无镜像相关文件变更");
  }
  console.log(`PATCH_REVISION: base=${result.base} head=${result.head}`);
  for (const warning of result.warnings) console.log(`::notice::${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.log(`::error::${error}`);
    return 1;
  }
  console.log("::notice::PATCH_REVISION 校验通过");
  return 0;
}

export function runCi({ baseSha, baseFile, changedPaths }) {
  const baseline = baseFile
    ? { baseText: readText(baseFile), changedPaths: [] }
    : readBaseline(baseSha);
  const headText = readText(REVISION_FILE);
  return reportRevisionResult(
    evaluateRevisionChange({
      baseText: baseline.baseText,
      headText,
      changedPaths: changedPaths ?? baseline.changedPaths,
    }),
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(fetchImpl, url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers, redirect: "error", signal: controller.signal });
    const body = await response.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`GitHub API 请求超时（>${timeoutMs}ms）`);
    }
    throw new Error(`GitHub API 请求失败（网络错误或重定向被拒绝）：${error?.message ?? error}`);
  } finally {
    clearTimeout(timer);
  }
}

export function evaluatePushRun(run, sha) {
  if (!run || typeof run !== "object") {
    return { state: "missing", message: `commit ${sha} 还没有 check-image-version 的 push 运行` };
  }
  if (run.head_sha !== sha) {
    return { state: "invalid", message: `运行 head_sha=${run.head_sha} 与目标 ${sha} 不一致，拒绝发布` };
  }
  if (run.head_branch !== "main") {
    return { state: "invalid", message: `运行 head_branch=${run.head_branch} 不是 main，拒绝发布` };
  }
  if (run.event !== "push") {
    return { state: "invalid", message: `运行 event=${run.event} 不是 push，拒绝发布` };
  }
  if (run.status !== "completed") {
    return { state: "pending", message: `check-image-version 仍在运行（status=${run.status}）` };
  }
  if (run.conclusion === "success") {
    return { state: "success", message: `版本纪律 push 检查通过：${sha}` };
  }
  return {
    state: "failed",
    message: `commit ${sha} 的 check-image-version 最新 push 结论为 ${run.conclusion}，拒绝构建`,
  };
}

export async function waitForPushCheck({
  repo,
  sha,
  token,
  fetchImpl = fetch,
  attempts = 12,
  intervalMs = 10000,
  timeoutMs = 15000,
}) {
  if (!repo || !sha) throw new VersionError("缺少 --repo 或 --sha");
  if (!token) throw new VersionError("缺少 GitHub token（GITHUB_TOKEN），无法查询检查结论");
  const url =
    `https://api.github.com/repos/${repo}/actions/workflows/${GATE_WORKFLOW}/runs` +
    `?head_sha=${sha}&event=push&per_page=1`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { status, json } = await fetchJson(fetchImpl, url, headers, timeoutMs);
    if (status !== 200) {
      throw new Error(`查询 ${GATE_WORKFLOW} 运行失败：HTTP ${status}`);
    }
    const verdict = evaluatePushRun(json?.workflow_runs?.[0], sha);
    if (verdict.state === "success") return verdict;
    if (verdict.state === "invalid" || verdict.state === "failed") throw new Error(verdict.message);
    console.log(`${verdict.message}（attempt ${attempt}/${attempts}），等待 ${intervalMs / 1000}s`);
    await sleep(intervalMs);
  }
  throw new Error(
    `等待 ${GATE_WORKFLOW} 超时（commit ${sha} 尚无 success 结论）；请稍后重跑本 workflow`,
  );
}

function parseFlags(argv) {
  const flags = { "changed-path": [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new VersionError(`未知参数：${JSON.stringify(arg)}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new VersionError(`--${key} 缺少值`);
    index += 1;
    if (key === "changed-path") flags[key].push(value);
    else flags[key] = value;
  }
  return flags;
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  try {
    if (command === "ci") {
      return runCi({
        baseSha: flags["base-sha"] ?? "",
        baseFile: flags["base-file"],
        changedPaths: flags["changed-path"].length > 0 ? flags["changed-path"] : undefined,
      });
    }
    if (command === "gate") {
      const verdict = await waitForPushCheck({
        repo: flags.repo,
        sha: flags.sha,
        token: process.env[flags["token-env"] ?? "GITHUB_TOKEN"] ?? "",
      });
      console.log(`::notice::${verdict.message}`);
      return 0;
    }
    throw new VersionError("用法：check-image-version.mjs <ci|gate> ...");
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
