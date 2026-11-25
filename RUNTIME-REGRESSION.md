# 运行时回归：分层做法与现状

本仓库的补丁改动都是「注入点 + 行为开关」，`git apply` 成功只说明上下文没漂移。要判断它们**在运行时是对的**，
需要分层验证。下面按「成本从低到高、覆盖从弱到强」列出五层，标出哪些已经自动化、哪些还需要人/真实环境。

> 一句话结论：L0–L4 已经在流水线里自动跑；L5（收益与真实交互）没有自动跑，需要真实实例 + 网络条件，
> 建议按本文件的 playbook 在每次「补丁行为有实质变化」时手工过一遍，而不是每次上游小版本都做。

## L0 补丁可应用（自动）

```bash
git clone --depth=1 --branch vX.Y.Z https://github.com/siyuan-note/siyuan.git
cd siyuan
for p in disable-update default-config mock-vip-user docker-build \
         math-renderer-registry content-prefetch startup-slow-loading; do
  git apply /path/to/siyuan-patch/patches/siyuan/$p.patch
done
```

覆盖：上下文漂移、补丁顺序依赖。
不覆盖：语义正确性（上游可能把逻辑整体搬家，打上能编译但行为错）。

流水线位置：`watch-upstream` 的「预演打补丁」步骤，失败即开 issue、不构建。

## L1 编译进镜像 / 安装包（自动）

- docker：`release-docker` 的两个架构 job 都会在打过补丁的源码树上完整构建（前端 + Go kernel）。
- Windows：`release-windows` 的 `windows-latest` / `windows-11-arm` 两个 job 同样从打过补丁的源码树构建。

覆盖：编译期错误、缺依赖、平台条件编译（如 `/// #if !MOBILE`）。

## L2 产物里真的有补丁（自动 + 可复核）

从已发布镜像里直接核对标记物，不需要跑容器：

```bash
# 取 amd64 镜像 → 逐层下载 → 检查 langs 与前端 bundle
# 2026-11-25 对 v3.8.12-p6 的实测结果：
#   appearance/langs/en.json / zh-CN.json：各有 contentPrefetch + contentPrefetchTip
#   stage/build/app/*.js：contentPrefetch ×33、registerMathRenderer ×6、canRender ×6
#   stage/build/app/*.js：siyuan-startup-stage ×15、data-startup-stage ×10
#   stage/build/app/*.js：mathConversion / convertMath = 0（wip 未接入的反向证据）
```

覆盖：补丁内容确实进了产物、未接入的 wip 没有误入。
不覆盖：运行时分支是否被走到。

## L3 打过补丁的源码树里跑定向测试（半自动）

```bash
# 在 L0 的克隆里（已打补丁）
cd app
pnpm install --no-frozen-lockfile
pnpm run test:focused src/protyle/scroll/contentPrefetch.test.ts \
                      src/protyle/scroll/indexRequest.test.ts \
                      src/boot/startupError.test.ts
```

覆盖：预取策略/边界、失效与取消逻辑、启动诊断的计时与阶段机。
注意：这些测试是补丁自带的，要用**反向验证**确认它们不是空转——在未打补丁的源码树上这些文件不存在或无法运行。

2026-11-25 在真实 v3.8.12 + 全部 7 个补丁的源码树上实测：

| 测试文件 | 结果 |
|---|---|
| `src/protyle/scroll/contentPrefetch.test.ts`（补丁新增，21 用例，含 9 个 `node:vm` 真跑 dynamic load） | ✅ 21/21 |
| `src/protyle/scroll/indexRequest.test.ts` | ✅ 2/2 |
| `src/boot/startupError.test.ts`（补丁把用例从 10 扩到 16） | ✅ 16/16 |
| `src/protyle/render/mathRenderSecurity.test.ts` | ✅ 11/11 |
| 4 个 `transaction*.test.ts` | ✅ 91/91 |
| `src/protyle/render/mathLayout.test.ts` | ❌ **1/1 失败**（见下） |

**已知真实回归（待修）**：`mathLayout.test.ts` 用 `transpileModule` 把 `mathRender.ts` 单独编译并注入一张固定依赖表；
`math-renderer-registry` 补丁新增了 `findMathRenderer` / `applyInlineMathBoundaries` 两个运行时依赖，但没同步补进那张表，
因此打过补丁后该用例报 `ReferenceError: findMathRenderer is not defined`（未打补丁的树 1/1 通过）。
修法：在该测试的依赖表里补这两个符号（推荐，还能顺带断言"渲染器认领"路径），或改为真实 import。
docker 构建不跑测试，所以这个问题不会挡住发布，但会让「打过补丁的树跑 `pnpm test`」出现红。

