# 知幕 Zhimu Player 1.2.0-rc.8

面向首批使用者的预发行候选版，标签为 `v1.2.0-rc.8`，并非稳定版。

[项目仓库](https://github.com/OJY-lawyer/zhimu-player) · [本版下载页](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.8) · [全部版本](https://github.com/OJY-lawyer/zhimu-player/releases)

知幕面向长直播、课程和多 Part 录像，把本地播放、SRT 字幕、跨视频搜索和带时间戳的 AI 导读放在同一个窗口。一个程序包含 ChatGPT 网页与 DeepSeek API 两种导读来源，字幕转写可选通义听悟；已有字幕时可以直接使用。

## 下载与开始使用

在下载页的 Assets 中选择附件，以页面实际文件为准：

- `Zhimu-Player-1.2.0-rc.8-Setup-x64.exe`：Windows x64 安装版，可选择语言和安装目录。已有安装版关闭后装到原目录，无需先卸载。
- `Zhimu-Player-1.2.0-rc.8-Portable-x64.exe`：免安装试用；用户数据仍属于当前 Windows 用户，不随 EXE 迁移。
- `Zhimu-Player-1.2.0-rc.8-Source.zip`：清洁源码，附文件清单及 SHA-256 校验，可自行构建或交给自用 agent 部署。
- `Zhimu-Player-1.2.0-rc.8-Setup-x64.exe.blockmap` 与 `latest.yml`：安装版更新器所需附件，普通用户不必手动打开。

首次打开可切换中文 / English，按引导选择导读来源并自行完成账号登录；也可跳过云端设置，先播放本地视频。安装包自带运行环境，不要求 Node.js、Python 或 Codex；ChatGPT 网页路线需要 Microsoft Edge。当前构建未签名，Windows 可能提示发布者未知。

## 侧栏与播放区域

修复固定侧栏后切换到长字幕、长导读时，视频区域被内容撑高、播放控件落到窗口外的问题。播放区与侧栏共用一个受窗口高度约束的网格行，侧栏可以收缩，长内容在面板内部滚动。切换播放列表、字幕和导读不再改变视频区域高度。

保留现有侧栏拖动、浮动与固定方式、视频等比显示和控件自动隐藏。修复不涉及导读来源、账号资料或媒体文件。

新增 `npm run test:layout`，使用隔离的应用数据、合成媒体、长播放列表、字幕及导读，在真实 Electron 窗口中检查切换标签、缩放窗口、拖动侧栏、界面语言和导读编辑。这些布局检查不代替账号登录或云端生成验收。

继承 rc.7 的普通 Edge 人工登录和听悟登录弹窗修复。网页会话与 Codex 授权仍是不同接入渠道，本版没有新增跨项目登录共享入口。

## 本轮验证

- rc.8 发行包在真实 Electron 中完成 68 个布局场景：两种窗口大小、中英文、固定与浮动、窄与宽侧栏、三个标签、导读编辑，以及真实横竖尺寸的静音合成视频，均无布局错误。
- 14 组离线测试、类型检查、构建、安装包内容与旧配置恢复检查通过；本次依赖审计报告 0 个漏洞。
- 已执行同目录安装升级；安装后程序与构建包一致，升级前后的配置文件及 ChatGPT、听悟 Cookie 文件哈希一致。该结果只证明本次本机文件保留，不代表服务端会话永不过期。

布局测试隔离于真实用户数据。**真实 ChatGPT、DeepSeek、听悟账号认证和云端生成，以及通过 GitHub 进行跨版本增量下载，仍未完成本版验收。** 本机升级时文件保留，不代表服务端登录态一直有效，也不等于跨机器升级已验证。

## 许可与反馈

作者为**欧俊言律师**。本项目采用[自定义免费使用、禁止商业再分发与署名许可 1.0](../LICENSE)，属于源码可用软件，并非 OSI 认可的开源软件。允许个人、律师及公司员工日常工作免费使用和自用部署；售卖、对外收费部署、将功能作为收费服务或对外商业集成须作者另行书面许可。分发须保留许可、作者署名并注明修改；赞助不授予商业许可，第三方组件原许可独立保留。

问题请提交到 [Issues](https://github.com/OJY-lawyer/zhimu-player/issues)，附版本、操作步骤和错误文字。请勿提交 Cookie、API Key、用户数据目录或私人媒体。

## English

**Zhimu Player 1.2.0-rc.8 is a prerelease for early users, not a stable release.** It brings local video playback, SRT subtitles, cross-video search and timestamped AI guides into one Windows application. Choose ChatGPT web or DeepSeek API; optional Tingwu transcription creates subtitles.

Get files from **Assets** on the [version download page](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.8): **Setup-x64.exe** installs for the current user and lets you choose a folder; **Portable-x64.exe** runs without installation; **Source.zip** contains clean source with a manifest and checksum. The matching **.exe.blockmap** and **latest.yml** are updater assets, not files you need to open.

For an existing installation, close the player and install into the same folder without uninstalling first. Use the first-run guide to select 中文 / English and a provider, then sign in yourself. You can skip cloud setup and play local media. No Node.js, Python or Codex installation is required; ChatGPT web needs Microsoft Edge. These builds are unsigned.

Fixes a pinned-sidebar layout bug where long subtitles or guides stretched the video area and pushed playback controls below the window. The video and sidebar now share a row constrained to the available window height, while long panel content scrolls internally.

Existing sidebar resizing, pinning, floating mode, video aspect ratio and automatic control hiding are preserved. No account, provider or media data is changed by this layout fix.

`npm run test:layout` exercises the actual Electron UI with isolated application data and synthetic long content. These layout checks do not verify real sign-in or cloud generation.

The packaged build passed **68 layout scenarios and 14 offline test suites**, along with type checks and package checks; the dependency audit reported zero known vulnerabilities. A local in-place upgrade retained the existing configuration and both browser cookie files, verified by hashes. **Real ChatGPT, DeepSeek and Tingwu authentication and cloud generation, and differential downloads between GitHub versions, remain unverified for this candidate.** Retained local files do not establish server-side session validity or upgrades on other machines.

Author: **欧俊言律师 (Ou Junyan, Attorney)**. The [custom license](../LICENSE) permits free ordinary work use and self-deployment, requires attribution, and restricts commercial redistribution, paid deployment and commercial integration. This is source-available software, not OSI-approved open source. Sponsorship grants no commercial permission; third-party licenses remain independent. See the [English reference translation](./LICENSE.en.md); the Chinese LICENSE governs.

Report issues with the version, steps and error text through [Issues](https://github.com/OJY-lawyer/zhimu-player/issues). Do not include credentials, user-data folders or private media.
