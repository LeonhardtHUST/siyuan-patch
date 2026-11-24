# 当前状态

本文件是 2026-11-24 的快照，不是长期契约。实时真相以 `git log`、CI 运行记录与 GHCR 为准。

## 现在跑的是什么

| 项 | 值 |
|---|---|
| main | 见 `git log -1` |
| 镜像 | `ghcr.io/leonhardthust/siyuan:v3.8.11-p5`（amd64 + arm64，匿名可拉） |
| `PATCH_REVISION` | `5` |
| 线上部署 | 私有 config 仓库 `deploy-siyuan` 每 30 分钟轮询，已于 2026-11-24 切到 p5 并通过健康检查 |
| 平台产物 | v3.8.11 的 PC（linux/mac/win 全架构）、iOS `.ipa`、Android `.apk` 均已随 Release 发布 |

已接入 docker 构建的补丁，顺序固定为：`disable-update` → `default-config` → `mock-vip-user` →
`docker-build` → `math-renderer-registry` → `content-prefetch` → `startup-slow-loading`。
`watch-upstream` 的顺序必须与之一致。

## 仓库里有什么

- `patches/siyuan/`：参与构建的补丁
- `patches/siyuan-ios/`、`patches/siyuan-android/`：平台侧补丁
- `wip/math-conversion/`：公式转换子系统，已重基线到 v3.8.11 但**未接入构建**，见该目录 README
- `scripts/`：版本 identity helper 与单测，CI 里 `node --test` 直接跑
- `HANDOFF.md`（本文件）：状态快照

## 版本纪律要点

`PATCH_REVISION` 是镜像身份的全局单调整数。`patches/**` 与 `release-docker.yml`、
`watch-upstream.yml`、`release-cron.yml`、`check-image-version.yml`、三个版本 helper 的改动
都会强制递增 N，`check-image-version.yml` 在每次 push 与 PR 上硬校验。

因此把「不参与构建的补丁」放进 `patches/` 会白白产出一个内容相同的新镜像。`wip/` 就是为此存在：
不触发 N 递增，也不误导 CI。

## 已知债务

1. **GHCR 的 staging tag 不回收**。`release-docker` 的 publish 只用
   `vX.Y.Z-pN-<arch>-<run_id>` 合并出 canonical 与 `latest`，之后不删，每次构建永久留 2 个。
   清理要加在 publish 与 `latest` 之后（`latest` 也引用它们），失败只告警。但改
   `release-docker.yml` 必须递增 N，所以这项并到下一次真正的补丁内容变更里做。
2. **`docker-build.patch` 里的 ONNX 源码回退链**在 v3.8.11 已走不到（构建用
   `--build-arg ONNX_IMAGE` 复用官方镜像产物），留着是为了将来没有 digest 的版本。
   上游若恢复 `microsoft/onnxruntime` 应重新评估。
3. **iOS 依赖第三方 fork**：`dominionapps/onnxruntime-swift-package-manager` 的
   `apx-mirror-binaries` 分支（已固定 commit `2136772`，两个二进制 sha256 已核对）。
   这是 `microsoft/onnxruntime` 整仓消失后的替代。
4. **Android 目前是调试签名**：仓库没有 `KEYSTORE` / `KEYSTORE_PASSWORD` secret，
   CI 用 keytool 现场生成一次性 debug keystore。配了 secret 会自动走回解码路径。
5. **`sync-upstream` 推不了分支**：`GITHUB_TOKEN` 无权推送含 `.github/workflows/*.yml`
   的提交，该步骤已降级为告警，issue 正文给出不依赖分支的 `git fetch` + `git merge FETCH_HEAD`。
6. **`wip/math-conversion/` 与 `content-prefetch` 尚未组合重基线**：只剩 22 个语言包与
   `app/src/protyle/util/destroy.ts` 两处相撞。

## 边界

镜像可构建、可拉取、线上健康检查通过，不等于功能行为已验证。`content-prefetch` 的弱网收益与
额外流量、Typst 渲染器认领、慢启动诊断在真实 CDN 下的表现，都还没有专项回归。
