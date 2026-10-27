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

## 维护提示

- 三个脚本通过**唯一锚点**做字符串插入，锚点失配会 assert 失败而不是静默产出错误补丁；
- SiYuan 升级后若某个锚点不存在，按新源码调整锚点字符串即可，改动点本身（逻辑）通常不变；
- 生成后必须执行 `git apply --check` 与 `esbuild` 语法检查，再提交到本仓库。
