# 1.1.2 验证记录 / Validation record

2026-09-14。Windows x64；Node 22.22.2、Electron 44.3.0。

## 变更 / Changes

- DeepSeek / 兼容 API 通过 `GET /models` 获取模型名称，支持自动获取与手动刷新；生成接口移除固定模型白名单。新配置默认名称为 `deepseek-flash`，已有配置保留原模型。
- API Key 或地址编辑完成、离开输入框后获取列表；已保存 Key 的 API 设置打开时也获取。输入过程不发送未完成的 Key。界面中英文即时切换。
- 保留当前选择；最新列表缺少该模型时提示，不自动换成其他模型。高级设置仍可手动填写。
- 列表缓存仅在本次启动中保留，按规范化接口地址和 Key 隔离。暂时网络故障、429、5xx 和超时可明确显示缓存；401/403 清除缓存，旧请求不能复活或覆盖新缓存。
- Key 的发现与保存统一去除首尾空格。已保存 Key 只在同源接口复用，草稿查询不写配置；请求不跟随重定向。模型列表仅返回 ID，不返回服务方其他账号字段。
- 列表不包含模型能力或费用信息，不据此自动设置推理档位；保留已有 DeepSeek 导读请求参数。

Models are discovered dynamically. Existing selections and manual entry remain available. Lists are cached only within the current app session and isolated by endpoint and key. Authentication failures discard the matching cache. Listing models sends no subtitles and does not generate guides.

## 已验证 / Verified

- `npm run doctor`：环境和项目结构检查通过；未据此推断账号权限。
- `npm run typecheck`、`npm test`：10 个测试文件通过。新增发现测试覆盖 URL、同源密钥、缓存隔离、两种并发响应顺序、空/异常/过大列表、读取超时与退出取消，以及未来模型 ID 的真实请求构造。
- `npm run build`：NSIS 当前用户安装程序与便携版构建完成；禁用自动发布。
- 包内容检查：123 个 ASAR 文件、9 个构建文件逐字节一致，禁止的个人配置/工作目录为零；许可证资源齐全。
- 用同版本 Electron 引擎运行发行包 ASAR 中的实际程序，在隔离测试数据下检查中英文首次引导、设置、模型列表、模型消失提示、手动填写、原生密钥加密保存，以及旧响应不覆盖新账号列表。900×600 下模型控件没有水平溢出，控制台错误为零。
- 上述界面测试使用模拟模型列表。模型发现、生成和转写的自动化回归不请求真实账号，不上传用户媒体。
- 日常界面回归通过：界面语言保存/重新加载、导读语言独立、Astra Pro 目标、英文 API 提示词、导读文件保存/加载、听悟英语设置、关于页与英文赞助展示。生成回复均为本地模拟。

The model-discovery UI was exercised against the actual packaged application with local simulated API results. Offline tests and packaged UI checks are separate from real service verification.

## 未验证 / Not verified

本版未完成真实 DeepSeek Key 的在线鉴权/模型列表/付费生成、ChatGPT Plus 与 Pro 实际生成、听悟真实账号上传转写，以及全新机器上的 NSIS 安装/卸载或便携封装启动。构建和 ASAR 运行不代替这些验证。安装程序和便携版未签名。未创建或发布 GitHub 仓库。

Real provider accounts, paid generation, real transcription and clean-machine installation remain unverified. No GitHub repository was created or published.

接口依据：[DeepSeek 模型列表](https://api-docs.deepseek.com/zh-cn/api/list-models/)、[API 首页](https://api-docs.deepseek.com/zh-cn/)。
