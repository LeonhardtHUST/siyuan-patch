# config 部署版本兼容说明

部署版本兼容改造已先行合入私有 config 仓库的 `master`（`8f441e4`）。通常直接获取该仓库的最新代码，不要重复应用历史补丁。

本目录只保留**通用说明**。历史补丁是**本地未跟踪交付物**，不随本仓库（public）提交：

- 交付文件：`.scratch/config-versioning-deploy.patch`（被本仓库 `.git/info/exclude` 排除，
  不在版本控制内；不要 `git add` 它）。
- 该补丁内容是私有仓库 config 的改动原文，含部署路径与 runner 信息，
  **只能发往 config 私有仓库**，不得贴到公开 issue / PR / 截图 / 公开提交里。
- 本仓库的 CI 不会应用它（release-* 只显式应用 `patches/siyuan*`）。

## 为什么需要这个补丁

镜像由本仓库构建，但"部署哪个镜像"由 config 的 `deploy-siyuan` 工作流决定。
该工作流原先只认无后缀 `vX.Y.Z`：

| 能力 | 旧行为 | 需要的行为 |
|---|---|---|
| tag 识别 | 只匹配 `vX.Y.Z` | 额外匹配自构建 tag `vX.Y.Z-pN`（N≥1） |
| 排序 | 只比三段版本 | 比 `(X, Y, Z, N)` 四元组，数值序（`p10 > p2`） |
| 历史 tag | 无概念 | 无后缀 `vX.Y.Z` 视为修订号 0，仅用于回滚 |
| 健康检查 | 只比版本号 | 上游 `X.Y.Z` **且**容器镜像引用等于目标完整 tag |
| 回滚 | 写回完整 tag（可用） | 保持，并校验回滚目标合法、回滚失败要显式失败 |

**兼容窗口**：部署端适配必须先于构建端合入；旧部署逻辑会忽略 `-pN` 镜像。
config 的兼容改造已合入，构建和部署仍各有独立的 CI 运行记录，不能仅凭代码推送就判定服务已更新。

## 历史补丁应用方法（仅限旧基线）

```bash
# 1) 在私有 config 克隆里，确认基线为 master 47770a8
git -C <config-clone> rev-parse HEAD

# 2) 预检并应用本地交付的补丁
git -C <config-clone> apply --check <siyuan-patch>/.scratch/config-versioning-deploy.patch
git -C <config-clone> apply         <siyuan-patch>/.scratch/config-versioning-deploy.patch

# 3) 应用后在 config 克隆内跑自检
python3 -B siyuan/test_tag_version.py
```

回滚补丁：`git apply -R`。

## 边界

- 补丁不含 `.env`、workspace 或任何凭据；其中的访问密码只有变量名与占位符。
- 生成方式：在私有 config 克隆里按显式文件路径 `git diff`，`__pycache__` /
  `.scratch` 等未跟踪目录不纳入。
- 是否提交、何时合并由维护者决定；本仓库不保存该补丁的公开副本。
