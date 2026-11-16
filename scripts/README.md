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

## 维护提示

- 三个脚本通过**唯一锚点**做字符串插入，锚点失配会 assert 失败而不是静默产出错误补丁；
- SiYuan 升级后若某个锚点不存在，按新源码调整锚点字符串即可，改动点本身（逻辑）通常不变；
- 生成后必须执行 `git apply --check` 与 `esbuild` 语法检查，再提交到本仓库。
