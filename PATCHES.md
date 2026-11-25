# PATCHES

本 fork（`LeonhardtHUST/siyuan-patch`）在 [MohamedElashri/siyuan-patch](https://github.com/MohamedElashri/siyuan-patch)
的基础上维护补丁集。所有补丁以 `git apply` 方式应用到 [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan)
对应 tag 的源码树上，由 docker 镜像流程（`watch-upstream` → `release-docker`）构建分发；平台 dist 构建已于 2026-11-24 停止。

> 原则：本仓库承载**通用呈现管线注入点和可选前端体验增强**，不包含任何 Typst 专属逻辑（Typst 渲染逻辑在
> [siyuan-typst-plugin](https://github.com/LeonhardtHUST/siyuan-typst-plugin) 插件侧）。

## 镜像版本与不可变 tag 纪律

Docker 镜像的版本身份由「上游 tag + 全局补丁修订号」组成，并由 CI 机器强制：

| 概念 | 形式 | 说明 |
|---|---|---|
| 上游源码 tag | `vX.Y.Z` | 与上游 release 一致；克隆源码永远用它 |
| canonical 镜像 tag | `vX.Y.Z-pN` | 本仓库自构建的唯一可部署 tag，不可覆写 |
| 旧镜像 tag | `vX.Y.Z` | 视为 p0，仅历史/回滚；不再发布、不参与幂等判断、绝不覆写 |
| 临时架构 tag | `vX.Y.Z-pN-<arch>-<run_id>` | 中间产物；publish 失败可只重试 publish |
| `latest` | 移动别名 | 不是版本身份；部署/回滚都不得使用 |

### 单一来源：`PATCH_REVISION`

仓库根 `PATCH_REVISION` 是唯一来源：纯文本十进制正整数（当前 `6`），**全局单调、跨上游不重置**。
例如上游到 v3.8.11 时 N 若为 7，镜像 tag 是 `v3.8.11-p7`，不会回到 p1。

- `release-docker` / `watch-upstream` 的 `patch_revision` 输入仅为向后兼容：留空即使用文件，填写则必须与文件相等，否则拒绝。
- 完整 tag 中的 N 必须等于文件值；历史重建应 checkout 对应历史 commit，而不是把当前补丁塞进旧 N。机制引入前的历史 commit 没有 `check-image-version` push 运行，`release-docker` 的 gate 会拒绝发布（不提供绕过开关）。
- 任何 `patches/**`、`release-docker.yml`、`watch-upstream.yml`、版本 helper / 检查 workflow 的变更，都必须递增 N（保守策略）。只改文档不强制；单独递增 N 可用于重建。
- 强制点：`.github/workflows/check-image-version.yml` 对每个 main push 与 PR 比较 base 与 head；首次引入必须为 1，回退必败。CI 会先从 base commit 取出旧 checker 复跑，避免通过修改 checker 自我绕过。
- `release-docker` 发布前还要求：本次 `github.sha` 在 main 上存在最新的 `check-image-version` **push** 运行且结论为 success，并要求只从 main 运行。手动在红色 commit 上 dispatch 会被拒绝。
- 保护边界：这些检查保护 CI 触发的发布与并发 workflow；不能阻止拥有仓库写权限的人直接向 GHCR 推送同名 tag，也不代表已经配置 branch protection / 强制 review。建议对 main 开启 required status check、禁止 force push。

### 不可覆写与重试

- prepare 查询 GHCR：canonical 已存在 → **安全跳过**（不重写）并输出 warning；不存在 → 构建；鉴权/网络/5xx 等查询错误 → 直接失败（绝不当作不存在）。
- publish 前再次确认 canonical 必须不存在；若已存在（并发/重复触发）→ 失败。canonical 发布后再 best-effort 更新 `latest`；`latest` 失败只告警，不影响 canonical 的 success。
- 架构构建先推 `${canonical}-${arch}-${github.run_id}`；同一 run 重跑（re-run failed jobs）可复用已成功的架构，publish 失败不必重跑架构。
- 所有 `release-docker` 运行串行（workflow-level concurrency），避免同一上游并发发布竞争。
- canonical 发布后用 `docker buildx imagetools inspect` 确认 tag 可解析。

### OCI labels

- `org.opencontainers.image.version` = 上游 `vX.Y.Z`（保留应用版本语义；`/api/system/version` 仍返回不带 `v` 和补丁后缀的 `X.Y.Z`）
- `org.opencontainers.image.ref.name` = canonical `vX.Y.Z-pN`
- `org.opencontainers.image.revision` = 构建 commit SHA
- `io.siyuan-patch.patch-revision` = N

### 回滚

新构建的部署与回滚使用 canonical 完整 tag 或 digest，不使用 `latest`。无后缀旧 tag 仅作为迁移兼容的历史/回滚目标保留，不再发布或覆盖。
`docker compose` 的 `SIYUAN_TAG` 必须写完整 tag；健康检查还应校验运行中容器的镜像引用（`docker inspect .Config.Image`）等于目标 tag——否则同一上游仅差 pN 时，旧容器会返回相同上游版本号而**假通过**。

### 部署端兼容与合入顺序

本仓库的 dist 构建范围：**docker 镜像 + Windows 桌面端**。Linux / macOS / iOS / Android 的 dist 构建
于 2026-11-24 删除；Windows 于 2026-11-25 恢复（`release-windows.yml`，由 `release-cron` 在上游有新版本时
创建 GitHub Release 并派发，`release-checksums` 补 `SHA256SUMS.txt`）。平台侧补丁
（`patches/siyuan-ios/`、`patches/siyuan-android/`、`patches/siyuan/ocr-arm64-recovery.patch`）已删除。
docker 镜像的构建入口仍是 `watch-upstream` → `release-docker`。

`deploy-siyuan` 位于**私有 config 仓库**（不在本仓库），由 `schedule`（每 30 分钟）+ `workflow_dispatch` 触发。兼容改造已先行合入 config 的 `master`（`8f441e4`）：识别 `vX.Y.Z-pN`，按 (X,Y,Z,N) 数值排序，旧无后缀 tag 按 p0 兼容。

部署端将完整 tag 保存到 `SIYUAN_TAG`，健康检查同时比较上游 `X.Y.Z` 和运行容器的完整镜像引用，失败时回滚到上一个完整 tag。跨仓库迁移必须 **先 config、后 producer（镜像 tag 切换）**；旧版部署工作流无法正确检查带补丁后缀的目标。通用说明与历史本地交付物的使用边界见 `patches/config/README.md`。合入代码不等于已经构建或部署新标签，应分别核对版本检查、镜像构建和部署运行结果。

## 补丁清单

| 补丁文件 | 用途 | 适用范围 | 说明 |
|---|---|---|---|
| `patches/siyuan/disable-update.patch` | 禁用自动更新提示 | docker | 上游自带 |
| `patches/siyuan/default-config.patch` | 默认配置调整 | docker | 上游自带 |
| `patches/siyuan/mock-vip-user.patch` | 模拟付费用户（解锁功能） | docker | 上游自带 |
| `patches/siyuan/docker-build.patch` | Docker 构建适配 | docker | 上游自带，本 fork 追加 ONNX 源回退，见下 |
| **`patches/siyuan/math-renderer-registry.patch`** | **数学渲染器注册表：允许插件在 KaTeX 之前认领公式节点** | **docker（已接）** | **本 fork 新增，见下** |
| **`patches/siyuan/content-prefetch.patch`** | **可选的块边界内容预取与同源图片预取** | **docker** | **默认关闭，见下；已重基线到 v3.8.12** |
| **`patches/siyuan/startup-slow-loading.patch`** | **慢启动诊断：页面资源阶段独立 120 秒预算，业务阶段仍 30 秒** | **docker** | **本 fork 新增，见下** |

> `math-renderer-registry` 与 `content-prefetch` 还会同步更新上游那批「剔除 import + 手工注入依赖表」的
> 隔离夹具（12 个测试文件），保证打完补丁的源码树 `pnpm test` 无补丁引入的红灯。
>
> Windows 桌面端构建（`release-windows.yml`）应用上表中的 `disable-update`、`default-config`、
> `mock-vip-user`、`content-prefetch`、`startup-slow-loading` 五项；`docker-build` 与
> `math-renderer-registry` 是 docker 专用，Windows 不应用（与历史 PC 构建一致）。
> 平台侧补丁 `patches/siyuan-ios/*`、`patches/siyuan-android/*` 与 `patches/siyuan/ocr-arm64-recovery.patch` 已删除。

## math-renderer-registry.patch

### 它做了什么

在 `app/src/protyle/render/mathRender.ts`（思源前端全部 ~20 处公式渲染的统一入口）中新增
**同步认领阶段**：

1. 每个未渲染的 `[data-subtype="math"]` 节点先询问已注册的渲染器（`canRender`，同步）；
2. 认领成功 → 置 `data-render="true"` 并排除出 KaTeX 队列——**KaTeX 的 CSS/JS 都不会加载**；
3. 渲染器异步执行（`render` 返回 Promise）；返回 `false` 或抛错 → 撤销认领、同一次调用内回退 KaTeX；
4. `mathRender` 的返回值并入渲染器 Promise —— PDF 导出等 `await mathRender(...)` 的场景会
   等待渲染器完成（Typst 画完再打印）；
5. 行内公式的光标边界处理（零宽字符/换行占位）抽取为 `applyInlineMathBoundaries`，通过
   `IMathRenderContext.applyInlineMathBoundaries` 暴露给渲染器复用，保持与 KaTeX 一致的光标行为；
6. `addStyle(katex.min.css)` 移入 KaTeX 分支（顺带修掉"存在数学节点即加载 KaTeX CSS"的小冗余）。

### 新增/修改的文件

- 新增 `app/src/protyle/render/mathRendererRegistry.ts`（注册表：`registerMathRenderer` /
  `unregisterMathRenderer` / `findMathRenderer`）
- 新增 `app/src/protyle/render/mathBoundaries.ts`（`applyInlineMathBoundaries`）
- 修改 `app/src/protyle/render/mathRender.ts`（认领阶段 + KaTeX 分支重构）
- 修改 `app/src/plugin/index.ts`（插件 API：`Plugin.prototype.registerMathRenderer(id, renderer)` /
  `unregisterMathRenderer(id)`，注册名自动加插件名前缀防冲突）
- 修改 `app/src/protyle/export/index.ts`（**导出烘焙**：`bakeMathForExport()` 在应用内用当前
  渲染器把公式渲染为内联 SVG 并展平 shadow DOM——导出 HTML 自包含、Electron PDF 预览窗口
  无需 Typst 运行时；预览重渲染时跳过已烘焙节点）

### 插件侧用法（Typst 插件示例）

```ts
// onload 中（特性检测：官方版思源无此 API，自动跳过）
if (typeof (this as any).registerMathRenderer === "function") {
    (this as any).registerMathRenderer("typst", {
        canRender: (ctx) => shouldUseTypst(ctx),        // 同步判定（\t 前缀 / 文档级 typst-math 标记）
        render: async (ctx) => renderWithTypst(ctx),    // 返回 false 表示放弃并回退 KaTeX
    });
}
```

### 回归红线

- **没有任何注册器时，行为必须与上游完全一致**（KaTeX 路径不动）；
- 认领失败/渲染器异常 → 回退 KaTeX（不允许出现空白公式）。

### 验证方式

```bash
# 1) 补丁可干净应用
git clone --branch v3.8.8 --depth=1 https://github.com/siyuan-note/siyuan.git
cd siyuan && git apply /path/to/math-renderer-registry.patch

# 2) 前端语法级检查（类型检查由 CI 构建负责）
npx esbuild app/src/protyle/render/mathRender.ts --loader:.ts=ts --outfile=/dev/null

# 3) 行为验收（配合 siyuan-typst-plugin 的 e2e）：
#    typst-math 文档中 katex.min.js 网络请求数 = 0、window.katex 未定义
```

## content-prefetch.patch

### 使用方式与范围

在 **设置 - 编辑器 - 行为** 中打开「内容预取」，关闭后恢复按需加载。默认关闭，设置保存到工作空间的 `conf.json`，通过现有设置同步机制更新各前端。

预取以思源文档的块组织为基础：根据当前已加载内容的首尾块 ID，使用既有 `/api/filetree/getDoc` 的向前/向后分段模式准备邻近内容，不下载整篇文档、不遍历整个笔记本，也不提前插入或渲染这些块。滚动真正需要下一段时，仍经过原有动态加载状态机与文档边界校验。

图片是首批资源预取对象：只考虑同源笔记附件中的常见图片，按内容优先、图片次之的顺序执行。不会预执行脚本、主动加载 iframe、外站资源或音视频，也不会提前加载数学渲染器，避免干扰插件认领公式。首版跳过加密笔记本的所有投机预取，加密笔记仍使用原有鉴权与按需加载，不增加解密内容缓存。

这是带宽与等待时间的交换，并非离线缓存：会产生额外请求，实际收益取决于网速、滚动速度和服务端响应。内容缓存每编辑器前后各一段，最多保留 8 个编辑器，30 秒过期；全局最多一个投机内容请求，同一编辑器的尝试间隔至少 800 毫秒，每次不超过 512 个块、2 MiB 响应、8 秒。图片串行预取，每段最多 8 张、队列最多 16 张，单张限制 8 MiB 和 8 秒，均以低网络优先级执行。功能已开启时，当前编辑器开始实际分段加载会全局暂停投机预取并取消在途投机请求，等所有受保护的前台分段加载结束后才恢复。若在某次分段请求已经发出后才开启功能，该请求不会补注册保护，下一次分段加载开始正常保护。

编辑、WebSocket 事务更新、连接断开/重连、切换文档及关闭功能都会使相应结果失效。缓存消费前等待本地事务队列并复核连接、文档和块边界；这里没有新增服务端修订号协议，不能将短 TTL 当作严格版本一致性证明。启用节省流量、离线或页面进入后台时暂停投机预取，前台真实加载不依赖预取成功。若真正加载时预取尚未完成，会取消该次预取并走原有加载请求；首版没有跨编辑器/反链/预览的通用 in-flight Promise 合并，可能浪费部分已传输字节。

### 构建与验证

本补丁当前基于 **v3.8.12**（2026-11-24 重基线），独立于数学渲染器补丁，只接入 docker 镜像构建与 `watch-upstream` 漂移预检。配置字段、UI、多语言和行为回归测试随补丁一起应用。

v3.8.11 刷新时改动过的冲突点（供下次对照）：22 个语言包在文件首行各新增 `contentPrefetch` /
`contentPrefetchTip`，上游同版本也在文件头部追加了新键，因此两条键放在上游新增键之前，键集合仍与其余语言一致；
`app/src/types/api/index.d.ts` 的三处 `SetEditor*` 类型按字母序插在 `codeTabSpaces` 之后，并保留上游
新增的 `databaseShowIcon`、`databaseShowRelationIcon`、`hideBreadcrumbIcons`；事务相关的单测夹具把
`invalidateContentPrefetchFor` 桩并入上游扩展后的依赖对象。

v3.8.12 重基线（2026-11-24）的冲突点是对的：上游在 22 个语言包文件头部追加了 22 个新键
（`agentQuoteAdded`、`saveToGallery`、`aiPolish` 等），并在 `destroy.ts` 增加了
`invalidateMobileEditorSheet` / `destroyAVHorizontalScrollbar` 的导入与调用，同时改写了
`SettingEditing`、`SettingEditor` 等类型；因此本次只把 `contentPrefetch` / `contentPrefetchTip`
两条键插到 `{` 之后、把清理代码插到新增调用之后、把 `contentPrefetch` 成员按字母序插进新版本的
类型单行里，其余上游改动全部保留。

```bash
# 在未打补丁的固定版本源码树中检查，再应用
git apply --check /path/to/siyuan-patch/patches/siyuan/content-prefetch.patch
git apply /path/to/siyuan-patch/patches/siyuan/content-prefetch.patch

# 在已安装上游依赖的 app/ 目录预览受影响范围，再执行定向回归
pnpm run test:changed --explain
pnpm run test:focused src/protyle/scroll/contentPrefetch.test.ts src/protyle/scroll/indexRequest.test.ts src/protyle/scroll/scrollRequest.test.ts
pnpm run lint
pnpm run api:check
```

人工验收应使用长文档与网络节流，对比开关前后的分块请求时间、滚动连续性和额外流量；同时核对向上滚动、快速换向、编辑后滚动、多窗口修改、关闭开关、锁定加密笔记本以及移动端。补丁应用与状态机测试通过不等于已验证所有平台的实际弱网体验。

维护设置契约时，可在上游 `kernel/` 目录执行 `go test ./apicontract/...` 以及 `go test ./api -run 'TestSetting|TestAPIContractSetting|TestSetEditorNullRestoresDefault' -count=1`，覆盖字段映射、完整载荷、设置合并与默认值恢复。22 语言键检查使用上游根目录的 `python scripts/check-lang-keys.py`。该补丁本身不改变部署层 HTTP/2/3、静态资源长期缓存、WebSocket 压缩或镜像标签；镜像 tag 纪律由独立的 CI 变更引入（见上文「镜像版本与不可变 tag 纪律」），与本补丁无关。这些增强应独立测量和回归，不能从预取测试的通过推断其收益。

## startup-slow-loading.patch

### 它解决了什么

上游 `app/src/boot/startupError.ts` 用同一个启动超时覆盖页面资源加载与业务初始化两个阶段。主程序脚本下载本身超过该预算时（现场 v3.8.10 的 `main` 约 67 秒），诊断会在业务阶段尚未开始时误报 `stage=page` 超时。

本补丁把两个阶段分开计时：

1. 页面资源阶段使用独立预算 `pageTimeout = Math.max(timeout, 120000)`，默认 120 秒。它是有界定时器，不等待 `load` 事件；主程序一直不返回也会在 120 秒失败。
2. 任意 `siyuan-startup-stage` 事件把预算切回原来的 30 秒（`timeout` 默认 30000）并重新计时，业务阶段时限没有放宽。自定义 `timeout` 时页面下限仍为 120 秒，业务阶段按传入值。
3. `DOMContentLoaded` 时若阶段仍为 `page`（主程序已执行或已报错但未上报阶段），预算收窄为 30 秒并从 DOM ready 起重计，避免已崩溃的页面再等满 120 秒；阶段标签仍显示 `page`。
4. 主脚本资源 `error` 仍立即失败，运行时错误仍进入超时诊断，页面隐藏时暂停计时、`ready` 与 `dispose` 清理计时器的行为不变。

### 适用范围与验证

补丁基于 **v3.8.10**，上游 v3.8.11 / v3.8.12 均未改动 `app/src/boot/startupError.ts`，该补丁在这两个版本上都能干净应用，无需重基线。只修改该文件与其单测。只在 docker 链里应用，位于 `content-prefetch.patch` 之后；`watch-upstream` 的预演顺序与 `release-docker` 一致，本补丁位于末尾。

```bash
git apply --check /path/to/siyuan-patch/patches/siyuan/startup-slow-loading.patch
git apply /path/to/siyuan-patch/patches/siyuan/startup-slow-loading.patch

# 在应用后的 app/ 目录
pnpm run test:focused src/boot/startupError.test.ts
```

补丁应用与单测通过只说明启动诊断的计时逻辑正确；现场网络、CDN 与浏览器行为仍需分别观察，不能据此推断所有慢启动都会被覆盖。

## ONNX Runtime 源码来源回退（在 `docker-build.patch` 内）

`microsoft/onnxruntime` 自 2026-11-17 起整仓 404（GitHub API 与 `git ls-remote` 都返回 Not Found）。上游 Dockerfile 恰好按 `ONNX_COMMIT` 从这个仓库取源码，`onnx-source` 阶段因此必然失败，错误表现为 `fatal: could not read Username for 'https://github.com': No such device or address`——Git 拿到 404 后转去要账号，而不是网络超时。

本 fork 把单次 fetch 改成地址回退链：先试原地址（上游若恢复会自动回到官方源），失败再依次试仍保留该提交的公开 fork。取到后 Dockerfile 原有的两道校验照旧生效——`git rev-parse HEAD` 必须等于 `ONNX_COMMIT`，`VERSION_NUMBER` 必须等于 `ONNX_VERSION`，因此来源变化不改变内容，只改变谁来提供这个 Git 对象。子模块指向 `onnx/onnx`、`google/libprotobuf-mutator`、`emscripten-core/emsdk`，都不受影响。

本地已验证：原地址 404 → `intel/onnxruntime` 取到 `3a728b7`（ORT 1.24.3）→ 版本校验通过。上游恢复或 SiYuan 上游改用其他来源后，应从 `docker-build.patch` 中移除这段回退。
## 构建注意事项

- `release-docker.yml` 已加入数学渲染器补丁的 `git apply` 行，并改造为推送 **GHCR**
  （`ghcr.io/<owner>/siyuan`，使用内置 `GITHUB_TOKEN`，**无需配置任何 secrets**）；
  镜像按 canonical tag `vX.Y.Z-pN` 发布，见上文「镜像版本与不可变 tag 纪律」。
  平台产物工作流：`release-pc.yml`（Linux/macOS）/ `release-android.yml` / `release-ios.yml`
  已于 2026-11-24 删除；`release-windows.yml` 于 2026-11-25 恢复（当前只 x86_64，ARM64 暂停），
  `release-cron.yml` 重新引入但只派发 Windows，`release-checksums.yml` 供其生成校验和。
- GHCR 上的 `siyuan` 包**当前是 public**，匿名即可拉取与查询 tag。`deploy-siyuan` 的
  `tag_version.py pick` 走匿名令牌，因此**不要把包改回 private**，否则部署会在选版本阶段失败。
- 上游同步：`.github/workflows/sync-upstream.yml` 每日自动快进；出现分叉会推
  `sync/upstream-<date>` 分支并开 issue，**补丁上下文失配是合并时的首要检查项**。
  注意 `GITHUB_TOKEN` 无权推送含 `.github/workflows/*.yml` 的提交，该步骤已降级为告警，
  issue 正文给出不依赖分支的 `git fetch` + `git merge FETCH_HEAD` 命令。

### 临时架构 tag 的清理（`gc-staging-tags`）

`release-docker` 的两个并行 job 先把镜像推成 `vX.Y.Z-pN-<arch>-<run_id>`（临时 tag），
publish 再用 `docker buildx imagetools create` 把它们**扁平化**合并成 canonical `vX.Y.Z-pN`
与 `latest`。扁平化后 canonical/latest 的 index 直接引用平台 manifest 与 attestation 的 digest，
**不引用临时 tag 自己的 index digest**，因此可以安全删除临时 tag。

清理由独立工作流 `.github/workflows/gc-staging-tags.yml` 负责（每天 04:17 + 手动 `dry_run`），
执行 `scripts/gc-staging-tags.py`：

- 枚举全部 tag，把形如 `vX.Y.Z-pN-<arch>-<run_id>` 的归为临时 tag；
- 保护集合 = 所有稳定 tag（canonical、`latest`、历史无后缀 tag）的 digest 及其一层子 digest，
  临时 tag 的 digest 命中保护集合时一律跳过；
- 删除临时 tag 自己的 index digest；每个 tag 失败只告警，不中断其余清理；
- 只读场景可用 `--dry-run`（匿名 token 即可）；真正删除需要一个带 `read:packages` + `delete:packages`
  的 token（`GITHUB_TOKEN` 不够，实测 401）。工作流读 `secrets.GC_STAGING_TOKEN`，未配置时只列出不删。
- 手工清理（等价于工作流）：
  ```bash
  OWNER=leonhardthust PACKAGE=siyuan TOKEN=$(gh auth token) python3 scripts/gc-staging-tags.py --dry-run
  OWNER=leonhardthust PACKAGE=siyuan TOKEN=$(gh auth token) python3 scripts/gc-staging-tags.py
  ```
- 2026-11-25 首次清理已完成：删掉 p1/p4/p5/p6 的 8 个临时 tag（HTTP 204），GHCR 上只剩 11 个稳定 tag，
  canonical/latest 的 digest 与平台层未受影响。

**为什么不做成 `release-docker` 的后续 step**：`release-docker.yml` 属镜像相关输入，按版本纪律
必须递增 `PATCH_REVISION`，会为一个纯清理动作产出内容相同的 `pN` 并重启线上。独立工作流不在
`scripts/image-version.mjs` 的镜像相关清单里，可以在不动镜像身份的前提下完成清理；代价是清理最多
滞后 24 小时，期间临时 tag 仍可见（它们是中间产物，不是版本身份）。

## 上游跟随 / 自动构建 / 自动部署

| 工作流 | 触发 | 作用 |
|---|---|---|
| `sync-upstream.yml` | 每天 03:17 | 跟随上游 fork（MohamedElashri）快进；出现分叉推分支并开 issue |
| `watch-upstream.yml` | 每 6 小时 + 手动 | 按完整 tag `vX.Y.Z-pN` 判断是否已构建；预演并应用全部补丁后触发 release-docker |
| `check-image-version.yml` | 每个 PR / main push | 版本纪律硬校验：N 严格递增、首次引入为 1、回退失败；base checker 复跑防自我绕过 |
| `release-docker.yml` | 手动 / 被 watch 触发 | 发布不可变多架构镜像 `vX.Y.Z-pN` 到 GHCR |
| `gc-staging-tags.yml` | 每天 04:17 + 手动 | 删除临时架构 tag；稳定 tag 与其 digest 在保护集合里 |
| `release-cron.yml` | 每天 12:00 UTC + 手动 | 按上游 `vX.Y.Z` 创建 Release（若缺失）并派发 `release-windows`；不派发 docker |
| `release-windows.yml` | 手动 / 被 cron 派发 | 构建 Windows x86_64 安装包并上传到 Release（ARM64 暂停） |
| `release-checksums.yml` | 被 Windows 构建调用 | 生成并上传 `SHA256SUMS.txt` |
| `deploy-siyuan`（私有 config 仓库） | schedule 每 30 分钟 + 手动 | 按上游版本与补丁修订号选镜像，在服务器 runner 上更新、健康检查及失败回滚 |

> **dist 构建范围（2026-11-25）**：docker 镜像 + Windows 桌面端。
> `release-windows.yml` 由 `release-cron.yml` 派发（上游语义 Release），`release-checksums.yml`
> 生成校验和；`release-pc.yml`（Linux/macOS）、`release-ios.yml`、`release-android.yml` 保持删除。
> 临时架构 tag 的清理由 `gc-staging-tags.yml` 独立负责，不需要为它递增 N。

### watch-upstream

1. 取上游 release tag（或手动输入），用仓库 `PATCH_REVISION` 解析出 canonical `vX.Y.Z-pN`；**只看该完整 tag 是否已在 GHCR**。旧无后缀 `vX.Y.Z` 视为 p0，不参与判断，因此不会被误认为“已构建”
2. `git clone --depth=1 --branch <upstream-tag>`，按 `release-docker` 相同顺序逐个 `git apply --check` 并实际应用，检查补丁组合而非只检查各补丁能否单独应用
3. 全部通过且 canonical tag 不存在 → `gh workflow run release-docker -f version=<vX.Y.Z-pN> -f patch_revision=<N>`
4. 任一失败 → 开 issue `patch-drift: <vX.Y.Z-pN>`（assignee 会收到 GitHub 通知邮件）+ 可选 SMTP 邮件，**不构建**
5. 补丁更新后递增 `PATCH_REVISION` 并推送，下一次巡检会为新 pN 构建；canonical 已存在时 release-docker 安全跳过，不会覆写

补丁失配的处理原则：**别只追求"能打上"**（运行时回归的分层做法见 [RUNTIME-REGRESSION.md](RUNTIME-REGRESSION.md)）。`git apply --3way` / `patch -p1 --fuzz=3` 打上之后必须核对语义——
上游很可能把要改的逻辑整体搬了位置，照原样打上去能过编译但行为是错的。

> 实例：3.8.10 把 `DownloadInstallPkg` 的检查从 `skipNewVerInstallPkg()` 里移到了
> `checkDownloadInstallPkg()` 入口。刷新 `disable-update.patch` 时，要么把强制关闭搬到新入口，
> 要么（上游采用的做法，也是本仓库现在的做法）在 `skipNewVerInstallPkg()` 里把该检查补回去并先把
> 标志位改写为 false——因为 `checkDownloadInstallPkg()` 会先调它再读配置，效果等价。
> `disable-update` / `default-config` / `docker-build` 三个上游自带补丁跟随上游版本维护，
> 本 fork 额外维护 `math-renderer-registry.patch`、`content-prefetch.patch`、`startup-slow-loading.patch`。

## 未接入的 WIP：`wip/math-conversion/`

公式形态转换子系统（行内公式 ↔ 块级公式互转，插件可注册转换菜单项），共 7 个补丁，
与 `math-renderer-registry.patch` 同属一条产品线。**未接入任何 workflow，也没有调用方**：
`siyuan-typst-plugin` 只用 `registerMathRenderer`，不涉及转换菜单或 `/api/mathConversion/*`。

已完成 v3.8.11 重基线并在该版本上验证按序应用通过，但刻意不放进 `patches/siyuan/`：
`patches/` 前缀属镜像相关变更，放进去会强制递增 `PATCH_REVISION`，产出一个内容与上一版
完全相同的新 `pN` 并触发线上无谓重启。细节、依赖、应用顺序与接入清单见
[`wip/math-conversion/README.md`](wip/math-conversion/README.md)。

接入前需先补做一件事：与 `content-prefetch` 的组合重基线（当前只在 22 个语言包与
`app/src/protyle/util/destroy.ts` 两处相撞）。

### deploy-siyuan（私有 config 仓库）

- 触发：`schedule`（每 30 分钟）+ `workflow_dispatch`，不在本仓库
- 目标版本：按 (X,Y,Z,N) 数值选择 GHCR 最新完整 tag，旧无后缀 tag 按 p0 兼容；自动模式不降级
- 切换流程：与当前 `.env` 指定的构建一致则跳过（手工 `force=true` 除外）→ 先拉取目标镜像 → 写入 `SIYUAN_TAG`（完整 tag）→ `docker compose up -d`
- 健康检查：最多 45 次，要求 `/api/system/version` 返回上游 `X.Y.Z` **且**运行容器镜像引用（`docker inspect .Config.Image`）等于目标完整 tag；未通过则回滚到切换前的完整 tag。每轮 HTTP 请求最多 3 秒，间隔 2 秒，不承诺固定 90 秒总时限
- 回滚后再做最多 15 次健康检查，仍不健康则显式失败并开 issue，等待人工介入
- `docker-compose.yml` 的镜像行 `${SIYUAN_TAG:-v3.8.8}` 中默认值仍是 p0 历史 tag；切换时应写完整 tag，`.env` 是版本唯一事实来源
- 激活顺序：**先合入 config 版本兼容，再合入 producer 的镜像版本机制**；不通过创建补丁版 GitHub Release 触发镜像更新

服务器侧使用 self-hosted runner，labels：`self-hosted, Linux, X64, siyuan`。

> ⚠️ 仓库是 public，而 self-hosted runner 持有 docker 权限。不要在任何 `pull_request` 触发的工作流上
> 使用 `[self-hosted]` 标签——那等于把服务器交给外部 PR。`deploy-siyuan` 在私有 config 仓库中，
> 只由定时任务/手动触发，外部无法改写。
