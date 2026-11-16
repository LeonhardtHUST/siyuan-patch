import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { VersionError } from "./image-version.mjs";
import {
  RegistryError,
  fetchPullToken,
  queryTagStates,
  validateTag,
} from "./registry-tag-state.mjs";

const SCRIPT = fileURLToPath(new URL("./registry-tag-state.mjs", import.meta.url));

function response(status, body = "") {
  return { status, text: async () => body };
}

function makeFetch(options = {}) {
  const calls = [];
  const {
    tokenStatus = 200,
    tokenBody = JSON.stringify({ token: "pull-token" }),
    manifestStatus = () => 200,
    networkError = null,
  } = options;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/token?")) {
      return response(tokenStatus, tokenBody);
    }
    if (url.includes("/manifests/")) {
      if (networkError) throw networkError;
      return response(manifestStatus(url));
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  return { fetchImpl, calls };
}

test("queryTagStates：200=exists，404=absent，多 tag 顺序无关", async () => {
  const { fetchImpl, calls } = makeFetch({
    manifestStatus: (url) => (url.endsWith("/v3.8.10-p1") ? 200 : 404),
  });
  const states = await queryTagStates({
    image: "ghcr.io/leonhardthust/siyuan",
    tags: ["v3.8.10-p1-amd64-1", "v3.8.10-p1"],
    actor: "actor",
    token: "auth-token",
    fetchImpl,
  });
  assert.deepEqual(states, {
    "v3.8.10-p1-amd64-1": "absent",
    "v3.8.10-p1": "exists",
  });
  const tokenCall = calls[0];
  assert.match(tokenCall.url, /scope=repository:leonhardthust\/siyuan:pull/);
  assert.match(tokenCall.init.headers.Authorization, /^Basic /);
  assert.equal(tokenCall.init.redirect, "error");
  const manifestCall = calls[1];
  assert.equal(manifestCall.init.method, "HEAD");
  assert.equal(manifestCall.init.redirect, "error");
  assert.match(manifestCall.init.headers.Authorization, /^Bearer pull-token$/);
  assert.match(manifestCall.init.headers.Accept, /application\/vnd\.oci\.image\.index\.v1\+json/);
});

test("validateTag：严格 Docker tag 语法与长度，拒绝路径/换行/查询字符", () => {
  assert.equal(validateTag("v3.8.10-p1"), "v3.8.10-p1");
  assert.equal(validateTag("a".repeat(128)), "a".repeat(128));
  for (const bad of [
    "v3.8.10-p1\n",
    "v3.8.10-p1?x=1",
    "v3.8.10-p1/amd64",
    "v3.8.10-p1:amd64",
    "a".repeat(129),
    "-leading-dash",
    "",
  ]) {
    assert.throws(() => validateTag(bad), VersionError, JSON.stringify(bad));
  }
});

test("queryTagStates：重定向被拒绝时 fail closed", async () => {
  const fetchImpl = async () => {
    throw new TypeError("unexpected redirect");
  };
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/leonhardthust/siyuan",
      tags: ["v3.8.10-p1"],
      actor: "actor",
      token: "auth-token",
      fetchImpl,
    }),
    (error) => error instanceof RegistryError && /重定向/.test(error.message),
  );
});

test("queryTagStates：token body 读取超时 fail closed（timeout 覆盖 body）", async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(init.redirect, "error");
    return {
      status: 200,
      text: () =>
        new Promise((_, reject) => {
          const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          if (init.signal.aborted) abort();
          else init.signal.addEventListener("abort", abort, { once: true });
        }),
    };
  };
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/leonhardthust/siyuan",
      tags: ["v3.8.10-p1"],
      actor: "actor",
      token: "auth-token",
      fetchImpl,
      timeoutMs: 30,
    }),
    (error) => error instanceof RegistryError && /超时/.test(error.message),
  );
});

test("queryTagStates：manifest body 读取超时 fail closed", async () => {
  const fetchImpl = async (url, init) => {
    if (url.includes("/token?")) {
      return { status: 200, text: async () => JSON.stringify({ token: "pull-token" }) };
    }
    return {
      status: 200,
      text: () =>
        new Promise((_, reject) => {
          const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          if (init.signal.aborted) abort();
          else init.signal.addEventListener("abort", abort, { once: true });
        }),
    };
  };
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/leonhardthust/siyuan",
      tags: ["v3.8.10-p1"],
      actor: "actor",
      token: "auth-token",
      fetchImpl,
      timeoutMs: 30,
    }),
    (error) => error instanceof RegistryError && /超时/.test(error.message),
  );
});

test("queryTagStates：token 获取失败 fail closed", async () => {
  const { fetchImpl } = makeFetch({ tokenStatus: 403 });
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/leonhardthust/siyuan",
      tags: ["v3.8.10-p1"],
      actor: "actor",
      token: "auth-token",
      fetchImpl,
    }),
    (error) => error instanceof RegistryError && /HTTP 403/.test(error.message),
  );
});

test("queryTagStates：manifest 401/429/5xx 绝不能当作不存在", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const { fetchImpl } = makeFetch({ manifestStatus: () => status });
    await assert.rejects(
      queryTagStates({
        image: "ghcr.io/leonhardthust/siyuan",
        tags: ["v3.8.10-p1"],
        actor: "actor",
        token: "auth-token",
        fetchImpl,
      }),
      (error) =>
        error instanceof RegistryError &&
        error.message.includes("fail-closed") &&
        error.message.includes(String(status)),
      `status ${status}`,
    );
  }
});

test("queryTagStates：网络错误 fail closed", async () => {
  const { fetchImpl } = makeFetch({ networkError: new TypeError("fetch failed") });
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/leonhardthust/siyuan",
      tags: ["v3.8.10-p1"],
      actor: "actor",
      token: "auth-token",
      fetchImpl,
    }),
    (error) => error instanceof RegistryError && /网络错误/.test(error.message),
  );
});

test("fetchPullToken：缺少 actor/token 或响应非法时 fail closed", async () => {
  const imageRef = { repository: "leonhardthust/siyuan" };
  await assert.rejects(
    fetchPullToken({ imageRef, actor: "", token: "x", fetchImpl: async () => response(200) }),
    RegistryError,
  );
  await assert.rejects(
    fetchPullToken({ imageRef, actor: "a", token: "", fetchImpl: async () => response(200) }),
    RegistryError,
  );
  await assert.rejects(
    fetchPullToken({
      imageRef,
      actor: "a",
      token: "x",
      fetchImpl: async () => response(200, JSON.stringify({})),
    }),
    RegistryError,
  );
  await assert.rejects(
    fetchPullToken({
      imageRef,
      actor: "a",
      token: "x",
      fetchImpl: async () => response(200, "not-json"),
    }),
    RegistryError,
  );
});

test("queryTagStates：非法 image/tag 直接拒绝", async () => {
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/Owner/Repo",
      tags: ["v3.8.10-p1"],
      actor: "a",
      token: "t",
      fetchImpl: async () => response(200),
    }),
    VersionError,
  );
  await assert.rejects(
    queryTagStates({
      image: "ghcr.io/owner/repo",
      tags: ["bad/tag"],
      actor: "a",
      token: "t",
      fetchImpl: async () => response(200),
    }),
    VersionError,
  );
});

test("CLI：缺少 --check 时快速失败（不访问网络）", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--image", "ghcr.io/owner/repo", "--actor", "a"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::/);
});
