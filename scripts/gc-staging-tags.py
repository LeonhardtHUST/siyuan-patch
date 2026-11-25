#!/usr/bin/env python3
"""清理 GHCR 上的临时架构 tag（staging tags）。

背景
----
`release-docker` 用两个并行 job 分别构建 amd64/arm64，先推成
`vX.Y.Z-pN-<arch>-<run_id>`（下称“临时 tag”），再由 publish job 用
`docker buildx imagetools create` 把它们**扁平化**合并成 canonical `vX.Y.Z-pN` 与 `latest`。

扁平化的结果是：canonical/latest 的 index 直接引用平台 manifest 与 attestation 的 digest，
**不引用临时 tag 自身的 index digest**。因此删除“临时 tag 指向的那个 index digest”不会破坏
canonical/latest 的可拉取性。本脚本仍会枚举所有非临时 tag 的 digest 及其一层子 digest，
命中保护集合的一律跳过——宁可少删，不可删错。

用法
----
    OWNER=leonhardthust PACKAGE=siyuan ACTOR=<user> TOKEN=<token> \
      python3 scripts/gc-staging-tags.py [--dry-run]

TOKEN 需要 GHCR 的 pull+push（Actions 里用 secrets.GITHUB_TOKEN，`permissions: packages: write`）；
不带 TOKEN 时退化为匿名 pull，只够 --dry-run。任何单个 tag 的查询/删除失败只记录，不中断整体清理，
最后以非零退出码提示“有失败项”。

传输层用 curl 而不是 urllib：本仓库所在网络的 TLS/keep-alive 对 urllib 不稳定，curl 更可靠，
GitHub Actions 的 ubuntu-latest 也自带 curl。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile

REGISTRY = "https://ghcr.io"
STAGING_RE = re.compile(r"^v\d+\.\d+\.\d+-p\d+-(amd64|arm64)-\d+$")
ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)


def curl(args: list[str], timeout: int = 90) -> tuple[int, str, str]:
    """返回 (http_code, headers, body)；网络错误时 code=-1。"""
    cmd = ["curl", "-sS", "--max-time", str(timeout), "-w", "\n%{http_code}", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 15)
    if proc.returncode != 0:
        return -1, "", proc.stderr.strip()
    out = proc.stdout
    body, _, code = out.rpartition("\n")
    try:
        status = int(code.strip())
    except ValueError:
        return -1, "", out
    return status, "", body


def request_manifest(token: str, owner: str, package: str, ref: str) -> tuple[int, dict, str]:
    """读 manifest 的 (status, headers, body)。

    用 -D/-o 分文件保存：本机经代理时 curl 的 -D - 会把 `HTTP/1.1 200 Connection established`
    也写进 stdout，直接解析会拿到代理那一块头而不是真正的响应头。
    """
    url = f"{REGISTRY}/v2/{owner}/{package}/manifests/{ref}"
    with tempfile.TemporaryDirectory() as tmp:
        head_path = os.path.join(tmp, "headers")
        body_path = os.path.join(tmp, "body")
        proc = subprocess.run(
            ["curl", "-sS", "--max-time", "90", "-D", head_path, "-o", body_path,
             "-H", f"Authorization: Bearer {token}", "-H", f"Accept: {ACCEPT}", url],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0:
            return -1, {}, proc.stderr.strip()
        with open(head_path, encoding="utf-8", errors="replace") as fh:
            header_text = fh.read()
        with open(body_path, encoding="utf-8", errors="replace") as fh:
            body = fh.read()
    status, headers = 0, {}
    for block in header_text.replace("\r\n", "\n").split("\n\n"):
        if not block.strip().startswith("HTTP/"):
            continue
        status, headers = 0, {}
        for line in block.splitlines():
            if line.startswith("HTTP/"):
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    status = int(parts[1])
                continue
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()
    return status, headers, body


def fetch_token(owner: str, package: str, actor: str, secret: str) -> str:
    scope = f"repository:{owner}/{package}:" + ("pull,push" if secret else "pull")
    url = f"{REGISTRY}/token?scope={scope}&service=ghcr.io"
    cmd = ["-H", "Accept: application/json", url]
    if secret:
        basic = base64.b64encode(f"{actor}:{secret}".encode()).decode()
        cmd = ["-H", f"Authorization: Basic {basic}", *cmd]
    status, _, body = curl(cmd)
    if status != 200:
        raise SystemExit(f"获取 GHCR 令牌失败：HTTP {status} {body[:200]}")
    payload = json.loads(body)
    token = payload.get("token") or payload.get("access_token")
    if not token:
        raise SystemExit("GHCR 令牌响应里没有 token")
    return token


def list_tags(token: str, owner: str, package: str) -> list[str]:
    tags: list[str] = []
    last = ""
    while True:
        url = f"{REGISTRY}/v2/{owner}/{package}/tags/list?n=1000"
        if last:
            url += f"&last={last}"
        status, _, body = curl(["-H", f"Authorization: Bearer {token}", url])
        if status != 200:
            raise SystemExit(f"列出 tag 失败：HTTP {status} {body[:200]}")
        batch = (json.loads(body or "{}").get("tags") or [])
        tags.extend(batch)
        if len(batch) < 1000:
            return tags
        last = batch[-1]


def manifest_digest(token: str, owner: str, package: str, ref: str) -> tuple[str | None, bool]:
    status, headers, body = request_manifest(token, owner, package, ref)
    if status != 200:
        return None, False
    digest = headers.get("docker-content-digest") or None
    ctype = headers.get("content-type") or ""
    is_index = "index" in ctype or "manifest.list" in ctype
    if digest is None and is_index:
        import hashlib

        digest = "sha256:" + hashlib.sha256(body.encode()).hexdigest()
    return digest, is_index


def child_digests(token: str, owner: str, package: str, ref: str) -> list[str]:
    status, _, body = request_manifest(token, owner, package, ref)
    if status != 200:
        return []
    try:
        payload = json.loads(body or "{}")
    except json.JSONDecodeError:
        return []
    return [m.get("digest") for m in payload.get("manifests") or [] if m.get("digest")]


def delete_manifest(token: str, owner: str, package: str, digest: str) -> tuple[int, str]:
    url = f"{REGISTRY}/v2/{owner}/{package}/manifests/{digest}"
    status, _, body = curl(["-X", "DELETE", "-H", f"Authorization: Bearer {token}", url])
    return status, (body or "")[:200]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="只打印将要删除的 tag，不真的删")
    args = parser.parse_args()

    owner = (os.environ.get("OWNER") or "").strip().lower()
    package = (os.environ.get("PACKAGE") or "siyuan").strip()
    actor = (os.environ.get("ACTOR") or "").strip()
    secret = (os.environ.get("TOKEN") or "").strip()
    if not owner:
        print("缺少 OWNER 环境变量", file=sys.stderr)
        return 2
    if not secret and not args.dry_run:
        print("没有凭据时只能 --dry-run：删除需要 GHCR pull+push 令牌", file=sys.stderr)
        return 2

    token = fetch_token(owner, package, actor, secret)
    tags = list_tags(token, owner, package)
    staging = sorted(t for t in tags if STAGING_RE.match(t))
    stable = sorted(t for t in tags if not STAGING_RE.match(t))
    print(f"tag 总数 {len(tags)}：稳定 tag {len(stable)}，临时 tag {len(staging)}")
    print("稳定 tag：" + ", ".join(stable))
    if not staging:
        print("没有需要清理的临时 tag")
        return 0
    if not stable:
        print("没有稳定 tag 可作为保护依据，拒绝删除", file=sys.stderr)
        return 2

    protected: set[str] = set()
    for tag in stable:
        digest, is_index = manifest_digest(token, owner, package, tag)
        if not digest:
            print(f"::warning::无法解析稳定 tag {tag} 的 digest，保守起见跳过本轮清理")
            return 0
        protected.add(digest)
        if is_index:
            protected.update(d for d in child_digests(token, owner, package, digest) if d)
    print(f"保护集合 digest 数：{len(protected)}")

    failures = 0
    for tag in staging:
        digest, _ = manifest_digest(token, owner, package, tag)
        if not digest:
            print(f"::warning::无法解析临时 tag {tag} 的 digest，跳过")
            failures += 1
            continue
        if digest in protected:
            print(f"skip  {tag}（digest {digest[:19]}… 被稳定 tag 引用，保留）")
            continue
        if args.dry_run:
            print(f"dry-run delete {tag}（digest {digest[:19]}…）")
            continue
        status, detail = delete_manifest(token, owner, package, digest)
        if 200 <= status < 300:
            print(f"deleted {tag}（digest {digest[:19]}…，HTTP {status}）")
        else:
            failures += 1
            print(f"::warning::删除 {tag} 失败：HTTP {status} {detail}")

    if failures:
        print(f"有 {failures} 个临时 tag 未能处理（其余已清理）", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
