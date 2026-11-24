# math-conversion（未接入的 WIP 补丁集）

公式形态转换子系统：把行内公式与块级公式互转（`convertMath` 事务），并允许插件往「转换为」
子菜单追加条目。与已发布的 `math-renderer-registry.patch` 属于同一条产品线：registry 让插件
**渲染**公式，这套让插件**生成/转换**公式。

当前状态：已完成 v3.8.11 重基线并验证可应用，但**未接入任何 workflow、没有调用方**，
因此不参与构建，也不影响镜像版本。

## 为什么放在 `wip/` 而不是 `patches/siyuan/`

`scripts/image-version.mjs` 把 `patches/` 前缀视为镜像相关变更，改动即要求 `PATCH_REVISION`
严格递增。这七个补丁目前不进镜像，若放进 `patches/siyuan/` 就会被迫产出一个内容与上一版
完全相同的新 `pN`，并触发一次线上的无意义重启。放在 `wip/` 下既不触发版本递增，也不误导 CI。

## 内容与依赖

| 补丁 | 层次 | 说明 |
|---|---|---|
| `math-conversion-core` | 内核算法 | `kernel/mathconversion/`：planner、bounds、roundtrip；forest 预算、无环树校验 |
| `math-conversion-transaction` | 内核事务 | `convertMath` 操作、undo 反向操作、undolog、FTS5 一致性 |
| `math-conversion-transaction-guards` | 内核事务 | 事务边界与并发守卫 |
| `math-conversion-api` | HTTP 接口 | `/api/mathConversion/getTarget`、业务错误码、契约测试 |
| `math-conversion-menu` | 插件 API | `registerMathConversionMenuProvider` |
| `math-conversion-bridge` | 前端 | 调接口、刷新渲染、22 个语言包各 6 条提示 |
| `math-render-surface-context` | 前端 | 渲染表面上下文贯通导出/标题/AV richText/表格等 23 处 |

**前置**：必须先应用仓库里已发布的 `patches/siyuan/math-renderer-registry.patch`
（本套依赖它新建的 `mathRendererRegistry.ts`）。

**顺序**：registry → core → transaction → transaction-guards → api → menu → **bridge** → render-surface-context。
`menu` 必须先于 `bridge`：`menu` 把 `app/src/menus/protyle.ts` 改到 `bridge` 期望的形态，顺序颠倒会失败。

## 已验证（2026-11-24）

- 基线：这七个补丁原本基于 v3.8.10，共 30 处冲突文件
- 重基线后逐个在 v3.8.11 源码树上按上述顺序 `git apply` 全部通过（72 个文件变更）
- 与仓库现有 registry 补丁配合应用通过（registry 未改动）
- 冲突按语义解决：语言包把 6 条 `mathConversion*` 键插到文件开头；`index.d.ts` 的
  `TransactionOperation` / `TransactionOperationRequest` 两个 union 各补入 `convertMath` 变体，
  同时保留上游 v3.8.11 新增的 `setAttrViewShowRelationIcon`；`processCode.ts` 两侧 import 均保留；
  `export/index.ts` 保留上游的 `observeTableCorners` 并采用带 surface 参数的 `mathRender`

## 接入构建前还要做

1. **与 `content-prefetch` 做一次组合重基线（须在 v3.8.12 基线上做）**。2026-11-24 已在
   v3.8.11 + 已接入补丁的组合树上验证：7 个补丁按序应用后只剩两处同址冲突，合并方式固定为
   - 22 个语言包：各自都想在 `{` 之后插入键（内容互不影响，合并即可）
   - `app/src/protyle/util/destroy.ts`：两者都在 `destroy()` 里插入清理代码，合并保留双方

   但 `content-prefetch` 已在 2026-11-24 重基线到 v3.8.12（上游新增 22 个语言键、改写
   `destroy.ts` 与 `index.d.ts` 类型），所以这套补丁也必须在 v3.8.12 上重做一次组合重基线，
   再逐条核对语义。
2. 把七个文件移到 `patches/siyuan/`，并在 `release-docker.yml` 与 `watch-upstream.yml` 的补丁
   列表里按上述顺序追加（顺序必须两处一致）。平台 dist 构建自 2026-11-24 起已停用，
   平台 dist 工作流已删除，不再需要改它们。
3. 递增 `PATCH_REVISION`（`patches/**` 变更强制要求），这会产生新的 `pN` 镜像
4. 验证：`pnpm run test:focused src/protyle/render/mathConversionBridge.test.ts` 等、
   `go test ./kernel/mathconversion/...`、`go test ./kernel/model -run MathConversion`；
   镜像构建还会跑 `docker-build.patch` 里的 OCR 校验

## 提醒

这套代码目前**没有任何调用方**：`siyuan-typst-plugin` 只用了 `registerMathRenderer`，
没有引用 `registerMathConversionMenuProvider` 或 `/api/mathConversion/getTarget`。
接入前应先确认插件侧确实要用转换菜单，否则会给每次上游升级增加一份 rebase 负担。
