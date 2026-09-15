# 知幕 Zhimu Player 1.2.0-rc.4

候选版，GitHub 发布保持暂停。

修复主窗口隐藏后，双击桌面图标无法将其重新显示的问题。此前重复启动只尝试聚焦，隐藏窗口不能通过聚焦恢复。本版在启动页面就绪时主动显示主窗口；重复启动时恢复最小化、显示并聚焦已有窗口，继续沿用单实例与保存流程。

本机已确认桌面快捷方式指向有效的已安装程序，原运行进程存在但窗口隐藏。这次隐藏状态由本机维护时的隐藏启动触发，快捷方式本身没有损坏。修复也适用于后续其他隐藏启动来源。

真实 Electron 验证通过：Windows 隐藏启动后主动显示、隐藏后由真实第二实例唤回、最小化后由真实第二实例恢复。三种场景同时检查 Electron 与 Windows 实际窗口可见性，两个第二实例均正常退出，仍只有一个主窗口。隐藏启动会让 Windows 覆盖首次显示调用，因此仅在仍隐藏时延后再显示一次，无轮询。

本版继续包含 rc.3 的专用 Edge 登录修复、增量下载与保存后更新功能。真实账号认证、模型生成与 GitHub 跨版本更新仍需分别验收。

## 来源切换与账号保留

切换 ChatGPT / DeepSeek 只保存导读来源，不退出账号。ChatGPT 登录资料、原套餐和项目配置，以及 DeepSeek 地址、模型和已加密 Key 均保留。只有主动退出专用账号或明确删除 Key 才清除对应凭据；服务方自行使登录过期属于独立情况。

实际 Electron 隔离界面连续两轮切换、保存与重新加载验证通过：上述配置、合成 ChatGPT 磁盘资料标记和听悟隔离会话中的合成 Cookie 保留，自动退出调用与云请求均为 0。该用例验证本地保留行为，没有使用真实账号证明服务端会话有效性。

## English

This candidate fixes desktop shortcut activation when the existing app window is hidden. The window is explicitly shown once ready; launching again restores a minimized window, shows it and brings it forward. The existing single-instance and save workflow is preserved.

The local shortcut was valid. A maintenance launch had hidden the running window, and focusing alone could not reveal it. GitHub publication remains paused.
