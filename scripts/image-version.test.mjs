import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  TAG_ABSENT,
  TAG_ERROR,
  TAG_EXISTS,
  VersionError,
  archStagingTag,
  classifyManifestStatus,
  decidePrepare,
  decidePublish,
  evaluateRevisionChange,
  isImageAffectingPath,
  parseImageRef,
  parseImageTag,
  parseRevisionText,
  readRevisionFile,
  resolveImageIdentity,
} from "./image-version.mjs";

const SCRIPT = fileURLToPath(new URL("./image-version.mjs", import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "siyuan-patch-version-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parseRevisionText：仅接受单行纯文本正整数", () => {
  assert.equal(parseRevisionText("1"), 1);
  assert.equal(parseRevisionText("42\n"), 42);
  assert.equal(parseRevisionText("7\r\n"), 7);
  for (const bad of [
    "",
    "0",
    "01",
    "-1",
    "1.0",
    " 1",
    "1 ",
    "1\n\n",
    "1 2",
    "١",
    "1\n2",
    "9007199254740993", // 超出 Number 安全整数，禁止丢精度
  ]) {
    assert.throws(() => parseRevisionText(bad), VersionError, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test("readRevisionFile：缺失/非法文件明确报错", () => {
  withTempDir((dir) => {
    const path = join(dir, "PATCH_REVISION");
    assert.throws(() => readRevisionFile(path), VersionError);
    writeFileSync(path, "3\n", "utf8");
    assert.equal(readRevisionFile(path), 3);
    writeFileSync(path, "03\n", "utf8");
    assert.throws(() => readRevisionFile(path), VersionError);
  });
});

test("parseImageTag：vX.Y.Z 与 vX.Y.Z-pN，拒绝第四段/预发布/p0/前导零", () => {
  assert.deepEqual(parseImageTag("v3.8.10"), {
    kind: "upstream",
    upstreamTag: "v3.8.10",
    patchRevision: null,
  });
  assert.deepEqual(parseImageTag("v0.0.0"), {
    kind: "upstream",
    upstreamTag: "v0.0.0",
    patchRevision: null,
  });
  for (const [tag, expected] of [
    ["v3.8.10-p1", 1],
    ["v3.8.10-p9", 9],
    ["v3.8.10-p10", 10],
    ["v3.8.10-p123", 123],
  ]) {
    assert.deepEqual(parseImageTag(tag), {
      kind: "full",
      upstreamTag: "v3.8.10",
      patchRevision: expected,
    });
  }
  for (const bad of [
    "3.8.10",
    "v3.8",
    "v3.8.10.1",
    "v3.8.10-p0",
    "v3.8.10-p01",
    "v3.8.10-rc1",
    "v3.8.10-p1-extra",
    "V3.8.10",
    " v3.8.10",
    "v3.8.10 ",
    "v3.8.10\n",
    "v3.8.10-p9007199254740993",
    "v9007199254740993.0.0",
    "v3.9007199254740993.0",
    "v9007199254740993.1.1-p1",
    "",
  ]) {
    assert.throws(() => parseImageTag(bad), VersionError, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test("resolveImageIdentity：N 必须等于受控 PATCH_REVISION，无自由 override", () => {
  const controlled = resolveImageIdentity({
    version: "v3.8.10",
    patchRevision: "",
    controlledRevision: 5,
  });
  assert.equal(controlled.imageTag, "v3.8.10-p5");
  assert.equal(controlled.revisionSource, "controlled");

  const fullMatches = resolveImageIdentity({
    version: "v3.8.10-p5",
    patchRevision: "",
    controlledRevision: 5,
  });
  assert.equal(fullMatches.imageTag, "v3.8.10-p5");
  assert.equal(fullMatches.revisionSource, "full-tag");

  const explicitMatches = resolveImageIdentity({
    version: "v3.8.10",
    patchRevision: "5",
    controlledRevision: 5,
  });
  assert.equal(explicitMatches.revisionSource, "explicit");

  const allThreeMatch = resolveImageIdentity({
    version: "v3.8.10-p5",
    patchRevision: "5",
    controlledRevision: 5,
  });
  assert.equal(allThreeMatch.imageTag, "v3.8.10-p5");

  // 新上游不重置全局 N（无需每上游 map）
  assert.equal(
    resolveImageIdentity({ version: "v3.8.11", controlledRevision: 5 }).imageTag,
    "v3.8.11-p5",
  );

  for (const bad of [
    { version: "v3.8.10-p7", controlledRevision: 5 },
    { version: "v3.8.10", patchRevision: "9", controlledRevision: 5 },
    { version: "v3.8.10-p7", patchRevision: "5", controlledRevision: 5 },
    // 完整 tag 已给出 N 时，显式输入也必须与 tag N 一致
    { version: "v3.8.10-p1", patchRevision: "2", controlledRevision: 1 },
    { version: "v3.8.10-p1", patchRevision: "2", controlledRevision: 2 },
    { version: "v3.8.10", patchRevision: "", controlledRevision: undefined },
  ]) {
    assert.throws(() => resolveImageIdentity(bad), VersionError, JSON.stringify(bad));
  }
});

test("archStagingTag：临时架构 tag 与 canonical 分离", () => {
  assert.equal(archStagingTag("v3.8.10-p1", "amd64", "123456"), "v3.8.10-p1-amd64-123456");
  assert.equal(archStagingTag("v3.8.10-p2", "arm64", "42"), "v3.8.10-p2-arm64-42");
  assert.throws(() => archStagingTag("v3.8.10", "amd64", "1"), VersionError);
  assert.throws(() => archStagingTag("v3.8.10-p1", "arm", "1"), VersionError);
  assert.throws(() => archStagingTag("v3.8.10-p1", "amd64", "0"), VersionError);
});

test("classifyManifestStatus / parseImageRef", () => {
  assert.equal(classifyManifestStatus(200), TAG_EXISTS);
  assert.equal(classifyManifestStatus(404), TAG_ABSENT);
  for (const status of [0, 301, 400, 401, 403, 429, 500, 503]) {
    assert.equal(classifyManifestStatus(status), TAG_ERROR);
  }
  assert.deepEqual(parseImageRef("ghcr.io/leonhardthust/siyuan"), {
    repository: "leonhardthust/siyuan",
  });
  assert.throws(() => parseImageRef("ghcr.io/Owner/Siyuan"), VersionError);
  assert.throws(() => parseImageRef("docker.io/library/siyuan"), VersionError);
});

test("decidePrepare / decidePublish：fail closed", () => {
  assert.equal(decidePrepare(TAG_ABSENT), "build");
  assert.equal(decidePrepare(TAG_EXISTS), "skip");
  assert.throws(() => decidePrepare(TAG_ERROR), VersionError);

  assert.equal(decidePublish(TAG_ABSENT, { amd64: TAG_EXISTS, arm64: TAG_EXISTS }), "publish");
  assert.throws(() => decidePublish(TAG_EXISTS, { amd64: TAG_EXISTS }), /拒绝覆写/);
  assert.throws(() => decidePublish(TAG_ABSENT, { amd64: TAG_ABSENT }), VersionError);
  assert.throws(() => decidePublish(TAG_ABSENT, { amd64: TAG_ERROR }), VersionError);
  assert.throws(() => decidePublish(TAG_ABSENT, {}), VersionError);
});

test("isImageAffectingPath：patches 与构建/调度输入保守计入", () => {
  for (const path of [
    "patches/siyuan/disable-update.patch",
    "patches\\siyuan\\disable-update.patch",
    "./patches/siyuan/x.patch",
    ".github/workflows/release-docker.yml",
    ".github/workflows/watch-upstream.yml",
    ".github/workflows/release-cron.yml",
    ".github/workflows/check-image-version.yml",
    "scripts/image-version.mjs",
    "scripts/registry-tag-state.mjs",
    "scripts/check-image-version.mjs",
  ]) {
    assert.equal(isImageAffectingPath(path), true, path);
  }
  for (const path of ["README.md", "scripts/README.md", "PATCH_REVISION", ".github/workflows/sync-upstream.yml"]) {
    assert.equal(isImageAffectingPath(path), false, path);
  }
});

test("evaluateRevisionChange：首次引入/递增/回退/无关变更", () => {
  assert.equal(evaluateRevisionChange({ baseText: null, headText: "1\n" }).ok, true);
  assert.equal(evaluateRevisionChange({ baseText: null, headText: "2\n" }).ok, false);

  const bump = evaluateRevisionChange({
    baseText: "1\n",
    headText: "2\n",
    changedPaths: ["patches/siyuan/disable-update.patch"],
  });
  assert.equal(bump.ok, true);

  for (const changed of [
    ["patches/siyuan/disable-update.patch"],
    [".github/workflows/release-docker.yml"],
    [".github/workflows/watch-upstream.yml"],
    [".github/workflows/release-cron.yml"],
    ["scripts/image-version.mjs"],
  ]) {
    const result = evaluateRevisionChange({ baseText: "1\n", headText: "1\n", changedPaths: changed });
    assert.equal(result.ok, false, changed.join(","));
    assert.match(result.errors.join(" "), /严格递增/);
  }

  const decrease = evaluateRevisionChange({ baseText: "2\n", headText: "1\n" });
  assert.equal(decrease.ok, false);
  assert.match(decrease.errors.join(" "), /不得回退/);

  assert.equal(
    evaluateRevisionChange({ baseText: "1\n", headText: "3\n", changedPaths: ["README.md"] }).ok,
    true,
  );
  assert.equal(
    evaluateRevisionChange({ baseText: "4\n", headText: "4\n", changedPaths: ["README.md"] }).ok,
    true,
  );
  assert.equal(evaluateRevisionChange({ baseText: "1\n", headText: "1.0" }).ok, false);
  assert.equal(evaluateRevisionChange({ baseText: "abc", headText: "2" }).ok, false);
});

test("CLI resolve：只读 PATCH_REVISION 并输出唯一完整 tag", () => {
  withTempDir((dir) => {
    const revisionFile = join(dir, "PATCH_REVISION");
    const outputFile = join(dir, "github-output");
    writeFileSync(revisionFile, "7\n", "utf8");
    writeFileSync(outputFile, "", "utf8");
    const result = runCli([
      "resolve",
      "--version",
      "v3.8.10",
      "--file",
      revisionFile,
      "--github-output",
      outputFile,
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /image_tag=v3\.8\.10-p7/);
    const written = readFileSync(outputFile, "utf8");
    assert.match(written, /patch_revision=7/);
    assert.match(written, /image_tag=v3\.8\.10-p7/);
  });
});

test("CLI resolve：full tag / 显式 N 与受控值不一致必须失败", () => {
  withTempDir((dir) => {
    const revisionFile = join(dir, "PATCH_REVISION");
    writeFileSync(revisionFile, "7\n", "utf8");
    for (const args of [
      ["--version", "v3.8.10-p8", "--file", revisionFile],
      ["--version", "v3.8.10", "--patch-revision", "8", "--file", revisionFile],
    ]) {
      const result = runCli(["resolve", ...args]);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /::error::/);
      assert.match(result.stdout, /不一致/);
    }
  });
});

test("CLI prepare / publish-check：skip 与 fail-closed 行为", () => {
  const skip = runCli(["prepare", "--canonical-state", "exists"]);
  assert.equal(skip.status, 0);
  assert.match(skip.stdout, /action=skip/);
  assert.match(skip.stdout, /::warning::/);

  assert.equal(runCli(["prepare", "--canonical-state", "absent"]).status, 0);
  assert.equal(runCli(["prepare", "--canonical-state", "error"]).status, 1);

  const publish = runCli([
    "publish-check",
    "--canonical-state",
    "absent",
    "--staging",
    "amd64=exists",
    "--staging",
    "arm64=exists",
  ]);
  assert.equal(publish.status, 0);
  assert.match(publish.stdout, /action=publish/);

  const refused = runCli(["publish-check", "--canonical-state", "exists", "--staging", "amd64=exists"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /拒绝覆写/);
});
