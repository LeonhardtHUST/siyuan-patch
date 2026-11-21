# HANDOFF：冻结于 v3.8.11-p4

接手前的 `patch-drift: v3.8.11-p1` 已修复，镜像 `v3.8.11-p4` 已发布并通过幂等复检。
后续维护者从「冻结快照」一节接着做，不需要重读历史会话。

冻结时间：2026-11-21 13:13（Asia/Shanghai）。镜像发布完成于 2026-11-20 23:57（Asia/Shanghai）。

## 冻结快照

| 项 | 值 |
|---|---|
| main HEAD | `d09b50527c1920049d4e97110791f0817ecb642b` |
| 上游源码 tag | `v3.8.11` |
| `PATCH_REVISION` | `4` |
| canonical 镜像 | `ghcr.io/leonhardthust/siyuan:v3.8.11-p4` |
| 镜像架构 | `linux/amd64`、`linux/arm64` |
| 最近一次版本校验 | run `44761783943` check-image-version success |
| 最近一次构建 | run `44761883782` release-docker success |
| 最近一次幂等复检 | run `44812475523` watch-upstream success，`canonical_state=exists` 后跳过 |

本文件是文档提交，不改变任何补丁内容、不改变 `PATCH_REVISION`，因此不影响上表的镜像身份。
历史重建仍应以 `d09b505` 为准，而不是包含本文件的后续 commit。

## 起点状态

接手时 main HEAD 为 `68fc10c`，`PATCH_REVISION=1`。上游发布 v3.8.11 后，`watch-upstream`
预演失败并开出 issue #1（标题 `patch-drift: v3.8.11-p1`）：`content-prefetch.patch`
在 22 个语言包、`destroy.ts`、`transactionAV.test.ts`、`api/index.d.ts` 上无法应用，未触发构建。

执行过程中出现并发写入：另一个会话在 18:14 推送了 `e8d680b`（`startup-slow-loading.patch`，
`PATCH_REVISION` 置为 2）。该 commit 已被远端接受，本次顺延修订号，未把内容并入 p2。

## 终点状态

- `content-prefetch.patch` 已重基线到 v3.8.11，50 个文件块、纯 LF、无冲突标记
- `docker-build.patch` 增加 ONNX Runtime 源码地址回退链
- `PATCH_REVISION` 由 1 增至 4，三处内容变更各占一个修订号（其中 2 被并发会话先行占用）
- 镜像 `v3.8.11-p4` 发布完成，7 个补丁按既定顺序全部应用成功
- `watch-upstream` 下一次巡检识别到 canonical 已存在，正确跳过，未覆写

## 变更清单

| commit | 内容 |
|---|---|
| `e8d680b` | startup-slow-loading 补丁引入，`PATCH_REVISION` 1→2（并发会话提交，非本次操作） |
| `31ffa6c` | content-prefetch 重基线到 v3.8.11，`PATCH_REVISION` 2→3 |
| `d09b505` | ONNX Runtime 地址回退链，`PATCH_REVISION` 3→4 |

`31ffa6c` 触及 `patches/siyuan/content-prefetch.patch`、`PATCH_REVISION`、`PATCHES.md`。
`d09b505` 触及 `patches/siyuan/docker-build.patch`、`PATCH_REVISION`、`PATCHES.md`。

## 关键决策与理由

### content-prefetch 用三方合并而非 fuzz

`git apply --3way` 或 `patch --fuzz` 能让文本打上，但 24 个冲突文件里有两类必须人工判断：语言包是
「在文件首行插入键」而上游也在同一位置插入了新键；`index.d.ts` 是整行重写的联合类型，
上游在同一条语句里新增了字段。fuzz 会把两侧内容叠在一起而不报错。

做法是在临时仓库里构造 base（v3.8.10）、patched（base + 旧补丁）、upstream3811（base 换 v3.8.11 文件）
三个状态，rebase 后逐处按语义解决，再用「增删行集合比对」验证除 `index.d.ts` 外
49 个文件的改动内容与原补丁完全一致。

### 修订号跳跃而不是复用 2

`e8d680b` 已把 `PATCH_REVISION=2` 推到远端。同一 N 对应两次不同内容会破坏
「canonical tag 不可覆写」的前提，而远端历史不宜重写，因此顺延到 3、再到 4。

### ONNX 源使用回退链

`microsoft/onnxruntime` 自 2026-11-17 起整仓 404，GitHub API 与 `git ls-remote` 都返回 Not Found。
上游 Dockerfile 按 `ONNX_COMMIT` 从该仓库取源码，`onnx-source` 阶段因此必然失败。
现场报错容易误判成网络问题：

```
fatal: could not read Username for 'https://github.com': No such device or address
```

Git 拿到 404 后会转去索要账号。回退链保持原地址优先，失败后依次尝试仍保留该提交的公开 fork；
取到后 Dockerfile 原有的 `git rev-parse` 与 `VERSION_NUMBER` 双校验不变，所以来源变化不改变内容。

## 验证证据

