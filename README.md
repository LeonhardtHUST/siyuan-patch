# SiYuan Note - Modified Version

[![Docker build](https://github.com/LeonhardtHUST/siyuan-patch/actions/workflows/release-docker.yml/badge.svg)](https://github.com/LeonhardtHUST/siyuan-patch/actions/workflows/release-docker.yml)
[![Windows build](https://github.com/LeonhardtHUST/siyuan-patch/actions/workflows/release-windows.yml/badge.svg)](https://github.com/LeonhardtHUST/siyuan-patch/actions/workflows/release-windows.yml)

This repository publishes modified **Docker images** of [SiYuan Note](https://github.com/siyuan-note/siyuan)
for server deployment (GHCR) and modified **Windows desktop installers** (x86_64 / ARM64) attached to the
upstream-semantics GitHub Release.

> 本仓库当前只产出两类东西：docker 镜像（`ghcr.io/leonhardthust/siyuan`）与 Windows 桌面端安装包。
> Linux / macOS / iOS / Android 的 dist 构建已于 2026-11-24 停止，需要这些平台请使用上游项目或父仓库的发布产物。

## Docker

Multi-architecture images (`amd64` + `arm64`) are published to GHCR as `ghcr.io/leonhardthust/siyuan`:

```bash
docker pull ghcr.io/leonhardthust/siyuan:latest
```

Image tags follow this discipline (see [PATCHES.md](PATCHES.md) for details):

| Tag | Meaning |
|---|---|
| `vX.Y.Z` | Upstream source tag. The legacy bare image tag is `p0`: historical only, never published or overwritten. |
| `vX.Y.Z-pN` | Canonical, immutable image tag for this repository. `N` is the repository-wide `PATCH_REVISION`. |
| `latest` | Moving convenience alias. Not a version identity; do not use it for deployment or rollback. |

`PATCH_REVISION` is a single repository-wide positive integer and is monotonic across upstream versions (it does not reset when a new upstream `vX.Y.Z` arrives). Changes to patches or build inputs must increment it; `.github/workflows/check-image-version.yml` enforces this on every PR and main push, and `release-docker` refuses to publish unless the exact commit passed that check on `main`.

> **Deployment compatibility:** the server-side `deploy-siyuan` workflow lives in a private config repository. Support for `-pN`, numeric ordering, and exact image-reference health checks was merged there first (`8f441e4`). Keep that order when migrating: config first, then the image-tag producer. Push checks validate the code; scheduled or manual runs build and deploy images separately.

```bash
docker pull ghcr.io/leonhardthust/siyuan:v3.8.12-p6
```

`latest` exists only as a moving alias. `deploy-siyuan` uses the full `vX.Y.Z-pN` tag and compares the running image reference as well as `/api/system/version` (which reports upstream `X.Y.Z`). See the [deployment compatibility and integration order](PATCHES.md#部署端兼容与合入顺序).

## Windows

Windows 安装包随上游语义的 GitHub Release（tag = `vX.Y.Z`）发布，由 `release-cron` 在检测到新上游版本后
创建 Release 并派发 `release-windows` 构建：

| Platform | Architecture | Asset |
|---|---|---|
| Windows | x86_64 | `siyuan-vX.Y.Z-win.exe` |
| Windows | ARM64 | `siyuan-vX.Y.Z-win-arm64.exe` |

每个 Release 还附带 `SHA256SUMS.txt`。Windows 构建不应用 `docker-build` 与 `math-renderer-registry`
两个 docker 专用补丁，其余补丁与 docker 一致。

## Feature Modifications

### Functionality
The modified version includes local access to premium features that typically require a VIP subscription in the official version. These features include:

- Support for third-party S3 storage for data synchronization and backup
- WebDAV integration for data synchronization and backup (excluding Nutstore)
- Full-text search capabilities for resource files
- PDF and image export with watermark functionality

### Privacy and Performance Enhancements
Several changes have been made to improve privacy and user experience:

- Automatic update downloads are disabled
- Google Analytics is disabled by default
- Error reporting and diagnostic data collection are disabled
- VIP badge and custom title bar displays are removed
- System tray minimization is enabled by default when clicking the close button
- Optional content prefetching follows document block boundaries to prepare nearby note sections and same-origin images; enable it in Settings - Editor - Behavior (disabled by default)

## Building from Source

### Automated Builds
- `watch-upstream` checks every 6 hours, rehearses the whole patch series against the upstream tag, and triggers `release-docker` for the full image tag `vX.Y.Z-pN` when that tag is not yet published.
- `release-cron` runs daily: it creates the upstream-semantics GitHub Release (`vX.Y.Z`) when missing and dispatches `release-windows`; `release-checksums` then uploads `SHA256SUMS.txt`.
- `gc-staging-tags` runs daily: it deletes the intermediate `vX.Y.Z-pN-<arch>-<run_id>` tags, keeping canonical `vX.Y.Z-pN`, `latest` and legacy tags.
- `check-image-version` enforces the version discipline on every PR and `main` push.
- `sync-upstream` fast-forwards the parent fork daily and opens an issue when patches drift.

### Manual Build Instructions

1. Fork this repository to your GitHub account

2. Docker Image Builds
   - No Docker Hub secrets are needed: images are pushed to GHCR with the built-in `GITHUB_TOKEN`.
   - Ensure the workflow has `packages: write` permission (already configured).
   - Dispatch `release-docker` with the upstream tag or full image tag; the workflow derives `vX.Y.Z-pN` from `PATCH_REVISION`.
   - Build time depends on cache and runner; the most recent runs took about 30.6 min (amd64) and 37.7 min (arm64).

Note: To rebuild Docker content for the same upstream version, increment `PATCH_REVISION`;
a new immutable `vX.Y.Z-pN` tag is produced.

## License

Released under the same license terms as the upstream [SiYuan](https://github.com/siyuan-note/siyuan) project.
