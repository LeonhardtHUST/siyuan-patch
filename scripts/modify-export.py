#!/usr/bin/env python3
"""在 v3.8.8 的 export/index.ts 上接入导出烘焙（v3：调用移到 mathRender.ts 的 bakeMathInHtml）"""
import io

SRC = "/tmp/pw/siyuan-src/app/src/protyle/export/index.ts"
OUT = "/tmp/pw/stage/export-index.ts"

s = io.open(SRC, encoding="utf-8").read()

# ---------- H1: 导入 bakeMathInHtml ----------
anchor1 = 'import {fetchPost, fetchSyncPost} from "../../util/fetch";\n'
assert s.count(anchor1) == 1, "H1 锚点不唯一"
s = s.replace(anchor1, anchor1 + 'import {bakeMathInHtml} from "../render/mathRender";\n')

# ---------- H2: onExport 入口烘焙 ----------
anchor2 = """    } : {js: "", css: ""};
    const html = `<!DOCTYPE html>"""
assert s.count(anchor2) == 1, "H2 锚点不唯一"
h2 = """    } : {js: "", css: ""};
    // 数学公式应用内预烘焙（导出产物自包含，不依赖导出端脚本）
    if (data && data.data && typeof data.data.content === "string") {
        data.data.content = await bakeMathInHtml(data.data.content);
    }
    const html = `<!DOCTYPE html>"""
s = s.replace(anchor2, h2)

# ---------- H3: renderPDF 预取 + 模板注入 ----------
anchor3 = """    const html = `<!DOCTYPE html>
<html lang="${window.siyuan.config.appearance.lang}" data-theme-mode="light" data-light-theme="""
assert s.count(anchor3) == 1, "H3 锚点不唯一"
h3 = """    // 应用内预取导出内容并烘焙公式：Electron 预览窗口是独立进程，无法运行 Typst 渲染器，
    // 因此在主窗口把公式渲染为内联 SVG 后注入预览页。
    let bakedPreviewContent = "";
    try {
        const previewResponse = await new Promise<any>((resolve) => {
            fetchPost("/api/export/exportPreviewHTML", {
                id,
                keepJSEmbed: true,
                keepFold: localData.keepFold,
                pdf: true,
                excludeTitleImage: localData.titleImage === false,
                addTitle: window.siyuan.config.export.addTitle,
                customTitle: "",
                merge: localData.mergeSubdocs,
                mergeDocHeadingMode: localData.mergeDocHeadingMode,
                mergeContentHeadingMode: localData.mergeContentHeadingMode,
            }, (response: any) => resolve(response));
        });
        if (previewResponse && previewResponse.code === 0 && previewResponse.data) {
            bakedPreviewContent = await bakeMathInHtml(previewResponse.data.content);
        }
    } catch (e) {
        console.warn("[export] prefetch preview content failed:", e);
    }
    const html = `<!DOCTYPE html>
<html lang="${window.siyuan.config.appearance.lang}" data-theme-mode="light" data-light-theme="""
s = s.replace(anchor3, h3)

# ---------- H4: 模板内 renderPreview 使用烘焙内容 ----------
anchor4 = """    const renderPreview = async (data) => {
        previewElement.innerHTML = '<div style="padding:8px 0 0 0" class="protyle-wysiwyg"""
assert s.count(anchor4) == 1, "H4 锚点不唯一"
h4 = """    const __bakedMathContent = ${JSON.stringify(bakedPreviewContent)};
    const renderPreview = async (data) => {
        if (typeof __bakedMathContent === "string" && __bakedMathContent) {
            data = Object.assign({}, data, {content: __bakedMathContent});
        }
        previewElement.innerHTML = '<div style="padding:8px 0 0 0" class="protyle-wysiwyg"""
s = s.replace(anchor4, h4)

# ---------- H5: 已烘焙节点不再重渲染 ----------
anchor5 = """        previewElement.querySelectorAll('[data-type="NodeMathBlock"]').forEach((item) => {
            // 超级块内不能移除 width https://github.com/siyuan-note/siyuan/issues/14318
            item.removeAttribute('data-render');
        })"""
assert s.count(anchor5) == 1, "H5 锚点不唯一"
h5 = """        previewElement.querySelectorAll('[data-type="NodeMathBlock"]').forEach((item) => {
            if (item.querySelector("svg")) {
                // 已在主窗口烘焙为内联 SVG，保留 data-render 以免被 KaTeX 覆盖
                return;
            }
            // 超级块内不能移除 width https://github.com/siyuan-note/siyuan/issues/14318
            item.removeAttribute('data-render');
        })"""
s = s.replace(anchor5, h5)

io.open(OUT, "w", encoding="utf-8").write(s)
print("export/index.ts v3 修改完成 ->", OUT)