| 检查 | 结果 |
|---|---|
| `git apply --check` 于 pristine v3.8.11（Linux 换行） | 通过；旧补丁同命令失败 |
| 补丁 50 个文件块的增删行与原补丁比对 | 49 个文件完全一致，5 个新增文件字节一致；`index.d.ts` 为整行重写，属预期 |
| 22 个语言包键集合 | 各 3204 个顶层键完全一致，`contentPrefetch` 键各出现 1 次 |
| `index.d.ts` 上游新增字段 | `databaseShowIcon`、`databaseShowRelationIcon`、`hideBreadcrumbIcons` 均保留 |
| `schema.json` | 严格解析通过，三个 `SetEditor*` 类型均含 `contentPrefetch` |
| watch-upstream dry_run（run `44719727118`） | 真实 v3.8.11 源码树上 7 个补丁全部通过 |
| release-docker 补丁阶段 | `UPSTREAM_TAG: v3.8.11` 下 7 个 `git apply` 在 `set -euo pipefail` 下全部成功 |
| ONNX 回退链 | 本地与 CI 均实证：两架构都先试原地址（404，重试两次）再切 `intel/onnxruntime`，取到 `3a728b7`（ORT 1.24.3）后版本校验通过 |
| 发布后幂等复检 | `canonical_state=exists`，未重复构建 |

## 失败与弯路

留档以免重复踩：

- 整仓 `git clone --depth=1` 在本地连续四次 SSL 中断，tar.gz 下载约 12 KB/s
  → 改为按补丁清单逐文件取 raw，只取 50 个受影响文件
- PowerShell 的 `ConvertFrom-Json` 对语言包里仅大小写不同的键（`"1m"` / `"1M"`）报错
  → 校验脚本改用 node 的 `JSON.parse`，不做键名归一
- PowerShell 写文件默认 CRLF，导致 `PATCHES.md` 出现整文件 diff → 统一按 UTF-8 无 BOM + LF 写回
- Windows checkout 的 `.sy` 为 CRLF，`git apply` 因此失败 → 临时仓按 Linux checkout 归一为 LF
- `raw.githubusercontent.com` 单次下载可截断且不报错（`schema.json` 两次只到 2143616 字节）
  → 改用 `curl -C -` 续传并校验收尾字符
- ONNX 失败最初按网络问题排查，实为上游仓库消失 → 以 `gh api` / `git ls-remote` 双重确认

## 未完成与遗留

| 项 | 状态 | 说明 |
|---|---|---|
| issue #1 | CLOSED | 已于 2026-11-21 以 completed 关闭并留说明；标题是创建时自动生成的 `v3.8.11-p1`，未改，与实际 p4 不一致 |
| 部署 | 未执行 | 私有 config 仓库的 `SIYUAN_TAG` 需自行指向 `v3.8.11-p4`；本仓库不掌握该仓库 |
| sync-upstream `44729285526` | failure | 失败在 `Fetch upstream` 步骤（从父仓库 `MohamedElashri/siyuan-patch` 拉取），与补丁内容无关，需单独排查 |
| release-pc / android / ios | failure | 三者最后一次运行是 2026-11-19 的 `68fc10c`，均失败；v3.8.11 未构建过这些产物，失败原因未排查 |
| 7 个未跟踪补丁 | 未纳入版本控制 | 见下表，未接入任何 workflow |
| 前端与后端回归 | 未运行 | 本地无该源码树的 pnpm / go 依赖，仅做静态核对；TS 编译由镜像构建覆盖，单测未跑 |

未跟踪文件（冻结时记录 SHA-256 前 16 位与字节数，避免状态丢失）：

| 文件 | 字节 | SHA-256 前缀 |
|---|---:|---|
| `patches/siyuan/math-conversion-api.patch` | 584310 | `C30EC4D70AD7A793` |
| `patches/siyuan/math-conversion-bridge.patch` | 123541 | `C4D08027C1AA938C` |
| `patches/siyuan/math-conversion-core.patch` | 60265 | `F6B3FF3CCC91E8F7` |
| `patches/siyuan/math-conversion-menu.patch` | 35219 | `BDB696EDB90195D9` |
| `patches/siyuan/math-conversion-transaction-guards.patch` | 28287 | `1C9CE99BE869944E` |
| `patches/siyuan/math-conversion-transaction.patch` | 78690 | `9669313116D9643C` |
| `patches/siyuan/math-render-surface-context.patch` | 87749 | `6209D4CA6EE3E87B` |

## 下一步

issue #1 已关闭，剩下的三项按顺序：

1. 在私有 config 仓库把 `SIYUAN_TAG` 指向 `ghcr.io/leonhardthust/siyuan:v3.8.11-p4`，
   健康检查同时核对 `docker inspect .Config.Image` 等于该完整 tag。这是当前唯一还没落地的环节，
   接管者拿到部署权限后直接从这一步开始
2. 排查 `sync-upstream` 的 `Fetch upstream` 失败（`.github/workflows/sync-upstream.yml`）
3. 决定 7 个 `math-conversion-*.patch` 的去向：接入 workflow 或删除，不要长期停在未跟踪状态

## 边界声明

本次达成的是「补丁可干净应用且镜像可构建」，不等于功能已验证。没有覆盖的有：长文档弱网下的
预取收益与额外流量、Typst 渲染器认领路径、慢启动诊断在真实 CDN 下的表现。PC / Android / iOS
产物本次未构建；`math-renderer-registry.patch` 与 `docker-build.patch` 只接在 docker 流程里。

上游若恢复 `microsoft/onnxruntime`，应收紧 `docker-build.patch` 中的回退链；上游改用其他
ONNX 来源时同理，届时同步递增 `PATCH_REVISION`。
