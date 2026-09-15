# 知幕 Zhimu Player 1.2.0-rc.1 · 拟发布说明

**状态：候选版，尚非正式发布。** 当前真实 ChatGPT、DeepSeek 与听悟云端任务尚未完成本版验收。此文说明拟交付内容和验收边界，不代表安装包已上传 GitHub。

## 本次变化

- 项目从 AI Video Player 更名为「知幕 Zhimu Player」，定位为本地 AI 视频阅读工作台；源码根目录统一为 `zhimu-player`。
- 程序显示名、首次引导、设置、关于页、安装包和中英文文档使用新名称，延续原有暖黑与陶土色设计。
- 作者微信换为用户提供的 OJY 图片，原文件字节不变，保留昵称、头像和二维码；通过展示卡片的暖色边框统一观感。许可和作者署名仍为「欧俊言律师」。
- 继续采用一个程序：默认 ChatGPT 网页，Plus 档为 GPT-6 Astra / 极高，Pro 档为 Astra Pro；DeepSeek API 在同一设置中选择，通过 `/models` 自动获取模型，保留刷新、缓存提示和手动输入。
- 界面语言、导读输出语言与听悟语音语言继续独立保存，切换界面不翻译或改写用户内容。
- 保留内部 `com.videoplayer.app` 应用标识、`video-player` 用户数据目录、现有 localStorage 协议键与 `ai-video-player-guide:` 导读标记，以延续旧版设置、播放状态和数据格式。
- 许可仍为 1.0 版，仅更新项目显示名称；保留「欧俊言律师」署名及原有权利边界。普通工作免费使用继续允许，售卖、对外收费部署及对外商业集成仍须作者另行书面许可。

## 拟交付文件

| 文件 | 用途 |
|---|---|
| `Zhimu-Player-1.2.0-rc.1-Setup-x64.exe` | 当前 Windows 用户安装程序 |
| `Zhimu-Player-1.2.0-rc.1-Portable-x64.exe` | Windows x64 便携程序 |
| `Zhimu-Player-1.2.0-rc.1-Source.zip` | 白名单导出的清洁源码包 |

交付时附实际文件的 SHA-256。便携程序的登录态仍保存在当前用户的数据目录，复制 EXE 不会迁移账号。

## 验收记录

| 项目 | 本版状态 |
|---|---|
| 环境检查、类型检查、离线测试、应用构建 | 通过；11 个测试文件；本次 npm audit 为 0 |
| 安装包、便携包及源码内容检查 | 两种 EXE 已构建；ASAR 123 文件，9 个构建文件逐字节匹配，许可一致；公开源码按白名单导出并附校验 |
| 中英文界面、新名称显示、旧数据兼容 | 新用户和旧配置夹具均通过包内真实程序检查；语言、播放位置/倍速与旧导读保留，界面无控制台错误；账号和模型结果为模拟 |
| 联系作者图片 | 与提供原图逐字节一致，昵称 OJY 保留；微信实扫未验收，本地通用 QR 解码器未读出该样式 |
| 真实 ChatGPT / DeepSeek 导读生成 | 尚未验收 |
| 真实听悟登录、上传与 SRT 回收 | 尚未验收 |
| 新机器安装、长视频及不同套餐覆盖 | 待逐项实测，不沿用旧版结论 |

按 [发布验收清单](./RELEASE-CHECKLIST.md) 记录实际证据。当前构建未签名；离线测试、界面检查、真实云端任务和新机器安装是不同的验收项目。原 AI Video Player 名称下的 `VALIDATION-*.md` 是历史记录，不代表本版已通过同样检查。

---

# Zhimu Player 1.2.0-rc.1 · Release candidate notes

**Status: release candidate, not a stable release.** Real ChatGPT, DeepSeek and Tingwu cloud tasks have not yet been verified for this version. These notes describe the intended artifacts and verification scope; they do not indicate a GitHub publication.

## Changes

- AI Video Player is now **Zhimu Player · 知幕**, a local workspace for video reading with AI. The source project folder is named `zhimu-player`.
- Application branding, onboarding, Settings, About, package names and Chinese/English documentation use the new name, retaining the warm charcoal and terracotta design.
- The WeChat contact image now uses the supplied OJY original without changing its bytes, nickname, avatar or QR code. A warm card border matches the interface. Legal attribution remains **欧俊言律师**.
- One application continues to provide ChatGPT web by default: **Plus → GPT-6 Astra / Extra high**, **Pro → Astra Pro**. DeepSeek API remains an option in Settings with dynamic `/models` discovery, refresh, clearly marked cached results and manual entry.
- Interface, guide output and Tingwu speech languages remain independent. Interface changes do not translate or modify user content.
- The internal `com.videoplayer.app` application ID, `video-player` user-data folder, existing localStorage keys and `ai-video-player-guide:` markers remain compatible with earlier settings, playback state and data formats.
- License 1.0 changes only its project display name. Attribution to **欧俊言律师** and all existing terms remain. Free ordinary work use is allowed; sales, paid deployment for others and outward commercial integration still require separate written permission from the author.

## Planned artifacts

| File | Purpose |
|---|---|
| `Zhimu-Player-1.2.0-rc.1-Setup-x64.exe` | Installer for the current Windows user |
| `Zhimu-Player-1.2.0-rc.1-Portable-x64.exe` | Windows x64 portable application |
| `Zhimu-Player-1.2.0-rc.1-Source.zip` | Clean source archive exported from the public allowlist |

The delivered files will have SHA-256 checksums. Portable sign-in sessions remain in the current user's data folder; copying the EXE does not transfer accounts.

## Verification record

| Item | Status for this version |
|---|---|
| Environment checks, type checking, offline tests and application build | Passed; 11 test files; npm audit reported zero vulnerabilities for this run |
| Installer, portable package and source archive inspection | Both EXEs built; 123 ASAR files, 9 build files matched byte for byte and licenses matched; source exported through the allowlist with checksums |
| Chinese/English UI, new branding and earlier data compatibility | Fresh and legacy fixtures passed using the actual packaged app; language, playback position/rate and existing guides preserved; no console errors; accounts and model results simulated |
| Contact image | Matches the supplied original byte for byte and retains OJY; an actual WeChat scan is unverified, and the local generic QR decoder could not decode this style |
| Real ChatGPT / DeepSeek guide generation | Not yet verified |
| Real Tingwu sign-in, upload and SRT retrieval | Not yet verified |
| New-machine installation, long videos and account-tier coverage | Requires individual live checks; earlier results do not carry forward |

Follow the [release checklist](./RELEASE-CHECKLIST.md) and record actual evidence. Current builds are unsigned. Offline tests, UI checks, real cloud tasks and new-machine installation are separate forms of verification. The `VALIDATION-*.md` reports under the old AI Video Player name remain historical evidence, not proof that this version passed the same checks.
