# 知幕 Zhimu Player 1.2.0-rc.7

候选版，GitHub 发布保持暂停。

## ChatGPT 人工登录

“打开登录窗口”现在用普通 Edge 打开播放器原有的专用资料目录。登录期间不开调试端口、不连接 CDP，也不读取网页或自动检测账号。窗口启动后播放器立即恢复可操作，明确区分“已请求打开”和“已认证”。

请在该窗口中手动完成 ChatGPT / Google 登录，关闭这个专用窗口，再回播放器点“检查连接”。之后导读生成才使用后台自动连接。人工登录窗口由用户自己关闭，退出播放器不会强杀它；账号文件不因这种切换被复制、删除或重置。

现版仍使用独立浏览器资料，不能直接复用日常 Edge 已登录的窗口。没有复制日常浏览器的配置或 Cookie，也没有自动填写 Google 账号。Google 明确可能限制软件自动控制或嵌入式浏览器登录；正常人工登录是否被具体账号接受仍需用户确认。见 [Google 官方说明](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=zh-Hans)。

如果仍开着旧版播放器的受控 Edge，请先关闭那个专用窗口再重新打开登录；日常 Edge 不必关闭。登录完成后关闭专用窗口，可让后续“检查连接”启动同一资料目录的后台连接。

## 听悟登录

保留 rc.6 的两个修复：登录请求头采用本进程与专用窗口一致的 ASCII 浏览器标识；阿里云盘 OAuth 使用真正的独立弹窗、共享原听悟会话并保留 opener 回传。真实站点已显示“登录与授权”及扫码页面；隔离 Electron 用例覆盖回传、窗口关闭、导航限制和 Cookie 保留。

## 验证边界

14 个离线测试文件覆盖人工登录参数、进程启动交接、错误反馈、账号资料保留、退出不杀人工窗口、中英文状态，以及已有的服务、更新和媒体回归。真实 Google 认证和完整云端 ASR / 导读生成不由这些测试代替。

## English

ChatGPT sign-in now opens a regular Edge window using the player's existing dedicated profile. No debugging connection or page automation runs during sign-in. Finish signing in manually, close that dedicated window, then select **Check connection** in the player. Background guide generation continues to use the same retained profile after authentication is checked.

The player cannot currently attach to an already signed-in everyday Edge window. It does not copy that profile or its cookies. Whether Google accepts a particular account's manual sign-in still requires user verification.

This candidate also includes the Tingwu ASCII user-agent and Aliyun Drive OAuth popup fixes. GitHub publication remains paused; no real credentials or authorization were submitted by the verification scripts.
