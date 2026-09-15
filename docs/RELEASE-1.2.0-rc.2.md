# 知幕 Zhimu Player 1.2.0-rc.2

候选版，GitHub 发布暂缓。本版修复 ChatGPT 专用登录窗口无法打开、提示「Edge 调试通道已经关闭」的问题。

## 修复

- 在本机复现 Edge 启动进程正常退出、后续浏览器进程接手的情况。旧版依赖启动进程的管道，导致连接提前结束。
- 使用仅绑定 `127.0.0.1` 的随机本机端口，等待本次启动生成的浏览器连接信息；严格校验端口和浏览器路径，不连接远程地址，不使用固定端口。
- 登录等待与退出以实际浏览器连接为准，不再把启动进程退出当作登录失败。连接中断立即结束待处理命令；退出播放器时关闭其专用浏览器。
- 登录窗口显式恢复到可见屏幕区域，并将登录页面置前，避免沿用后台窗口的屏幕外位置。
- 保留已有独立登录目录，不导入日常浏览器的 Cookie，不清空账号、字幕或导读。

## 验证

类型检查、12 个离线测试文件已通过。真实 Microsoft Edge 已通过独立临时配置下的启动、本机连接、本地页面导航与关闭测试。此前同一测试能稳定复现通道关闭。

实际账号登录结果和本机更新情况在本轮交付中另行记录。真实模型生成、听悟转写、其他机器安装升级不因连接测试通过而视为通过。

---

# Zhimu Player 1.2.0-rc.2

Release candidate; GitHub publication is paused. Fixes the dedicated ChatGPT sign-in window failing to open with an Edge debugging-channel error.

The browser connection now waits for a fresh loopback endpoint rather than depending on the original Edge launcher process or inherited pipes. It uses a random port on `127.0.0.1`, validates the endpoint, tracks the live connection through sign-in and shutdown, and places the sign-in window on screen. Existing player accounts and user files are preserved.

Type checking, 12 offline test files and a real Edge startup/navigation/shutdown check passed. Actual account sign-in, model generation and new-machine installation remain separate verification steps.
