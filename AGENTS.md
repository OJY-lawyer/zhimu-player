# 知幕 Zhimu Player 部署与协作契约

这是一个 Windows 本地播放器项目。先读 README.md、使用说明.md 和
docs/AGENT-DEPLOYMENT.md，再执行用户授权的部署或修改。

- 当前发行版本为 `1.2.0-rc.10` 候选版，下载入口为 GitHub 的 `v1.2.0-rc.10` Release，并非稳定版。
  中文名「知幕」、英文名 `Zhimu Player`，项目目录名 `zhimu-player`。
  本版通过 25 个离线测试文件、19 项真实 Electron 播放和 15 项真实 Edge 合成 Cookie 检查，
  类型检查、构建及本机安装升级通过，4 份设置、播放与登录数据文件保持不变。
  实际账号的 Sol 中档短合成文本导读已完整生成并取回；Pro 仅验证选择，长字幕、附件、
  其他档位生成、听悟新任务、异机与 GitHub 增量更新未验收。具体范围见 rc.10 版本说明。
- 更名保留内部 `com.videoplayer.app` 应用标识、`video-player` 用户数据目录、现有
  localStorage 协议键及 `ai-video-player-guide:` 导读标记；不要批量替换内部存储标识。
  升级不得重置已有播放状态、设置或登录态。原名时期的验证记录保留历史原文。
- 单一安装包，通过设置选择 ChatGPT 网页或 DeepSeek API；不得按来源分叉代码。
- 默认 ChatGPT 网页，安装与使用无需 Codex。网页模型和推理档位由用户分别选择，
  不再通过 Plus/Pro 套餐锁死。候选预设不等于账号可用项；可刷新网页菜单，生成前
  必须核对实际选项，不可用时明确失败，不自动改选、降低档位或切换来源。
- ChatGPT 网页、Codex 订阅和 API 是不同接入渠道，不承诺其额度可互换。
- 账号、密码、验证码、Cookie 与 API Key 由用户在登录窗口或设置中完成。
  不索取或回显秘密，不复制用户日常浏览器配置，不从其他项目借用登录态。
  用户可在应用内明确选择 Cookie-Editor JSON 文件、剪贴板或粘贴文本导入，仅接收 chatgpt.com
  及其子域 Cookie；输入最多 2 MiB / 2000 条，跳过无关、过期与不合法条目。
  正常专用 Edge 人工登录入口保留。导入后检查实际认证；403/网页验证必须显示具体原因，
  不反复重试、不清除登录资料。粘贴文本只临时存在，提交、关闭或切换来源时清空。
- 登录状态区分 authenticated、signed-out、unknown。网络异常、超时、人机验证或
  页面尚未就绪属于未知状态，不得因此清除会话或宣称账号已退出。
- 听悟使用内置登录与转写流程，不依赖开发者电脑上的 Python、Skill 或固定云目录 ID。
- 界面支持简体中文 / English；导读输出支持 zh-CN / en / source，听悟语音支持 cn / en。
  三者分别保存，互不联动。已有配置缺少听悟语言时保持 cn；不要因切换界面改写字幕、
  导读、文件名或用户内容。公开入口包含 README.en.md 与英文许可参考译本。
- 先复用合适的已有 Node.js；依赖安装仅影响当前项目。不要自动改系统服务、全局环境
  或安装 FFmpeg、Python、模型。安装包用户不需要开发环境。
- 保留视频、原字幕和已有用户修改。新字幕修订和导读按产品规则保存到视频目录。
- 首次 npm ci 后运行 npm run setup:runtime，准备项目内 Electron；doctor 只检查不下载。
- 运行 npm run doctor、npm run typecheck、npm test 和 npm run build:app。
  UI、真实登录和真实模型/转写验收单独记录，离线测试通过不能代替真实服务可用。
- 播放交互用 npm run test:playback；--slow-media 模拟未读完的媒体，必须核对实际
  currentTime、seeked 和可解码状态，不能只检查组件状态或进度条显示。保留三侧栏高度约束。
- GitHub 交付先执行 npm run public:check 和 npm run public:export。仅使用导出文件。
  不递归上传原开发目录，不上传 work、state、data、用户配置或历史交接文件。
- 未获明确授权不得创建仓库、提交、推送、发布安装包或执行云端删除操作。
- 修改和分发须遵守 LICENSE，保留 NOTICE 中的“欧俊言律师”署名；第三方许可证独立保留。
- 知幕为原 AI Video Player 的延续；许可 1.0 仅更新项目显示名称，原有授权和限制不变。
- docs/LICENSE.en.md 仅为参考译本，中文 LICENSE 是有效主文本。不得通过翻译扩大授权。
- 允许个人、律师及公司员工的日常工作免费使用、自行或由自用 agent 辅助部署；
  对外收费部署、售卖、将软件功能作为收费服务或商业集成须作者另行书面许可。
  正常工作视频处理不属于被禁止的商业再利用，赞助也不授予商业许可。
