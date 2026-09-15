# 知幕 Zhimu Player 1.2.0-rc.3

候选版，GitHub 发布暂停，尚未上传仓库或发布资产。

## 本次变更

- 修正 Windows Edge 启动器退出后由另一进程接管导致的连接中断。专用浏览器改用仅限本机的动态连接，按真实连接判断存活，退出播放器时关闭专用浏览器。
- 登录窗口恢复到当前屏幕内。重试时清除旧错误，等待期间显示操作说明；已知启动和网络错误显示对应提示。
- 关于页新增中英双语更新入口：手动检查、下载、重启更新。安装版优先使用差异下载，缺少旧缓存或差异信息时回退完整包。便携版使用手动替换。
- 重启更新遵守原有保存和关闭流程；保存失败、返回播放器或强制关闭均取消本次安装。更新沿用原安装目录与用户数据目录。
- 构建产物增加安装包 blockmap 与更新渠道文件。构建仍使用 `--publish never`，不会自动上传。发布资产要求见 [应用更新](./APP-UPDATES.md)。

## 验收边界

离线用例覆盖更新状态、保存失败、差异下载与校验失败；真实 Edge 使用本机测试页面验证连接。安装版还须单独验证登录窗口，用户账号认证与真实模型生成不由上述检查代替。

2026-09-15 本机检查：类型检查、13 个离线测试文件、安装包内容检查，以及打包代码的首次运行和旧数据兼容桌面用例通过。真实安装程序已覆盖升级到自选安装目录，安装后程序内容与构建结果一致；实际安装版打开 ChatGPT 登录窗口成功，窗口位于屏幕内，登录按钮可见。应用更新接口返回本版 `1.2.0-rc.3`，识别为可更新的安装版。账号认证与模型生成尚未验收。

差异下载用例调用实际更新器：12 字节合成文件仅下载变化的 4 字节后正确重建，错误 SHA-512 被拒绝。该用例验证下载机制，不代表真实安装包总能减少至同一比例。

真实 Electron 集成用例也已通过：隔离用户目录中，经实际页面和 preload 调用更新；成功时确认保存落盘、所有窗口关闭后才调用模拟安装器；注入写入失败时，实际页面发送保存失败，窗口保持打开，更新仍保留，随后普通退出也不触发安装。用例未请求 GitHub、未执行真实安装器，界面中的模拟版本不代表已发布版本。

本次未进行 GitHub 上的跨版本下载和自动安装实测；该项需要真实发布的前后版本与完整资产。首个带更新能力的版本须手动安装一次，之后才可从应用内更新。

## English

This release candidate fixes dedicated Edge startup handoff, restores sign-in windows to the visible screen, and adds manual in-app updates for the installed edition. Changed blocks are downloaded when possible, with a full-installer fallback. Restarting to update uses the existing save-and-close workflow and preserves the installation folder and user data.

GitHub publication is paused. Local checks do not establish a successful account sign-in, model generation, or a live cross-version GitHub update. Install the first updater-enabled version manually; subsequent versions can use the in-app update flow.
