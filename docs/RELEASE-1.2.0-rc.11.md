# 知幕 Zhimu Player 1.2.0-rc.11

这是供用户试用的界面优化候选版，并非稳定版。发布日期：2026-10-22。
[下载 v1.2.0-rc.11](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.11)。

## 本次改进

- 导读增加“正文／思维导图”切换。由已有 Markdown 的标题、段落及列表直接生成层级导图，支持逐支展开、折叠及全部展开、折叠，不额外调用模型。
- 导图节点和时间戳沿用导读保存的 Part 文件映射，重排播放列表后仍定位原视频；无法可靠对应的旧导读时间戳保持停用。
- 小窗口下的视频字幕随播放控件高度上移，保持与进度条之间的间距；长句使用播放区域的合理宽度。
- 播放列表、字幕、导读三个侧栏标签保持单行，紧凑布局下为正文留出空间。
- 侧栏支持左右方向键、Home 和 End 切换；操作按钮、选择框和弹窗时，不再误触视频快捷键。
- 控件有键盘焦点时保持可见；焦点停留在按钮或标签时，Esc 仍可退出全屏。
- 提高暖色深色界面中的辅助文字可读性，收紧导读空白，保留原有配色与正文。
- 设置页更清楚地区分检查中、已确认和暂时无法确认的连接状态；听悟“检查连接”改为独立按钮。
- 900×600 小窗口初次打开设置时，模型与推理档位完整显示；中英文引导、Cookie 粘贴及关于页沿用同一风格。
- 清洁源码包的文件清单记录公开路径和字节数，保留白名单与隐私规则检查，简化源码交付。
- 更新 Vite 至 7.3.7，并更新 brace-expansion、http-cache-semantics、source-map-js 和 fast-uri 的兼容补丁；标准依赖审计中的高危与严重项归零。

## 数据与更新

继续使用同一安装包，在设置中选择 ChatGPT 网页或 DeepSeek API。模型、推理档位、账号资料及媒体文件的保存规则保持不变。
内部应用标识仍为 `com.videoplayer.app`，用户数据目录仍为 `video-player`；本次不引入数据迁移。

已安装的用户请先关闭播放器，再运行本版 Setup 安装到原目录，无需先卸载。安装版保留差分更新所需附件，更新器仍可在需要时回退完整下载。
本版未在真实用户安装目录执行覆盖升级，也未实测从 GitHub 下载的跨版本增量更新。便携版可免安装运行，但不是账号迁移工具。

## 验证范围

| 项目 | 本轮结果 |
|---|---|
| 类型与应用构建 | 类型检查和应用构建通过 |
| 离线行为检查 | 本轮累计运行 22 个精选离线测试文件，均通过；包括新增导图层级、空内容、时间戳、Part 映射与中英文控件检查，未运行完整套件中的增量下载及部分 API、转写检查 |
| 依赖安全审计 | `npm audit --audit-level=high` 通过：严重 0、高危 0、中危 8；未降低审计门槛 |
| 真实 Electron 界面与交互 | 隔离合成媒体环境下 24 项检查通过，留存 19 张截图；覆盖中英文及 1440×900、900×600 窗口 |
| 字幕与播放 | 检查字幕跳转、进度条跳转、字幕空档高亮、音量条可见性及滚轮调音量 |
| 键盘与弹窗 | 检查侧栏方向键与空格行为、设置中的快捷键隔离及 Esc 退出全屏 |
| 设置与连接状态 | 检查模型与推理档位的可见性、Cookie 粘贴入口、听悟检查按钮及合成连接结果 |
| 思维导图 | 检查全部及单支展开折叠、节点实际跳至第 10 秒、键盘操作不误跳视频、中文／English 控件、编辑时返回正文及 900×600 下无横向溢出 |
| 发行包 | 安装版和便携版构建通过；归档版本及 9 个构建文件与当前源码构建一致，4 份许可声明完整，禁止的私有文件零命中；更新元数据的版本、安装包文件名和字节数对应本版 |
| 发行包隔离启动 | 首次使用和旧配置两种夹具通过；从发行归档主入口运行真实 Electron，保留夹具设置与导读，完成三种合成 Cookie 导入入口，无真实云端调用、无控制台错误 |
| 公开源码 | 白名单及隐私规则扫描通过，规则零命中 |

上述账号与服务结果均为合成夹具，本轮没有用真实账号重新验证 ChatGPT 登录、生成导读或听悟转写。
真实用户安装覆盖、其他机器和真实增量升级也未在本轮重验。rc.10 的历史账号及安装验收记录见
[rc.10 版本说明](./RELEASE-1.2.0-rc.10.md)，不能计入本版通过项。

剩余中危项来自开发期打包依赖链中的 `sprintf-js` 精度参数拒绝服务公告及其传播项
（`roarr`、`global-agent`、`@electron/get`、`app-builder-lib`、`dmg-builder`、`electron-builder-squirrel-windows`、`electron-builder`）。
本轮未执行审计建议的打包器降级，也未用强制修复覆盖锁定版本；该遗留项仍需后续跟进。

当前构建未签名，Windows 可能显示发布者未知。请从本项目 GitHub Release 获取文件；反馈问题时提供版本、操作步骤和错误文字，不上传 Cookie、API Key 或私人媒体。

## English

This is a release candidate, not a stable release. Released on October 22, 2026.
[Download v1.2.0-rc.11](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.11).

This update keeps captions above visible playback controls, prevents narrow sidebar tabs from wrapping, improves keyboard focus and Escape behavior,
and makes connection states and Tingwu's connection check easier to find. Model and reasoning controls remain visible in a 900×600 settings window.
Guides can switch between text and a collapsible mind map generated locally from existing Markdown. Nodes retain the guide's saved video mapping and timestamp navigation.
The warm dark design, model choices, account storage and media formats remain unchanged. The clean source manifest records public paths and file sizes.

Type checking, the application build and public-file scanning passed. Twenty-four interaction checks passed in an isolated real Electron environment,
with nineteen screenshots covering Chinese, English and wide/narrow windows. Mind-map checks include branch controls, actual media seeking, keyboard isolation and narrow-window layout. Account and cloud results were synthetic fixtures.
Twenty-two selected offline test files passed, including the new mind-map parser and navigation checks. Vite and compatible transitive patches were updated; the standard audit passed with no high or critical findings.
Eight moderate findings remain in the development-time packaging chain, originating from the sprintf-js advisory and its dependent packages.
Installer and portable builds passed. The packaged version, nine built files and four license/notice files matched their current contents; private-file checks were clear.
Fresh and legacy-configuration fixtures using the packaged entry passed in isolated Electron profiles, with no real cloud calls or console errors.
Real ChatGPT login, guide generation, Tingwu transcription, installation over a real user profile, other machines and differential updates were not re-tested in this release.
The historical rc.10 results are retained separately. Close the player before installing into its existing directory; the portable program does not transfer accounts.
This build is unsigned.
