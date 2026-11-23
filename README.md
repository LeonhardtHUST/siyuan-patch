# SiYuan Note - Modified Version

[![Latest release](https://img.shields.io/github/v/release/MohamedElashri/siyuan-patch?label=latest%20release)](https://github.com/MohamedElashri/siyuan-patch/releases/latest)
[![PC build](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-pc.yml/badge.svg)](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-pc.yml)
[![Android build](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-android.yml/badge.svg)](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-android.yml)
[![Docker build](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-docker.yml/badge.svg)](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-docker.yml)
[![iOS build](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-ios.yml/badge.svg)](https://github.com/MohamedElashri/siyuan-patch/actions/workflows/release-ios.yml)

This repository contains modified builds of [SiYuan Note](https://github.com/siyuan-note/siyuan), focusing on Linux, Windows, macOS, iOS, Android, and Docker server deployments. Linux and Windows desktop builds are available for both x86-64 and ARM64.

## Downloads

### Desktop

#### Linux

Choose the package format for your distribution and architecture:

| Package format | x86_64 | ARM64 |
| --- | --- | --- |
| Portable tarball | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-linux.tar.gz) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-linux-arm64.tar.gz) |
| AppImage | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-x86_64.AppImage) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-aarch64.AppImage) |
| Debian / Ubuntu (`.deb`) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-amd64.deb) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-arm64.deb) |
| Fedora / RHEL (`.rpm`) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-linux.rpm) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-linux-arm64.rpm) |
| Arch Linux (`.pkg.tar.zst`) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-archlinux-x86_64.pkg.tar.zst) | [Download](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-archlinux-aarch64.pkg.tar.zst) |

#### Windows and macOS

| Platform | Architecture | Download |
| --- | --- | --- |
| Windows | x86_64 | [Installer](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-win.exe) |
| Windows | ARM64 | [Installer](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-win-arm64.exe) |
| macOS | Intel | [DMG](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-mac.dmg) |
| macOS | Apple Silicon | [DMG](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-mac-arm64.dmg) |

### Mobile

| Platform | Architecture | Download |
| --- | --- | --- |
| Android | ARM64 | [APK](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-android-arm64.apk) |
| iOS | ARM64 | [IPA](https://github.com/MohamedElashri/siyuan-patch/releases/latest/download/siyuan-v3.8.11-ios.ipa) |

### Docker

Multi-architecture images are published to GHCR as `ghcr.io/leonhardthust/siyuan`:

```bash
docker pull ghcr.io/leonhardthust/siyuan:latest
```

> `v3.8.10-p1` below is a **tag-format example**; it becomes pullable only after the first build with the new workflow. Until then, pull a previously published tag or `latest`.

Image tags follow this discipline (see [PATCHES.md](PATCHES.md) for details):

| Tag | Meaning |
| --- | --- |
| `vX.Y.Z` | Upstream source tag. The legacy bare image tag is `p0`: historical only, never published or overwritten. |
| `vX.Y.Z-pN` | Canonical, immutable image tag for this repository. `N` is the repository-wide `PATCH_REVISION`. |
| `latest` | Moving convenience alias. Not a version identity; do not use it for deployment or rollback. |

`PATCH_REVISION` is a single repository-wide positive integer and is monotonic across upstream versions (it does not reset when a new upstream `vX.Y.Z` arrives). Changes to patches or build inputs must increment it; `.github/workflows/check-image-version.yml` enforces this on every PR and main push, and `release-docker` refuses to publish unless the exact commit passed that check on `main`.

> **Deployment compatibility:** the server-side `deploy-siyuan` workflow lives in a private config repository. Support for `-pN`, numeric ordering, and exact image-reference health checks was merged there first (`8f441e4`). Keep that order when migrating: config first, then the image-tag producer. Push checks validate the code; scheduled or manual runs build and deploy images separately. PC / iOS / Android release builds continue to follow upstream `vX.Y.Z`; only Docker uses the patch revision.

> Use `SHA256SUMS.txt` from the [latest release](https://github.com/MohamedElashri/siyuan-patch/releases/latest) to verify downloaded assets.

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

## Installation Guide

### Desktop Clients (macOS / Linux / Windows)
1. Navigate to the [Releases page](https://github.com/MohamedElashri/siyuan-patch/releases)
2. Download the appropriate version for your operating system

Linux releases include tar.gz, DEB, AppImage, RPM, and Arch Linux packages for x86-64 and ARM64.

### Docker Deployment
Container images are published to GHCR. Pin the full canonical tag or a digest (the `v3.8.10-p1` below is a format example, valid after the first new-workflow build):
```bash
docker pull ghcr.io/leonhardthust/siyuan:v3.8.10-p1
```
`latest` exists only as a moving alias. `deploy-siyuan` uses the full `vX.Y.Z-pN` tag and compares the running image reference as well as `/api/system/version` (which reports upstream `X.Y.Z`). See the [deployment compatibility and integration order](PATCHES.md#部署端兼容与合入顺序).

## Building from Source

### Automated Builds
- `release-cron` creates the upstream-semantics GitHub Release (`vX.Y.Z`).
- `watch-upstream` checks every 6 hours, rehearses the patch series, and triggers `release-docker` for the full image tag `vX.Y.Z-pN`.
- PC / iOS / Android builds are still triggered by `release-cron` with the upstream tag.

### Manual Build Instructions

1. Fork this repository to your GitHub account

2. Desktop Client Builds (macOS/Linux/Windows)
   - No additional configuration required
   - Proceed with the build workflow

3. Docker Image Builds
   - No Docker Hub secrets are needed: images are pushed to GHCR with the built-in `GITHUB_TOKEN`.
   - Ensure the workflow has `packages: write` permission (already configured).
   - Dispatch `release-docker` with the upstream tag or full image tag; the workflow derives `vX.Y.Z-pN` from `PATCH_REVISION`.
   - Build time depends on cache and runner; the most recent runs took about 30.6 min (amd64) and 37.7 min (arm64).

Note: To rebuild Docker content for the same upstream version, increment `PATCH_REVISION`
instead of deleting a release; a new immutable `vX.Y.Z-pN` tag is produced. Deleting a
GitHub Release is only relevant to the upstream `vX.Y.Z` PC/mobile release flow.


## Troubleshooting

### macOS Security Warning
If you encounter the "SiYuan.app is damaged and can't be opened" error:

1. Download and run the fix script:
   ```bash
   curl -sSL https://raw.githubusercontent.com/MohamedElashri/siyuan-patch/refs/heads/main/fix_mac.sh | bash
   ```
2. Enter your password when prompted (it won’t be visible while typing).
3. Launch SiYuan.app again.

This will remove the macOS quarantine flag, allowing SiYuan to run normally.
