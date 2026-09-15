# 知幕 Zhimu Player 1.2.0-rc.6

候选版，GitHub 发布保持暂停。

本版集中修复听悟登录窗口的两个问题：

- 账号密码区域显示“500 / System Internal Error”：听悟专用会话的浏览器标识去除中文产品名中的非 ASCII 字符，保留实际 Chromium / Electron 版本及英文产品名。真实听悟页面已完成原标识报错、修复后表单正常的对照验证。
- 点击“阿里云盘”无反应：实际登录页会打开 `https://www.alipan.com/o/oauth/authorize`，旧版既未允许此域，也将所有新窗口拦截。本版让 Electron 创建真正的登录弹窗，保留浏览器的 opener 回传关系与同一听悟会话，允许阿里云登录流程所需地址。

原生弹窗的首次导航还会使用播放器进程的默认浏览器标识，早于单窗口覆盖设置。因此启动时也将本进程的默认标识规范化为 ASCII，保留真实浏览器版本与英文产品名。产品界面的中文名称仍为“知幕”。

登录主窗口与子窗口均使用原来的 `persist:tingwu-player` 分区。弹窗不提供播放器的本地文件接口，限制顶层导航与后续弹窗地址；关闭主登录窗、退出账号或检测到成功时一并关闭其子窗口。单独关闭云盘弹窗不清除登录资料，也不结束主登录窗口。

原 ChatGPT 登录态、DeepSeek Key、模型选择和播放状态继续保留。没有通过清空 Cookie 或替换用户会话解决问题。

## 验证边界

真实登录页面对照和弹窗打开验证不等于用户已完成认证。未代填账号、密码、验证码，也未提交转写任务。真实账号登录与完整 ASR 任务仍须分别验证。

## English

This candidate fixes two Tingwu sign-in issues: the embedded password panel rejecting a user agent containing the Chinese product name, and the Aliyun Drive OAuth popup being blocked.

The dedicated session now uses an ASCII user agent while preserving the actual browser versions. Trusted login popups open as real Electron windows, retain their opener relationship and share the existing Tingwu session. Navigation restrictions and the absence of player file APIs also apply to child windows. Closing a popup alone does not erase sign-in data.

Provider credentials, model selections and player state are retained. Opening a live sign-in page or OAuth popup does not establish successful account authentication or transcription. GitHub publication remains paused.
