# PATCHES

本 fork（`LeonhardtHUST/siyuan-patch`）在 [MohamedElashri/siyuan-patch](https://github.com/MohamedElashri/siyuan-patch)
的基础上维护补丁集。所有补丁以 `git apply` 方式应用到 [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan)
对应 tag 的源码树上，由 `.github/workflows/release-*.yml` 构建分发。

> 原则：本仓库只承载**通用呈现管线注入点**，不包含任何 Typst 专属逻辑（Typst 渲染逻辑在
> [siyuan-typst-plugin](https://github.com/LeonhardtHUST/siyuan-typst-plugin) 插件侧）。

## 补丁清单

| 补丁文件 | 用途 | 适用范围 | 说明 |
|---|---|---|---|
| `patches/siyuan/disable-update.patch` | 禁用自动更新提示 | 全部 | 上游自带 |
| `patches/siyuan/default-config.patch` | 默认配置调整 | 全部 | 上游自带 |
| `patches/siyuan/mock-vip-user.patch` | 模拟付费用户（解锁功能） | 全部 | 上游自带 |
| `patches/siyuan/docker-build.patch` | Docker 构建适配 | docker | 上游自带 |
| **`patches/siyuan/math-renderer-registry.patch`** | **数学渲染器注册表：允许插件在 KaTeX 之前认领公式节点** | **docker（已接）** | **本 fork 新增，见下** |

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

## 构建注意事项

- `release-docker.yml` 已加入本补丁的 `git apply` 行，并改造为推送 **GHCR**
  （`ghcr.io/<owner>/siyuan`，使用内置 `GITHUB_TOKEN`，**无需配置任何 secrets**）；
  `release-pc.yml` / `release-android.yml` / `release-ios.yml` **尚未加入**——需要对应平台
  产物时再逐条添加并验证。
- GHCR 镜像默认为 private：拉取前需 `docker login ghcr.io`；首次构建后可在
  Package 设置里改为 public。
- 上游同步：`.github/workflows/sync-upstream.yml` 每日自动快进；出现分叉会推
  `sync/upstream-<date>` 分支并开 issue，**补丁上下文失配是合并时的首要检查项**。

## 上游跟随 / 自动构建 / 自动部署

| 工作流 | 触发 | 作用 |
|---|---|---|
| `sync-upstream.yml` | 每天 03:17 | 跟随上游 fork（MohamedElashri）快进；出现分叉推分支并开 issue |
| `watch-upstream.yml` | 每 6 小时 + 手动 | 检查 `siyuan-note/siyuan` 最新 release，先 `git apply --check` 预演全部补丁 |
| `release-docker.yml` | 手动 / 被 watch 触发 | 构建并发布多架构镜像到 GHCR |
| `deploy-siyuan.yml` | release-docker 成功后 / 手动 | 在服务器 self-hosted runner 上切换镜像、健康检查、失败回滚 |

### watch-upstream

1. 取上游最新 release tag；**GHCR 已有该 tag 的镜像 → 直接跳过**（幂等，不会重复构建/重复开 issue）
2. `git clone --depth=1 --branch <tag>`，按 `release-docker` 相同顺序逐个 `git apply --check`
3. 全部通过 → `gh workflow run release-docker -f version=<tag>`
4. 任一失败 → 开 issue `patch-drift: <tag>`（assignee 会收到 GitHub 通知邮件）+ 可选 SMTP 邮件，**不构建**

补丁失配的处理原则：**别只追求"能打上"**。`git apply --3way` / `patch -p1 --fuzz=3` 打上之后必须核对语义——
上游很可能把要改的逻辑整体搬了位置（3.8.10 就把 `DownloadInstallPkg` 的检查从
`skipNewVerInstallPkg()` 移到了 `checkDownloadInstallPkg()` 入口），照原样打上去能过编译但行为是错的。

### deploy-siyuan

- 目标版本 = GHCR 里最新的 `vX.Y.Z`（或手动指定）；与当前 `.env` 里一致则跳过
- 改 `/opt/siyuan/.env` 的 `SIYUAN_TAG` → `docker compose pull` → `up -d`
- 90 秒内 `/api/system/version` 必须返回目标版本，否则回滚到切换前的 tag 并开 issue

`docker-compose.yml` 的镜像行已改为 `${SIYUAN_TAG:-v3.8.8}`，**`.env` 是版本唯一事实来源**。

服务器侧：`/opt/actions-runner`，运行用户 `ghrunner`（docker 组），
systemd 单元 `actions.runner.LeonhardtHUST-siyuan-patch.siyuan-vm`，
labels `self-hosted,Linux,X64,siyuan,siyuan-server`。

> ⚠️ 仓库是 public，而 self-hosted runner 持有 docker 权限。不要在任何 `pull_request` 触发的工作流上
> 使用 `[self-hosted]` 标签——那等于把服务器交给外部 PR。当前 `deploy-siyuan` 只由
> `workflow_run` / `workflow_dispatch` 触发，两者都只读默认分支，外部无法改写。
