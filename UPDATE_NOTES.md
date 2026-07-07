# 更新说明

## v0.4.0 - 稳定性与浏览器扩展增强

本次更新重点修复本地 Web 端与浏览器扩展在长任务、跨浏览器查看结果、API Key 持久化上的稳定性问题。

### 主要修复

- 修复浏览器扩展在 service worker 被回收后，重新打开 popup 时偶发显示“需要重新开始”，但后端任务仍在运行的问题。
- 修复前端或扩展传入模型配置但 `apiKey` 为空时，服务端不会从本地保存配置回填密钥，导致 Gemini 报 `Missing or invalid Authorization header` 的问题。
- 修复扩展整页结果查看依赖外部 CDN 渲染 Markdown，CDN 不可用时页面空白的问题。
- 修复扩展构建脚本漏打包 `md.js`、`sidepanel.html`、`sidepanel.js` 的问题。
- 修复 Windows 控制台下构建脚本输出 emoji 可能触发编码错误的问题。
- 统一 `python server.py` 默认端口为 `8000`，与 README、扩展默认后端地址保持一致。

### 新增与增强

- 新增本地保存配置接口 `/api/saved-config`，服务端可保存并回填模型、YouTube Key、B站 SESSDATA。
- 新增分享文本 URL 提取与规范化接口 `/api/extract-url`，支持 `b23.tv`、`youtu.be` 等短链。
- 支持报告输出语言参数：中文、English、Deutsch。
- 浏览器扩展支持多任务恢复与切换，popup 断线重连后会重新拉取当前视频和任务状态。
- 扩展结果查看方式增强：
  - popup 内嵌预览
  - Chrome / Edge 右侧边栏
  - 新标签整页查看
- Firefox 版本保留 popup 与新标签查看能力，自动隐藏不支持的 side panel 入口。

### 发布产物

- Web 前端已重新构建到 `frontend/dist/`。
- Chrome / Edge 扩展产物位于 `extension-dist/chrome/`。
- Firefox 扩展产物位于 `extension-dist/firefox/`。

### 验证

- Python 编译检查通过。
- 前端 `npm run lint` 通过。
- 前端 `npm run build` 通过。
- 扩展 JS 语法检查通过。
- 扩展构建脚本通过，Chrome / Edge 与 Firefox 两套产物已生成。
