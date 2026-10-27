#!/usr/bin/env python3
"""在 v3.8.8 的 plugin/index.ts 上插入 math renderer API（v1 逻辑复用）"""
import io

SRC = "/tmp/pw/siyuan-src/app/src/plugin/index.ts"
OUT = "/tmp/pw/stage/plugin-index.ts"

s = io.open(SRC, encoding="utf-8").read()

import_anchor = 'import type {TCustomBlockRender} from "./customBlockRender";\n'
assert s.count(import_anchor) == 1, "import 锚点不唯一"
imports = (
    import_anchor
    + 'import type {IMathRenderer} from "../protyle/render/mathRendererRegistry";\n'
    + 'import {registerMathRenderer as registerMathRendererRegistry, '
      'unregisterMathRenderer as unregisterMathRendererRegistry} '
      'from "../protyle/render/mathRendererRegistry";\n'
)
s = s.replace(import_anchor, imports)

method_anchor = """    public uninstall(): Promise<void> | void {
        // 卸载
    }
"""
assert s.count(method_anchor) == 1, "方法锚点不唯一"
methods = method_anchor + """
    /**
     * 注册数学公式渲染器：在 KaTeX 渲染前认领公式节点。
     * 认领成功后该节点不会触发 KaTeX 的加载与渲染，渲染失败自动回退 KaTeX。
     * @param id 渲染器标识（按插件名自动命名空间化，避免插件间冲突）
     * @param renderer 渲染器实现
     */
    public registerMathRenderer(id: string, renderer: IMathRenderer) {
        registerMathRendererRegistry(`${this.name}/${id}`, renderer);
    }

    /**
     * 注销数学公式渲染器
     * @param id 注册时使用的标识
     */
    public unregisterMathRenderer(id: string) {
        unregisterMathRendererRegistry(`${this.name}/${id}`);
    }
"""
s = s.replace(method_anchor, methods)

io.open(OUT, "w", encoding="utf-8").write(s)
print("plugin/index.ts 修改完成 ->", OUT)
