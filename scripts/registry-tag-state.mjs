#!/usr/bin/env node
/**
 * GHCR tag 存在性查询 helper（无第三方依赖）。
 *
 * 只有 HTTP 200 视为存在，404 视为不存在；401/403/429/5xx、网络错误、
 * 超时、重定向、token 获取失败一律抛出 RegistryError（fail closed）。
 * 调用方绝不能把“查询失败”当作 tag 不存在。错误信息只含 URL/状态，不含凭据。
 */

import { appendFileSync } from "node:fs";

import {
  TAG_ERROR,
  VersionError,
  classifyManifestStatus,
  parseImageRef,
} from "./image-version.mjs";

const DOCKER_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = "RegistryError";
  }
}

export function validateTag(tag) {
  if (typeof tag !== "string" || !DOCKER_TAG_RE.test(tag)) {
    throw new VersionError(`非法 Docker tag（需匹配 ${DOCKER_TAG_RE}，总长 <=128）：${JSON.stringify(tag)}`);
  }
  return tag;
}

async function fetchText(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new RegistryError(`registry 请求超时（>${timeoutMs}ms，不能当作 tag 不存在）`);
    }
    throw new RegistryError(
      `registry 请求失败（网络错误或重定向被拒绝，不能当作 tag 不存在）：${error?.message ?? error}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function readToken(payload) {
  const value = payload?.token ?? payload?.access_token;
  if (typeof value !== "string" || value.length === 0) {
    throw new RegistryError("GHCR token 响应缺少 token 字段，必须 fail closed");
  }
  return value;
}

export async function fetchPullToken({
  imageRef,
  actor,
  token,
  fetchImpl = fetch,
  timeoutMs = 30000,
}) {
  if (!actor) throw new RegistryError("缺少 actor（GITHUB_ACTOR），无法获取 GHCR token");
  if (!token) throw new RegistryError("缺少 token（GITHUB_TOKEN），无法获取 GHCR token");
  const basic = Buffer.from(`${actor}:${token}`, "utf8").toString("base64");
  const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${imageRef.repository}:pull`;
  const { status, body } = await fetchText(
    fetchImpl,
    url,
    { method: "GET", headers: { Authorization: `Basic ${basic}`, Accept: "application/json" } },
    timeoutMs,
  );
  if (status !== 200) {
    throw new RegistryError(
      `获取 GHCR pull token 失败：HTTP ${status}（鉴权/权限错误必须 fail closed）`,
    );
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new RegistryError(`GHCR token 响应不是合法 JSON，必须 fail closed：${error.message}`);
  }
  return readToken(payload);
}

export async function queryTagStates({
  image,
  tags,
  actor,
  token,
  fetchImpl = fetch,
  timeoutMs = 30000,
}) {
  const imageRef = parseImageRef(image);
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new VersionError("至少需要一个待查询 tag");
  }
  const validated = tags.map(validateTag);
  const pullToken = await fetchPullToken({ imageRef, actor, token, fetchImpl, timeoutMs });
  const states = {};
  for (const tag of validated) {
    const { status } = await fetchText(
      fetchImpl,
      `https://ghcr.io/v2/${imageRef.repository}/manifests/${tag}`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${pullToken}`, Accept: MANIFEST_ACCEPT },
      },
      timeoutMs,
    );
    const state = classifyManifestStatus(status);
    if (state === TAG_ERROR) {
      throw new RegistryError(
        `查询 ${tag} 的 manifest 返回 HTTP ${status}；按 fail-closed 处理，不能当作 tag 不存在`,
      );
    }
    states[tag] = state;
  }
  return states;
}

function parseChecks(items) {
  const checks = [];
  const names = new Set();
  for (const item of items) {
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      throw new VersionError(`--check 参数必须形如 name=tag：${JSON.stringify(item)}`);
    }
    const name = item.slice(0, separator);
    const tag = item.slice(separator + 1);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new VersionError(`--check 名称非法：${JSON.stringify(name)}`);
    }
    if (names.has(name)) throw new VersionError(`--check 名称重复：${JSON.stringify(name)}`);
    names.add(name);
    checks.push({ name, tag: validateTag(tag) });
  }
  if (checks.length === 0) throw new VersionError("至少需要一个 --check name=tag");
  return checks;
}

function parseFlags(argv) {
  const flags = { check: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new VersionError(`未知参数：${JSON.stringify(arg)}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new VersionError(`--${key} 缺少值`);
    index += 1;
    if (key === "check") flags.check.push(value);
    else flags[key] = value;
  }
  return flags;
}

function emitOutputs(path, entries) {
  if (!path) return;
  appendFileSync(path, entries.map(([key, value]) => `${key}=${value}\n`).join(""), "utf8");
}

export async function main(argv = process.argv.slice(2)) {
  const flags = parseFlags(argv);
  if (!flags.image) throw new VersionError("缺少 --image");
  const checks = parseChecks(flags.check ?? []);
  const timeoutMs = flags.timeout === undefined ? 30000 : Number(flags.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new VersionError("--timeout 必须是正数毫秒");
  }
  const tokenEnv = flags["token-env"] ?? "GITHUB_TOKEN";
  const states = await queryTagStates({
    image: flags.image,
    tags: checks.map((entry) => entry.tag),
    actor: flags.actor ?? process.env.GITHUB_ACTOR ?? "",
    token: process.env[tokenEnv] ?? "",
    timeoutMs,
  });
  const entries = checks.map(({ name, tag }) => [`${name}_state`, states[tag]]);
  for (const [key, value] of entries) console.log(`${key}=${value}`);
  emitOutputs(flags["github-output"], entries);
  return 0;
}

if (process.argv[1]?.endsWith("registry-tag-state.mjs")) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`::error::${message}`);
      process.exitCode = 1;
    },
  );
}
