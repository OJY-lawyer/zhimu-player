# 知幕 Zhimu Player 1.2.0-rc.9

**本地候选版，尚未发布到 GitHub Releases；不是稳定版。** 当前公开下载仍为
[v1.2.0-rc.8](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.8)。
本文记录 rc.9 的改动及 2026-09-20 取得的本机验收证据。

## 播放与音量

- 修复视频尚未读完时，点击字幕、点击或拖动进度条无法跳转的问题。媒体协议现在
  明确返回字节范围、长度与状态，支持精确的分段读取和取消旧的读取流。
- 音量条按实际视频区域宽度适配，不再因为整个窗口较窄而隐藏；横屏、竖屏都保留。
- 在视频、音量按钮或音量条上滚轮可调节音量，并阻止该次页面滚动。静音时从保留的
  音量继续调整并恢复声音，限制在 0–100%。
- 切换 Part 时同步新视频的时间和播放状态，避免暂时显示上一段时间和字幕。
- 保留 rc.8 的侧栏高度约束、内部滚动、原媒体文件及现有数据标识。

## ChatGPT 网页连接与选择

网页版不需要 Codex。普通专用 Edge 人工登录继续保留；登录后关闭该窗口，再检查连接。
已有日常浏览器登录的用户也可主动选择 Cookie-Editor JSON 文件或剪贴板导入，随后检查。
这不复制整个日常浏览器配置，也不从其他项目借用登录态。

Cookie 导入最多接受 2 MiB、2000 条，只接收 chatgpt.com 及其子域；格式不合法、过期、
无关或不支持的分区条目会被跳过或拒绝。导入针对相关条目，中途失败会尝试恢复原条目，
恢复失败会明确报告。导入完成不代表真实账号认证成功。详见[登录说明](./LOGIN-AND-TROUBLESHOOTING.md)。

网页模型和推理档位分别由用户选择，不再通过 Plus/Pro 锁死。内置预设仅供选择，
实际选项以账号网页为准；刷新菜单保留原选择，每次生成前仍须核对，不自动降级。
旧套餐设置保留为迁移提示，需用户确认新的具体选择。

连接结果区分已登录、未登录和未知。网络异常、超时、人机验证或未加载完成属于未知，
不直接当作掉线，不清除会话，并保留上次已确认记录；未知状态也不等于已获准生成。

## 已完成的分项验证

以下是本轮模块修改的分项验证，不是最终 rc.9 安装包的整体验收。

- 真实 Electron 隔离环境完成 **15 项播放交互检查**。使用 30 秒无音轨合成媒体，
  覆盖字幕跳转、进度条点击/拖动、播放中跳转、Part 切换、横竖屏和窄区域音量条、
  三处滚轮操作及 0–100% 边界。
- 限速本地读取时，旧版可跳转范围被判为 0；修复后字幕 15 秒、进度点击约 18 秒、
  拖拽约 25.8 秒均实际完成 `seeked` 并恢复解码就绪。验证包含真实媒体时间，
  不仅是进度条或组件状态。
- 媒体协议离线回归覆盖完整/部分读取、字节精确性、HEAD、后缀与开放范围、无效范围、
  安全错误和取消流。
- Cookie 解析、认证三态、模型设置等离线模块检查通过。它们使用合成数据，不能证明
  某个真实 Cookie 导出、账号、网页菜单或模型生成已经可用。

播放测试未读取个人媒体或账号，未调用云服务。一次性隔离数据在正常退出后按任务
归集并记录原路径；可复用脚本和必要证据保留。

## 集成与安装验收

- 完整类型检查、**21 组离线测试**、生产构建通过；独立审查发现的模型显示名与服务
  标识分隔符差异已修复，并补充回归检查。
- 发行包内的首次启动、旧版升级夹具通过。实际 Electron 界面验证了中英文切换、
  自选模型/档位保存、文件/剪贴板导入按钮和重新打开设置后的登录记录显示。
- 安装包 ASAR 与当前构建一致；没有包含 work、outputs、用户配置、Cookie 或凭据文件。
  公开源码白名单检查为 132 个文件、零风险命中。
- 本机覆盖安装到原目录成功。安装前后配置、播放状态、ChatGPT Cookie 数据库及听悟
  Cookie 数据库的 SHA-256 均相同；桌面快捷方式仍指向原安装目录。

以下仍未完成本版真实云端验收：ChatGPT 登录、Cookie 导入后的认证、账号网页模型/
推理菜单及导读生成；DeepSeek 和听悟任务；GitHub 跨版本更新及其他机器。网页适配
暂不遍历“More models”子菜单；无法明确关联的菜单不会猜选。回复模型标识会核对，
若服务未返回推理档位，则不能据此证明回复的实际推理强度。

已构建 `Zhimu-Player-1.2.0-rc.9-Setup-x64.exe` 和
`Zhimu-Player-1.2.0-rc.9-Portable-x64.exe`，清洁源码导出名为
`Zhimu-Player-1.2.0-rc.9-Source.zip`。它们仍为本地候选，未发布到 GitHub。
许可证、作者署名和既有截图来源均未改变。

## English

**rc.9 is a local candidate and has not been published to GitHub Releases.** The public download
remains [rc.8](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.8).

It fixes subtitle/progress seeking before media has fully loaded, keeps the volume slider in narrow
player areas, handles the wheel over the video and volume controls, and synchronizes time when
switching Parts. Existing media, data identifiers and sidebar height constraints are preserved.

ChatGPT web needs no Codex. Regular dedicated Edge sign-in remains available, with an optional
explicit Cookie-Editor file/clipboard import. Imports are limited to 2 MiB and 2,000 entries for
chatgpt.com and its subdomains, with validation and expiry filtering. Importing is not proof of
authentication, and the app does not copy the everyday browser profile.

Users choose website models and reasoning levels separately instead of a fixed Plus/Pro mapping.
Presets are candidates; website options are checked before generation, without silent fallback.
Network failures and inconclusive checks remain **unknown**, preserving the last confirmed record
instead of declaring the account signed out or clearing the session.

**15 real Electron playback checks and 21 offline test suites** passed, along with type checking,
production builds, packaged bilingual fresh/upgrade fixtures and archive inspection. A local in-place
installation retained settings, playback state and both account cookie databases byte-for-byte.
Real provider/account workflows and GitHub differential upgrades remain unverified. Ambiguous
website menus and “More models” submenus are not guessed. This note does not announce a publication.
