# 更新说明 / Release Notes

## v0.4.0 - 稳定性与浏览器扩展增强 / Stability and Browser Extension Improvements

本次更新重点修复本地 Web 端与浏览器扩展在长任务、跨浏览器查看结果、API Key 持久化上的稳定性问题。

This release focuses on stability fixes for the local Web UI and browser extension, especially long-running tasks, cross-browser result viewing, and API key persistence.

### 主要修复 / Fixes

- 修复浏览器扩展在 service worker 被回收后，重新打开 popup 时偶发显示“需要重新开始”，但后端任务仍在运行的问题。  
  Fixed an extension race where reopening the popup after service worker shutdown could show “restart required” even though the backend job was still running.
- 修复前端或扩展传入模型配置但 `apiKey` 为空时，服务端不会从本地保存配置回填密钥，导致 Gemini 报 `Missing or invalid Authorization header` 的问题。  
  Fixed missing runtime API key fallback when the frontend or extension sent model settings with an empty `apiKey`, which caused Gemini to return `Missing or invalid Authorization header`.
- 修复扩展整页结果查看依赖外部 CDN 渲染 Markdown，CDN 不可用时页面空白的问题。  
  Removed the external CDN dependency for full-page Markdown rendering in the extension, preventing blank result pages when the CDN is unavailable.
- 修复扩展构建脚本漏打包 `md.js`、`sidepanel.html`、`sidepanel.js` 的问题。  
  Fixed the extension build script so `md.js`, `sidepanel.html`, and `sidepanel.js` are included in packaged builds.
- 修复 Windows 控制台下构建脚本输出 emoji 可能触发编码错误的问题。  
  Fixed a Windows console encoding issue in the extension build script.
- 统一 `python server.py` 默认端口为 `8000`，与 README、扩展默认后端地址保持一致。  
  Unified the default `python server.py` port to `8000`, matching the README and extension backend defaults.

### 新增与增强 / Improvements

- 新增本地保存配置接口 `/api/saved-config`，服务端可保存并回填模型、YouTube Key、B站 SESSDATA。  
  Added `/api/saved-config` so the server can save and restore model settings, YouTube keys, and Bilibili SESSDATA locally.
- 新增分享文本 URL 提取与规范化接口 `/api/extract-url`，支持 `b23.tv`、`youtu.be` 等短链。  
  Added `/api/extract-url` to extract and normalize video URLs from shared text, including short links such as `b23.tv` and `youtu.be`.
- 支持报告输出语言参数：中文、English、Deutsch。  
  Added report output language support for Chinese, English, and German.
- 浏览器扩展支持多任务恢复与切换，popup 断线重连后会重新拉取当前视频和任务状态。  
  Improved browser extension multi-task recovery and switching; the popup now reloads current video and job state after reconnecting.
- 扩展结果查看方式增强：popup 内嵌预览、Chrome / Edge 右侧边栏、新标签整页查看。  
  Improved result viewing in the extension: inline popup preview, Chrome / Edge side panel, and full-page new-tab view.
- Firefox 版本保留 popup 与新标签查看能力，自动隐藏不支持的 side panel 入口。  
  Firefox keeps popup and new-tab viewing support while automatically hiding unsupported side panel controls.

### 发布产物 / Release Artifacts

- Web 前端已重新构建到 `frontend/dist/`。  
  The Web frontend has been rebuilt into `frontend/dist/`.
- Chrome / Edge 扩展产物位于 `extension-dist/chrome/`。  
  Chrome / Edge extension build is available in `extension-dist/chrome/`.
- Firefox 扩展产物位于 `extension-dist/firefox/`。  
  Firefox extension build is available in `extension-dist/firefox/`.

### 验证 / Verification

- Python 编译检查通过。  
  Python compile checks passed.
- 前端 `npm run lint` 通过。  
  Frontend `npm run lint` passed.
- 前端 `npm run build` 通过。  
  Frontend `npm run build` passed.
- 扩展 JS 语法检查通过。  
  Extension JavaScript syntax checks passed.
- 扩展构建脚本通过，Chrome / Edge 与 Firefox 两套产物已生成。  
  Extension build script passed, producing both Chrome / Edge and Firefox builds.