反向验证：未打补丁的 worktree 里 `contentPrefetch.test.ts` 不存在、直接拒跑，`indexRequest/startupError` 只有 12 个用例
（10+2）；打过补丁后变 18 个 → 测试确实随补丁新增，不是把旧用例重跑一遍。

`pnpm run typecheck`（4 个 tsc 项目）✅；补丁触及的 12 个文件 eslint ✅；`pnpm run api:check` 无法运行（需要 Go 解析
kernel apicontract，本机无 Go）。

## L4 部署烟测（自动，已在生产跑过）

`deploy-siyuan`（私有 config 仓库 `LeonhardtHUST/config`）每 30 分钟轮询 GHCR，切换后要求：

```bash
# /api/system/version 返回上游 X.Y.Z
curl -s http://<host>:6806/api/system/version
# 运行容器镜像引用必须等于目标完整 tag（否则同版本不同 pN 会假通过）
docker inspect -f '{{.Config.Image}}' siyuan
```

2026-11-25 实测：`v3.8.11-p5` → `v3.8.12-p6` 切换成功，健康检查通过（镜像引用 + `3.8.12`）。
覆盖：镜像能启动、kernel 能响应、版本契约正确。
不覆盖：前端功能与收益。

## L5 行为与收益回归（未自动化，需要真实实例）

三条改动各自需要不同的验收方式：

### 5.1 content-prefetch：弱网收益与额外流量

验收标准：
- 关（默认）时：滚动到区块边界不产生「投机」请求；只有真实加载。
- 开时：产生投机请求，但前台真实加载开始后投机请求被取消；单编辑器最多 1 个投机请求、
  间隔 ≥800ms、单次 ≤512 块 / 2MiB / 8s；图片串行、每段 ≤8 张、单张 ≤8MiB / 8s。
- 流量代价可接受：同一文档走完，开启后总字节数增量在预期范围内。

做法（任选其一）：
```bash
# A. 浏览器侧（推荐）：CDP 采集请求，比较开/关两轮
#    - Network.enable → 录制请求，按 URL/时序分类“真实加载 / 投机预取”
#    - 断言：开启时存在投机请求；真实加载开始后其被取消（requestWillBeSent + loadingFailed）
# B. 服务端侧：对比两次滚动会话在 /api/filetree/getDoc* 上的请求数与字节数
```
弱网条件用 CDP `Network.emulateNetworkConditions`（如 1.5Mbps / 150ms RTT，或 Slow 3G 预设）制造。

### 5.2 math-renderer-registry：插件认领后 KaTeX 完全不加载

验收标准：含 Typst 公式的文档打开后，`window.katex === undefined`、`katex.min.js` 请求数 = 0、
导出 PDF 时渲染器 Promise 被等待（PDF 里是 Typst 渲染结果而不是 KaTeX）。

做法：
1. 装 [siyuan-typst-plugin](https://github.com/LeonhardtHUST/siyuan-typst-plugin)，创建含公式的文档；
2. CDP 录制网络：断言 `katex.min.js` / katex CSS 请求为 0；
3. 导出 PDF，检查目标区域渲染来源。

### 5.3 startup-slow-loading：120 秒预算与阶段标签

验收标准：
1. 页面资源阶段拿满 120 秒预算，业务阶段仍是 30 秒；
2. `DOMContentLoaded` 时阶段仍为 `page` → 预算收窄为 30 秒并从 DOM ready 重计；
3. 主脚本 `error` 仍立即失败；页面隐藏时暂停计时，`ready`/`dispose` 清理计时器。

做法：用 CDP/本地反向代理给 `app/stage/build/*.js` 注入 30–130 秒延迟，观察错误页的
`data-startup-stage` / 阶段标签与失败时刻；对照未打补丁的镜像确认 30 秒即失败。

## 频率建议

| 触发条件 | 需要跑 |
|---|---|
| 上游小版本（补丁只需重基线） | L0–L4（流水线自动）+ L2 抽检 |
| 补丁行为有实质改动（如新增分支/阈值） | L0–L4 + 对应那条 L5 |
| 部署端/镜像构建方式改动 | L0–L4 + 5.1 流量对比 |
| 大版本升级 | L0–L5 全量 |

## 现状缺口（2026-11-25）

- L5 三项都没有自动跑；L3 只覆盖前端单测，Go 侧（`kernel/mathconversion`、`kernel/model` 事务）**未跑**
  （本机无 Go 工具链；docker 构建只编译不测试），`pnpm run api:check` 因此也未验证。
- `mathLayout.test.ts` 的回归（见 L3）尚未修；修它需要动 `patches/siyuan/math-renderer-registry.patch`，
  按版本纪律会强制递增 `PATCH_REVISION`。
- 没有可登录的测试实例：生产实例的访问码只在服务器 `.env`，本地 WSL 也没有 docker。
  要长期跑 L5，建议单独起一个带固定 `--accessAuthCode` 的测试容器（与生产隔离）。
