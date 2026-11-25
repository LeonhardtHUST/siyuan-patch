# 补丁生成脚本

`patches/siyuan/math-renderer-registry.patch` 由以下脚本对 **siyuan v3.8.8 原始源码**生成，
用于在 SiYuan 升级后重新生成补丁（上游发版时补丁上下文失配的修复入口）。

## 用法

```bash
# 1) 准备原始源码（与 CI 相同的 tag）
mkdir -p /tmp/pw && cd /tmp/pw
curl -L -o siyuan.tar.gz https://codeload.github.com/siyuan-note/siyuan/tar.gz/refs/tags/v3.8.8
mkdir -p siyuan-src && tar -xzf siyuan.tar.gz -C siyuan-src --strip-components=1

# 2) 生成三个"改造后"文件到 /tmp/pw/stage/
python3 scripts/modify-plugin.py    # app/src/plugin/index.ts  → stage/plugin-index.ts
python3 scripts/modify-export.py    # app/src/protyle/export/index.ts → stage/export-index.ts

# 3) 组装 git diff 并校验
#    （scripts/build-patch.py 依赖 /tmp/pw/stage 下的全部文件；
#      mathRender.ts / mathRendererRegistry.ts / mathBoundaries.ts 需先放入 stage）
python3 scripts/build-patch.py      # 输出 /tmp/pw/math-renderer-registry.patch 并做 git apply --check
```

## 内容预取补丁

`patches/siyuan/content-prefetch.patch` 基于 **siyuan v3.8.10**，与上述数学渲染器脚本相互独立。修改或升级时在固定 tag 的干净源码树应用补丁，再维护配置字段、前端逻辑、对应回归测试及生成的 API 类型/Schema。不要用数学渲染器的 `build-patch.py` 覆盖内容预取补丁。

重新输出时应包含新增的 `app/src/protyle/scroll/contentPrefetch*.ts` 文件（可先 `git add --intent-to-add` 再 `git diff --binary HEAD`，无需提交），随后分别验证独立应用和 Docker 全部补丁的顺序应用。设置与 API 契约变动先运行上游 `app/scripts/api-contracts.mjs` 生成声明，不能手改生成文件。该补丁包含本源码树内的 API 生成物，不包含外部 Petal 仓库变更；若维护插件公开声明，须按上游规则另行同步 Petal。详细行为边界及测试命令见 [PATCHES.md](../PATCHES.md#content-prefetchpatch)。

## 镜像版本身份 helper

镜像 tag `vX.Y.Z-pN` 的解析、校验和 GHCR 存在性判断由三个 Node helper 完成，
唯一来源是仓库根 `PATCH_REVISION`（全局单调、跨上游不重置）：

| 文件 | 作用 |
|---|---|
| `image-version.mjs` | 解析上游/完整 tag、校验 N 与 `PATCH_REVISION` 相等、构造临时架构 tag、prepare/publish 决策 |
| `registry-tag-state.mjs` | GHCR manifest HEAD 查询；200=exists、404=absent，鉴权/网络/超时/重定向一律 fail closed |
| `gc-staging-tags.py` | 删除 `vX.Y.Z-pN-<arch>-<run_id>` 临时 tag；稳定 tag 及其子 digest 一律保护，支持 `--dry-run` |
| `check-image-version.mjs` | `ci`：基线 diff 校验；`gate`：要求该 commit 的 `check-image-version` push 运行已在 main 通过 |

```bash
# 本地自测（无第三方依赖）
node --test scripts/image-version.test.mjs scripts/registry-tag-state.test.mjs scripts/check-image-version.test.mjs

# 查看当前完整 tag 解析结果
node scripts/image-version.mjs resolve --version v3.8.10 --file PATCH_REVISION

# 校验当前工作树相对某基线 commit 的修订号纪律
node scripts/check-image-version.mjs ci --base-sha <base-sha>
```

**递增流程**：修改 `patches/**` 或构建/调度相关 workflow、helper 后，把 `PATCH_REVISION`
改成严格更大的正整数并随代码一起提交；只改文档不强制递增，单独递增 N 可用于重建。
canonical tag 已存在时 `release-docker` 会安全跳过，绝不覆写。

**稳定接口**：`ci` / `gate` 的参数（`--base-sha`、`--base-file`、`--changed-path`、
`--repo`、`--sha`、`--token-env`）是对基线 checker 的稳定契约。
`check-image-version.yml` 会在 workflow bash 中先从 base commit 取出旧 helper 独立复跑，
再跑 head checker；后续版本不得破坏这些参数，否则 CI 会拒绝通过（防止通过修改 checker 自我绕过）。

`PATCH_REVISION`、workflow 和执行细节见 [PATCHES.md](../PATCHES.md#镜像版本与不可变-tag-纪律)。

## 维护提示

- 三个脚本通过**唯一锚点**做字符串插入，锚点失配会 assert 失败而不是静默产出错误补丁；
- SiYuan 升级后若某个锚点不存在，按新源码调整锚点字符串即可，改动点本身（逻辑）通常不变；
- 生成后必须执行 `git apply --check` 与 `esbuild` 语法检查，再提交到本仓库。
