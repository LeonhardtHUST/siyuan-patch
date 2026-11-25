# 当前状态

本文件是 2026-11-25 晚的快照，不是长期契约。实时真相以 `git log`、CI 运行记录与 GHCR 为准。

## 现在跑的是什么

| 项 | 值 |
|---|---|
| main | 见 `git log -1` |
| 已发布镜像 | `ghcr.io/leonhardthust/siyuan:v3.8.12-p7`（amd64 + arm64，index digest `sha256:947edfd5…`，匿名可拉）；`latest` 已指向它；历史 p0/p1/p4/p5/p6 仍在 GHCR |
| `PATCH_REVISION` | `7`（对应 `v3.8.12-p7`，2026-11-25 构建发布；相对 p6 只改了测试夹具） |
| 线上部署 | 在 `LeonhardtHUST/config` 手动跑 `deploy-siyuan` 两次：`v3.8.11-p5` → `v3.8.12-p6` → `v3.8.12-p7`，两次健康检查都通过（镜像引用 = 目标完整 tag，`/api/system/version` = `3.8.12`） |
| 构建入口 | docker：`watch-upstream`（每 6 小时）→ `release-docker`；Windows 桌面端：`release-cron`（每天 12:00 UTC）→ `release-windows` → `release-checksums` |

### 2026-11-25 的变更

1. **恢复 Windows 桌面端 dist 构建**：新增 `release-windows.yml`（`windows-latest` x86_64 +
   `windows-11-arm` ARM64），重新引入 `release-cron.yml`（只派发 Windows）与
   `release-checksums.yml`。Windows 应用 5 个补丁（不含 `docker-build` / `math-renderer-registry`）。
   **尚未在 Actions 实跑验证**。
2. **补丁集修成 test-green**：`math-renderer-registry.patch` 与 `content-prefetch.patch` 现在同时更新上游那批
   「剔除 import + 手工注入依赖表」的隔离夹具（12 个测试文件），补上 `findMathRenderer` /
   `applyInlineMathBoundaries` / `invalidateContentPrefetchFor` 等桩。这样「打完 7 个补丁的 v3.8.12 树」
   跑 `pnpm test` 不再有补丁引入的红灯。`PATCH_REVISION` 因此 6 → 7。
3. **p7 已发布并上线**：`v3.8.12-p7`（index digest `sha256:947edfd5…`，labels `ref.name=v3.8.12-p7`、
   `revision=ea4f491`、`patch-revision=7`），`latest` 已指向它；`deploy-siyuan` 已切到 p7 并通过健康检查。
4. **临时架构 tag 改为自动清理**：新增独立的 `gc-staging-tags.yml`（每天 04:17）+ 
   `scripts/gc-staging-tags.py`，只删 `vX.Y.Z-pN-<arch>-<run_id>` 且不在稳定 tag 保护集合里的
   digest；因为不改 `release-docker.yml`，不需要递增 `PATCH_REVISION`。

### 2026-11-24 的两项变更

1. **CI 只保留 docker 构建**。`release-pc` / `release-ios` / `release-android` /
   `release-cron` / `release-checksums` 五个工作流已删除，平台侧补丁（`patches/siyuan-ios/`、
   `patches/siyuan-android/`、`patches/siyuan/ocr-arm64-recovery.patch`）与 `fix_mac.sh` 一并删除；
   仓库不再产出 dist 工件或上游语义 Release。
2. **`content-prefetch.patch` 重基线到 v3.8.12**（上游于 2026-11-24 发布）。冲突是上游在
   22 个语言包头部追加 22 个新键、`destroy.ts` 新增 `invalidateMobileEditorSheet` /
   `destroyAVHorizontalScrollbar`、`index.d.ts` 改写 `SettingEditing` / `SettingEditor` 等类型。
   本次按语义重放，上游改动全部保留；`PATCH_REVISION` 因此 5 → 6。

