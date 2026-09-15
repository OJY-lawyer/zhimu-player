# 知幕 Zhimu Player 1.2.0-rc.5

候选版，GitHub 发布保持暂停。

修复听悟登录页账号密码区域显示“500 / System Internal Error”的问题。Electron 默认浏览器标识包含中文产品名，阿里云登录网关拒绝此请求头。修复只在听悟专用会话中移除浏览器标识的非 ASCII 字符，保留真实 Chromium / Electron 版本和英文产品名，并在首次请求、创建登录窗口之前完成设置。

专用会话分区、Cookie、其他账号登录资料和模型设置不变；不清理或新建替代用户会话。此前的窗口激活、来源切换保留和增量更新功能继续保留。

## 验证

在隔离用户目录、未登录任何真实账号的实际 Electron 窗口中，分别用原标识和修复后标识访问真实听悟登录页面。原标识重现登录框内的请求头拒绝错误，修复后密码输入框和登录按钮正常出现，全部登录子框架未再显示该错误。上游错误页的 HTTP 状态仍可为 200，因此本次同时检查页面错误文字和表单元素，未仅凭 HTTP 状态判断成功。

离线回归覆盖设置标识的时机、实际浏览器版本保留、重复打开复用原会话，以及只有显式退出才清理登录资料。未输入账号密码，未提交登录或转写任务；账号认证与完整 ASR 任务仍属于单独验收。

## English

This candidate fixes the embedded Tingwu password sign-in panel showing “500 / System Internal Error”. The default Electron user agent included the Chinese product name, which the Aliyun login gateway rejected. Only non-ASCII characters are removed from the dedicated Tingwu session's user agent before its first request or window is created. Actual Chromium and Electron versions remain unchanged.

Existing cookies, the persistent session partition and provider settings are retained. A live comparison in an isolated Electron profile reproduced the original error and displayed the password form after the fix. No account credentials were entered and no sign-in or transcription task was submitted. GitHub publication remains paused.
