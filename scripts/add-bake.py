#!/usr/bin/env python3
"""把导出烘焙函数追加到 stage/mathRender.ts（v3：与 mathRender 同模块，模块启动即注册 hook）"""
import io

P = "/tmp/pw/stage/mathRender.ts"
s = io.open(P, encoding="utf-8").read()

if "bakeMathInHtml" in s:
    print("已存在 bakeMathInHtml，跳过")
    raise SystemExit(0)

addition = '''
/**
 * 导出烘焙：把 HTML 片段中的数学公式渲染为**内联 SVG**（展平 shadow DOM 后写回）。
 *
 * 用于导出 HTML 与 Electron PDF 预览：导出端（独立窗口/进程）没有 Typst 运行时，
 * 在主窗口完成渲染并烘焙，产物自包含、不依赖导出端脚本。
 * 渲染器由注册表决定（无注册器时即 KaTeX，行为与上游一致）。
 */
export const bakeMathInHtml = async (html: string) => {
    if (!html || !html.includes('data-subtype="math"')) {
        return html;
    }
    try {
        const container = document.createElement("div");
        container.className = "protyle-wysiwyg";
        container.innerHTML = html;
        const mathElements = Array.from(container.querySelectorAll('[data-subtype="math"]')) as HTMLElement[];
        if (mathElements.length === 0) {
            return html;
        }
        await mathRender(container, Constants.PROTYLE_CDN, true);
        let baked = 0;
        mathElements.forEach((el) => {
            // 两种 DOM 形状：块级 div > spin > container(shadow)；行内 span > container(shadow)
            const candidates = [el.firstElementChild, el.firstElementChild && el.firstElementChild.firstElementChild];
            const inner = candidates.find((n) => n && (n as HTMLElement).shadowRoot);
            if (inner && (inner as HTMLElement).shadowRoot) {
                const wrapper = document.createElement("span");
                wrapper.innerHTML = (inner as HTMLElement).shadowRoot!.innerHTML;
                inner.replaceWith(wrapper);
                baked++;
            }
        });
        if (baked === 0) {
            return html;
        }
        return container.innerHTML;
    } catch (e) {
        console.warn("[export] bake math failed:", e);
        return html;
    }
};
// 诊断钩子：供自动化验证/排障（不参与正常流程）
(window as any).__siyuanBakeMathForExport = bakeMathInHtml;
'''

s = s.rstrip() + "\n" + addition
io.open(P, "w", encoding="utf-8").write(s)
print("bakeMathInHtml 已追加到 stage/mathRender.ts")
