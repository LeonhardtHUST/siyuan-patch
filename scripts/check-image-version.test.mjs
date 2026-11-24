import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { evaluatePushRun, waitForPushCheck } from "./check-image-version.mjs";

const SCRIPT = fileURLToPath(new URL("./check-image-version.mjs", import.meta.url));

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "siyuan-patch-check-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeHead(dir, text) {
  writeFileSync(join(dir, "PATCH_REVISION"), text, "utf8");
}

function writeBase(dir, text) {
  const path = join(dir, "base-PATCH_REVISION");
  if (text !== null) writeFileSync(path, text, "utf8");
  return path;
}

function runCi(dir, { baseFile, changedPaths = [], baseSha } = {}) {
  const args = [SCRIPT, "ci"];
  if (baseSha !== undefined) args.push("--base-sha", baseSha);
  if (baseFile) args.push("--base-file", baseFile);
  for (const path of changedPaths) args.push("--changed-path", path);
  return spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
}

test("首次引入：只允许 1", () => {
  withTempDir((dir) => {
    writeHead(dir, "1\n");
    const ok = runCi(dir);
    assert.equal(ok.status, 0, ok.stdout);

    writeHead(dir, "2\n");
    const failed = runCi(dir);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /首次引入 PATCH_REVISION 必须为 1/);
  });
});

test("镜像相关变更必须严格递增", () => {
  withTempDir((dir) => {
    const baseFile = writeBase(dir, "1\n");
    writeHead(dir, "2\n");
    const ok = runCi(dir, {
      baseFile,
      changedPaths: ["patches/siyuan/disable-update.patch", "README.md"],
    });
    assert.equal(ok.status, 0, ok.stdout);

    writeHead(dir, "1\n");
    for (const changed of [
      "patches/siyuan/disable-update.patch",
      ".github/workflows/release-docker.yml",
      ".github/workflows/watch-upstream.yml",
      "scripts/image-version.mjs",
    ]) {
      const failed = runCi(dir, { baseFile, changedPaths: [changed] });
      assert.equal(failed.status, 1, changed);
      assert.match(failed.stdout, /严格递增/, changed);
    }
  });
});

test("回退失败，无关变更允许不变或单独递增", () => {
  withTempDir((dir) => {
    const base2 = writeBase(dir, "2\n");
    writeHead(dir, "1\n");
    const failed = runCi(dir, { baseFile: base2 });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /不得回退/);

    const base4 = writeBase(dir, "4\n");
    writeHead(dir, "4\n");
    assert.equal(runCi(dir, { baseFile: base4, changedPaths: ["README.md"] }).status, 0);

    const base1 = writeBase(dir, "1\n");
    writeHead(dir, "3\n");
    const ok = runCi(dir, { baseFile: base1, changedPaths: ["README.md"] });
    assert.equal(ok.status, 0, ok.stdout);
    assert.match(ok.stdout, /::notice::仅递增/);
  });
});

test("非法值 / 缺失 head 失败", () => {
  withTempDir((dir) => {
    const baseFile = writeBase(dir, "1\n");
    writeHead(dir, "1.0");
    assert.equal(runCi(dir, { baseFile }).status, 1);

    writeHead(dir, "2\n");
    const invalidBase = writeBase(dir, "abc");
    assert.equal(runCi(dir, { baseFile: invalidBase }).status, 1);

    rmSync(join(dir, "PATCH_REVISION"));
    assert.equal(runCi(dir, { baseFile: writeBase(dir, "1\n") }).status, 1);
  });
});

test("evaluatePushRun：main + push + head_sha 匹配 + success", () => {
  const sha = "a".repeat(40);
  const base = { head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "success" };
  assert.equal(evaluatePushRun(base, sha).state, "success");

  assert.equal(evaluatePushRun(undefined, sha).state, "missing");
  assert.equal(evaluatePushRun({ ...base, head_sha: "b".repeat(40) }, sha).state, "invalid");
  assert.equal(evaluatePushRun({ ...base, head_branch: "feature" }, sha).state, "invalid");
  assert.equal(evaluatePushRun({ ...base, event: "pull_request" }, sha).state, "invalid");
  assert.equal(evaluatePushRun({ ...base, status: "in_progress" }, sha).state, "pending");
  assert.equal(evaluatePushRun({ ...base, conclusion: "failure" }, sha).state, "failed");
});

test("waitForPushCheck：轮询 pending → success，并携带鉴权头", async () => {
  const sha = "a".repeat(40);
  const calls = [];
  const responses = [
    { workflow_runs: [{ head_sha: sha, head_branch: "main", event: "push", status: "in_progress", conclusion: null }] },
    { workflow_runs: [{ head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "success" }] },
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify(responses.shift()) };
  };
  const verdict = await waitForPushCheck({
    repo: "owner/repo",
    sha,
    token: "secret-token",
    fetchImpl,
    attempts: 3,
    intervalMs: 1,
  });
  assert.equal(verdict.state, "success");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /actions\/workflows\/check-image-version\.yml\/runs/);
  assert.match(calls[0].url, /head_sha=/);
  assert.match(calls[0].url, /event=push/);
  assert.equal(calls[0].init.redirect, "error");
  assert.match(calls[0].init.headers.Authorization, /^Bearer secret-token$/);
});

test("waitForPushCheck：失败结论立即拒绝，非 200/缺 token fail closed", async () => {
  const sha = "a".repeat(40);
  const failing = async () => ({
    status: 200,
    text: async () =>
      JSON.stringify({
        workflow_runs: [
          { head_sha: sha, head_branch: "main", event: "push", status: "completed", conclusion: "failure" },
        ],
      }),
  });
  await assert.rejects(
    waitForPushCheck({ repo: "owner/repo", sha, token: "t", fetchImpl: failing, intervalMs: 1 }),
    /拒绝构建/,
  );
  await assert.rejects(
    waitForPushCheck({
      repo: "owner/repo",
      sha,
      token: "t",
      fetchImpl: async () => ({ status: 403, text: async () => "{}" }),
    }),
    /HTTP 403/,
  );
  await assert.rejects(
    waitForPushCheck({ repo: "owner/repo", sha, token: "", fetchImpl: failing }),
    /缺少 GitHub token/,
  );
});
