# 知幕 Zhimu Player 1.2.0-rc.10

这是供用户试用的修正候选版，并非稳定版。[下载 v1.2.0-rc.10](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.10)。

## 登录与模型

- 修复 host-only、非 Secure Cookie 被浏览器按 HTTPS 地址转为 Secure 后，校验失败并回滚整批导入的问题。
- 规范过长 Cookie 有效期，保留各条目的作用域、会话属性及失败恢复能力。
- 导入支持文件、剪贴板和粘贴 JSON；粘贴内容提交、关闭或切换来源时清空，不写入配置。
- 网页返回 403 时显示具体原因并停止连续检查，保留登录资料，引导用户在普通浏览器完成网页验证。
- GPT-5.6 Sol 与 GPT-6 Astra 分别保存模型家族和 Pro 档位，不再把 Astra Pro 当作无独立档位的模型。
- 适配网页的能力滑条与模型菜单，依据可读档位标签及选中项核验，不按滑条数字猜模型。
- 从菜单内部读取模型标识，避免鼠标悬停提示遮住当前模型；等待菜单真正关闭后再继续，并在调整档位前恢复滑条焦点，避免连续选择时误开关菜单或未切换档位。
- 删除面向用户的“旧设置”迁移提示；已知旧版配置在内部兼容。其他明确选择继续保留。
- 登录、导入 Cookie、检查连接放在连接区的明显按钮中，具体错误在同一区域显示。

## 导读生成

- 修复多行字幕任务未完整写入网页输入框的问题，发送前核对任务文本及实际模型、推理档位。
- 修复网页新建对话从临时标识切换到正式对话标识后，播放器无法继续跟踪并取回回答的问题。

## 字幕定位

右侧字幕列表从一条字幕开始持续高亮，直到下一条开始。暂停、字幕空档与来回跳转均保持准确位置。
最后一条在其后持续高亮；第一条开始前没有高亮。视频画面的字幕仍按原结束时间隐藏。

## 验证范围

| 项目 | 本次结果 |
|---|---|
| 离线检查与构建 | 25 个离线测试文件通过，类型检查和构建通过；实际安装另行核验如下 |
| Cookie 协议 | 真实 Edge 的 15 项合成 Cookie 检查通过，覆盖混合 Cookie、旧登录分片、属性校验和失败恢复；测试数据不含用户真实凭据 |
| 实际账号登录 | 用户完成网页安全验证后，多次重启专用浏览器，服务端登录检查均返回 200 |
| 网页菜单与选择 | 实际读取到 Sol 的 Instant、Medium、High、Extra High、Pro，以及 Astra Pro；连续切换 Sol Pro → Sol Medium → Astra Pro 三次均确认成功，未用 Pro 生成 |
| 完整短导读 | 使用 Sol Medium 发送短合成文本，完整生成并取回带 `[P1-00:00:00]` 的正文 |
| 界面 | 中英文普通与窄窗口验证了三个主要连接按钮、粘贴 JSON 入口、临时内容清空及具体错误显示 |
| 播放与字幕 | Electron 中限速合成媒体的 19 项检查通过，包括字幕空档高亮、暂停保持、下一条切换及向后跳转 |
| 安装与升级 | 发行包的首次使用与旧配置升级夹具通过，含文件、剪贴板、粘贴三种导入入口；本机已覆盖安装 rc.10，安装归档与构建一致，设置、播放记录和 ChatGPT、听悟登录文件共 4 项哈希未变，桌面快捷方式正确。跨机器仍待验收 |

短导读返回的 `model_slug` 为 `gpt-5-6-thinking`，推理档位元数据为 `null`。发送前已在实际网页核对 Medium，
但不能据此声称回答元数据也确认了 Medium。网页“最新”入口的其他档位没有明确模型家族标识时，不推断为 Astra。

本次短合成文本成功不代表长字幕或附件上传、Pro 等其他未测档位生成、听悟新云端任务、其他机器或 GitHub 跨版本增量更新已经验收。
网页仍由服务方控制，Cookie 导入不会跳过服务方验证，也不能保证会话永久有效。

## English

This is a release candidate, not a stable release. [Download v1.2.0-rc.10](https://github.com/OJY-lawyer/zhimu-player/releases/tag/v1.2.0-rc.10). It fixes mixed Cookie imports, incomplete multiline prompt entry and response
tracking when a new chat receives its permanent conversation ID. Users can import a JSON file, clipboard contents or
pasted JSON; pasted contents are cleared on submission, closure or provider changes and are never saved in settings.
The three connection actions and specific errors are directly visible. Sidebar subtitles remain highlighted through gaps
until the next cue starts; video captions retain their original display intervals.

All 25 offline test files, type checks and the build passed, alongside 15 synthetic Cookie protocol checks in real Edge,
bilingual normal/narrow UI checks and 19 throttled-media checks in Electron. After the user completed website verification,
the real account passed repeated browser restart and
authentication checks. Sol Instant/Medium/High/Extra High/Pro and Astra Pro were read from the real menu; both Pro choices
were selected and verified, including three consecutive switches from Sol Pro to Sol Medium to Astra Pro. Neither Pro
choice was used to generate a guide.

One complete guide from short synthetic text was generated and retrieved with timestamp links using Sol Medium.
The response reported `model_slug: gpt-5-6-thinking` and null effort metadata; Medium was verified in the website before
sending, not confirmed by response metadata. Long transcripts or attachments, generation with other choices, Tingwu jobs,
other machines and GitHub differential updates remain unverified. Packaged fresh/upgrade fixtures passed. An in-place rc.10 installation matched the verified build and preserved four settings, playback and account files byte-for-byte; the desktop shortcut targets the installed application. Provider verification requirements and future session expiry still apply.
