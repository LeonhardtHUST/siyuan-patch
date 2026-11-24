# 当前状态

本文件是 2026-11-24 傍晚的快照，不是长期契约。实时真相以 `git log`、CI 运行记录与 GHCR 为准。

## 现在跑的是什么

| 项 | 值 |
|---|---|
| main | 见 `git log -1` |
| 已发布镜像 | `ghcr.io/leonhardthust/siyuan:v3.8.11-p5`（amd64 + arm64，匿名可拉）；历史 p0/p1/p4 与 `latest` 仍在 GHCR |
| `PATCH_REVISION` | `6` —— 下一次 docker 构建产出 `v3.8.12-p6` |
| 线上部署 | 私有 config 仓库 `deploy-siyuan` 每 30 分钟轮询；已知最后切换目标是 `v3.8.11-p5`（部署状态无法从本仓库核对） |
| 构建入口 | **只有 docker**：`watch-upstream`（每 6 小时）→ `release-docker` |

### 2026-11-24 的两项变更

1. **CI 只保留 docker 构建**。`release-pc` / `release-ios` / `release-android` /
   `release-cron` / `release-checksums` 五个工作流已删除，平台侧补丁（`patches/siyuan-ios/`、
   `patches/siyuan-android/`、`patches/siyuan/ocr-arm64-recovery.patch`）与 `fix_mac.sh` 一并删除；
   仓库不再产出 dist 工件或上游语义 Release。
2. **`content-prefetch.patch` 重基线到 v3.8.12**（上游于 2026-11-24 发布）。冲突是上游在
   22 个语言包头部追加 22 个新键、`destroy.ts` 新增 `invalidateMobileEditorSheet` /
   `destroyAVHorizontalScrollbar`、`index.d.ts` 改写 `SettingEditing` / `SettingEditor` 等类型。
   本次按语义重放，上游改动全部保留；`PATCH_REVISION` 因此 5 → 6。

已接入 docker 构建的补丁，顺序固定为：`disable-update` → `default-config` → `mock-vip-user` →
`docker-build` → `math-renderer-registry` → `content-prefetch` → `startup-slow-loading`。
`watch-upstream` 的顺序必须与之一致。

## 仓库里有什么

- `patches/siyuan/`：参与 docker 构建的 7 个补丁（平台侧补丁目录已删除）
- `wip/math-conversion/`：公式转换子系统 7 个补丁，已重基线到 v3.8.11 但**未接入构建**，
  且**没有任何调用方**，见该目录 README
- `scripts/`：版本 identity helper 与单测，`node --test scripts/` 30 项全绿
- `HANDOFF.md`（本文件）：状态快照

## 版本纪律要点

`PATCH_REVISION` 是镜像身份的全局单调整数。`patches/**` 与 `release-docker.yml`、
`watch-upstream.yml`、`check-image-version.yml`、版本 helper 的改动都会强制递增 N，
`check-image-version.yml` 在每次 push 与 PR 上硬校验。

因此把「不参与构建的补丁」放进 `patches/` 会白白产出一个内容相同的新镜像。`wip/` 就是为此存在：
不触发 N 递增，也不误导 CI。

## 已知债务

1. **GHCR 的 staging tag 不回收**。`release-docker` 的 publish 只用
   `vX.Y.Z-pN-<arch>-<run_id>` 合并出 canonical 与 `latest`，之后不删，每次构建永久留 2 个。
   现存 `v3.8.10-p1-amd64/arm64-43829202417`、`v3.8.11-p4-amd64/arm64-44761883782`、
   `v3.8.11-p5-amd64/arm64-45191492273`。清理要加在 publish 与 `latest` 之后（`latest` 也引用
   它们），失败只告警；改 `release-docker.yml` 必须递增 N，因此并到下一次真正的补丁内容变更里做。
2. **`docker-build.patch` 里的 ONNX 源码回退链**在 v3.8.11 / v3.8.12 已走不到（构建用
   `--build-arg ONNX_IMAGE` 复用官方镜像产物），留着是为了将来没有 digest 的版本。
   上游若恢复 `microsoft/onnxruntime` 应重新评估。
3. **`wip/math-conversion/` 与 `content-prefetch` 尚未在 v3.8.12 上做组合重基线**。v3.8.11 上
   已验证组合后只剩两处同址冲突（22 个语言包、`app/src/protyle/util/destroy.ts`），v3.8.12
   需重做；且插件侧目前没有调用方，接入前应先确认产品需求。
4. **`sync-upstream` 推不了分支**：`GITHUB_TOKEN` 无权推送含 `.github/workflows/*.yml`
   的提交，该步骤已降级为告警，issue 正文给出不依赖分支的 `git fetch` + `git merge FETCH_HEAD`。

## 边界

本次只做到「补丁在 v3.8.12 源码树上按 docker 顺序干净应用」。镜像未构建、CI 未跑、
`v3.8.12-p6` 未发布，因此 `content-prefetch` 的重基线**尚未经过编译、单测与线上验证**。
`content-prefetch` 的弱网收益与额外流量、Typst 渲染器认领、慢启动诊断在真实 CDN 下的表现，
也仍然没有专项回归。