镜像身份已核对：`org.opencontainers.image.version=v3.8.12`、`ref.name=v3.8.12-p6`、
`revision=d5d2069`、`io.siyuan-patch.patch-revision=6`。CI 记录：`check-image-version` 在
`d5d2069` 上 success，`watch-upstream` 预演打补丁全通过并触发
[release-docker 45596790786](https://github.com/LeonhardtHUST/siyuan-patch/actions/runs/45596790786)，
两个架构 `Clone upstream and apply patches` 与 publish 均 success。

已接入 docker 构建的补丁，顺序固定为：`disable-update` → `default-config` → `mock-vip-user` →
`docker-build` → `math-renderer-registry` → `content-prefetch` → `startup-slow-loading`。
`watch-upstream` 的顺序必须与之一致。

## 仓库里有什么

- `patches/siyuan/`：参与 docker 构建的 7 个补丁（平台侧补丁目录已删除）
- `wip/math-conversion/`：公式转换子系统 7 个补丁，已重基线到 v3.8.11 但**未接入构建**，
  且**没有任何调用方**，见该目录 README
- `scripts/`：版本 identity helper 与单测，`node --test scripts/` 30 项全绿
- `RUNTIME-REGRESSION.md`：运行时回归的五层做法（L0–L4 已自动化，L5 行为/收益回归待人工）
- `HANDOFF.md`（本文件）：状态快照

## 版本纪律要点

`PATCH_REVISION` 是镜像身份的全局单调整数。`patches/**` 与 `release-docker.yml`、
`watch-upstream.yml`、`check-image-version.yml`、版本 helper 的改动都会强制递增 N，
`check-image-version.yml` 在每次 push 与 PR 上硬校验。

因此把「不参与构建的补丁」放进 `patches/` 会白白产出一个内容相同的新镜像。`wip/` 就是为此存在：
不触发 N 递增，也不误导 CI。

## 已知债务

1. **Windows 构建：x86_64 已跑通，ARM64 卡在上游 OCR 资源**。2026-11-25 实跑
   [release-windows 45609418100](https://github.com/LeonhardtHUST/siyuan-patch/actions/runs/45609418100)：
   x64 全流程成功并上传 `siyuan-v3.8.12-win.exe`；ARM64 在 `Building Electron` 阶段失败，
   原因是 `prepare-ocr.py` 去 `microsoft/onnxruntime` 下载 `windows-arm64` 运行时（整仓 404），
   而 v3.8.12 的 `runtimeRecovery` 只有 amd64/linux/ darwin，没有 windows-arm64。
   历史上由 `patches/siyuan/ocr-arm64-recovery.patch` 补这两处（runtimeRecovery 条目 +
   `app-arm64.7z` 成员名）；该补丁随平台清理被删除，恢复它需要把 URL/sha256 更新到 v3.8.12。
   修法二选一：恢复该补丁（属 `patches/**`，按纪律要递增 N）或在 `release-windows`
   构建前用脚本从上游安装包预置 runtime（改动只在 workflow/scripts，不动镜像身份）。
   `actions.lock` 也还没有该工作流的条目（机器生成，下一次 bot 更新补上）。
2. **临时架构 tag 清理需要 token**：`gc-staging-tags.yml` 只删 `vX.Y.Z-pN-<arch>-<run_id>` 且不在稳定
   tag 保护集合里的 digest，但 `GITHUB_TOKEN` 无权调 Packages API（实测 401），需要仓库 secret
   `GC_STAGING_TOKEN`（PAT，`read:packages`+`delete:packages`）。2026-11-25 已用带权限的 gh token 手工删掉
   p1/p4/p5/p6 的 8 个临时 tag（HTTP 204，canonical/latest 未受影响）；**p7 的 2 个临时 tag 仍在**
   （本地手工删除被审批策略拒绝），可用
   `OWNER=leonhardthust PACKAGE=siyuan TOKEN=$(gh auth token) python3 scripts/gc-staging-tags.py` 清掉。
3. **`docker-build.patch` 里的 ONNX 源码回退链**在 v3.8.11 / v3.8.12 已走不到（构建用
   `--build-arg ONNX_IMAGE` 复用官方镜像产物），留着是为了将来没有 digest 的版本。
   上游若恢复 `microsoft/onnxruntime` 应重新评估。
4. **`wip/math-conversion/` 与 `content-prefetch` 尚未在 v3.8.12 上做组合重基线**。v3.8.11 上
   已验证组合后只剩两处同址冲突（22 个语言包、`app/src/protyle/util/destroy.ts`），v3.8.12
   需重做；且插件侧目前没有调用方，接入前应先确认产品需求。
5. **`sync-upstream` 推不了分支**：`GITHUB_TOKEN` 无权推送含 `.github/workflows/*.yml`
   的提交，该步骤已降级为告警，issue 正文给出不依赖分支的 `git fetch` + `git merge FETCH_HEAD`。

## 边界

`v3.8.12-p6` 已构建发布，docker 镜像构建流程包含前端与内核编译，因此「补丁能编译进镜像」
这一层已验证。但**运行时行为没有专项回归**：`content-prefetch` 的弱网收益与额外流量、
Typst 渲染器认领、慢启动诊断在真实 CDN 下的表现，以及 `content-prefetch` 在 v3.8.12 上
那三处语义重放（语言包键、`destroy.ts` 清理调用、`index.d.ts` 类型成员）的实际效果，
都还需要真实使用验证。`deploy-siyuan` 的线上切换结果也不在本仓库可核对范围内。
