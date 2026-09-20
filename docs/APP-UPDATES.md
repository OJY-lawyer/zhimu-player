# 应用更新 / App updates

## 简体中文

安装版在“关于 → 应用更新”提供 **检查更新 → 下载更新 → 重启更新**。打开播放器或关于页不会自动检查、下载或安装；下载完成后正常退出也不会擅自安装。只有点击“重启更新”，并完成原有字幕、导读和播放状态的保存与关闭流程后，才启动安装程序并重新打开播放器。保存失败或取消关闭时，更新保留，播放器继续运行。

更新使用现有安装目录，保留内部应用标识与 `video-player` 用户数据目录，不要求卸载旧版。原有设置、登录态、播放状态和本地媒体文件不因更新而重置。便携版不走安装版更新流程，应下载新版便携程序替换使用。

更新通过 `electron-updater` 的 NSIS 差异下载：能够复用本机旧安装包缓存时，优先下载变化的数据块，重建并校验新安装包。旧缓存、旧版本 blockmap 或服务器范围请求不可用时，会回退下载完整安装包。**不是每次更新都会得到一个固定大小的小补丁**，也不改变安装程序本身的正常覆盖安装流程。播放器不自行删除更新器仍可能复用的缓存。

正式版仅查找正式更新。候选版先查找更新的正式版；没有正式升级时，再检查当前预览渠道，因此可以从 `rc` 升到新的 `rc`，或在正式版可用时升到正式版。程序不允许自动降级。

公开更新来源固定为 `OJY-lawyer/zhimu-player` 的 GitHub Releases。**配置完成不表示仓库或版本已发布**；尚未发布时会提示更新不可用。检查更新和下载安装包使用独立的更新网络会话，不携带 ChatGPT、听悟或 API 的登录凭据，不发送字幕、视频和导读内容。

### 维护者发布要求

- 构建命令保留 `--publish never`，只在本机构建，不上传文件。
- 获得发布授权后，将同次构建的 **Setup EXE、对应 `.exe.blockmap` 和渠道 YAML** 一起作为该版本的 Release 附件。本次 GitHub 配置实际生成 `latest.yml`，其中版本号为 `1.2.0-rc.10`；候选版读取不到 `rc.yml` 时，更新器会读取同一候选 Release 的 `latest.yml`。不要自行改名，也不要漏传。便携 EXE 和源码 ZIP 可以同时附上，但不替代更新所需文件。
- 版本号、GitHub 标签与附件保持一致，标签使用 `v<版本号>`；候选版标记为 prerelease。不要复用旧版本号，也不要手工改写 YAML 中的文件名和校验值。
- 保留已经发布的旧 Setup 和 blockmap，供旧版用户差异更新使用。公开元数据与 SHA-512 校验用于完整性检查；当前候选版尚未配置 Windows 代码签名。
- 每次发布需验证真实旧安装版升级、同目录安装、保存失败取消和新版本重启。离线状态测试与本机微型范围下载测试已覆盖相关机制，不能代替一次真实 GitHub 版本升级验收。

## English

In the installed edition, open **About → App updates**, then choose **Check for updates → Download update → Restart to update**. Opening the app or About does not automatically check, download or install anything. Quitting normally after a download also does not install it. Installation starts only after you request a restart and the normal save-and-close flow has finished. If saving fails or closing is cancelled, the player stays open and keeps the downloaded update.

Updates use the existing installation folder and retain the stable application identity, `video-player` user data, settings, sign-ins and playback state. Do not uninstall first. The portable edition is updated by downloading and replacing its executable, not through the installed edition's updater.

NSIS differential downloads reuse available cached installer data and download changed blocks. The reconstructed installer is verified. When the old cache, blockmap or server range support is unavailable, downloading falls back to the complete installer. Updates are therefore **not guaranteed to be small patches**. The normal in-place installer still applies the update.

Stable builds check stable releases. Release candidates prefer a newer stable version, then check their current preview channel. Automatic downgrades are disabled. The fixed public update source is GitHub Releases for `OJY-lawyer/zhimu-player`; configuration alone does not mean a repository or release has been published. Update requests use a separate network session and do not send provider credentials, subtitles, media or guide content.

For authorized releases, upload the matching **Setup EXE, `.exe.blockmap` and channel YAML** from the same build. This GitHub configuration produces `latest.yml` with version `1.2.0-rc.10`; when `rc.yml` is absent, the preview updater reads `latest.yml` from the same candidate release. Do not rename or omit it. Keep version numbers and `v<version>` tags consistent, mark candidates as prereleases, and retain older published installers and blockmaps. Do not edit checksums or reuse a version number. Portable executables and source archives do not replace these update assets. Build scripts remain `--publish never`.

The current candidate is unsigned. Offline fixtures cover state transitions, save/close gating, the real differential range/copy algorithm and checksum rejection. A real upgrade between published GitHub releases, including installation and restart, remains a separate release check.

## Implementation references

- [electron-builder: auto-update workflow and supported targets](https://www.electron.build/docs/features/auto-update/)
- [electron-updater 6.8.9 on npm](https://www.npmjs.com/package/electron-updater/v/6.8.9)
- [electron-builder: NSIS installer options](https://www.electron.build/nsis/)

This implementation uses the pinned `electron-updater` 6.8.9 API. Documentation for newer major versions may use different installation options.
