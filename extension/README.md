# CommentMiner 浏览器扩展

一键分析 B站/YouTube 视频评论区的浏览器扩展，调用本地 CommentMiner 后端进行 AI 深度分析。

## 功能特性

- 🎯 **自动识别视频**：在 B站/YouTube 视频页点击扩展图标，自动识别当前视频
- 🌍 **报告语言可选**：支持中文 / English / Deutsch 三种输出语言
- ⚡ **两种分析模式**：快速洞察（3分钟掌握核心） / 深度研究（社会观察视角）
- 📊 **实时进度**：SSE 流式显示采集→精读→报告全流程进度
- 💎 **查看结果**：分析完成后可直接查看精华评论和深度报告
- 🔗 **跨浏览器**：一套代码同时支持 Chrome、Edge、Firefox 三大浏览器

## 架构设计

### 为什么这样设计？

#### 1. 跨三浏览器兼容性
- **统一 WebExtensions API**：使用 `browser` namespace，自动降级到 `chrome`
- **双 manifest 文件**：
  - `manifest.json` — Chrome/Edge MV3（service_worker 后台）
  - `manifest.firefox.json` — Firefox MV3（background scripts）
- **无浏览器专有 API**：所有功能使用标准 WebExtensions API

#### 2. 长任务 SSE 连接保活
**问题**：Chrome/Edge 的 MV3 service worker 在 30 秒无活动后会被终止，而评论分析通常需要几分钟。

**解决方案**：
- **SSE 连接放在后台脚本**：不依赖 popup 页面生命周期
- **Port 长连接保活**：popup 通过 `browser.runtime.connect()` 建立 port 连接，保持 service worker 活跃
- **心跳机制**：每 25 秒发送一次 keepalive 消息（低于 30 秒超时阈值）
- **状态持久化**：任务状态存入 `chrome.storage.local`，service worker 重启后可恢复
- **自动重连**：从 storage 恢复时自动重新连接 SSE 流

#### 3. 混合内容问题解决
**问题**：视频页面是 HTTPS，本地后端是 HTTP（localhost），浏览器的混合内容策略会阻止请求。

**解决方案**：
- **所有 API 请求从后台脚本发出**：扩展的后台上下文不受页面混合内容策略限制
- **Content Script 不直接发请求**：只负责提取视频信息
- **Popup 通过 port 与后台通信**：所有网络请求都经过后台脚本中转
- **manifest 中声明 localhost 权限**：`host_permissions` 包含 `http://localhost:8000/*`

### 模块划分

```
extension/
├── manifest.json           # Chrome/Edge MV3 清单
├── manifest.firefox.json   # Firefox MV3 清单
├── background.js           # 后台脚本（SSE 管理、API 中转、状态持久化）
├── content.js              # 内容脚本（提取页面视频信息）
├── popup.html/css/js       # 弹窗 UI
└── icons/                  # 扩展图标
```

**数据流向**：
```
Content Script ──视频信息──→ Background Script ←──Port──→ Popup
                              ↑    ↑
                              │    └──SSE──  localhost:8000
                              └──REST API──┘
```

## 安装方法

### Chrome / Edge

1. 打开扩展管理页面：`chrome://extensions`（Edge 是 `edge://extensions`）
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本 `extension` 目录
5. 确保本地后端在 `http://localhost:8000` 运行

### Firefox

1. 打开 `about:debugging`
2. 点击「此 Firefox」→「临时载入附加组件」
3. 选择 `extension/manifest.firefox.json` 文件
4. （或者将 `manifest.firefox.json` 重命名为 `manifest.json` 后加载整个目录）
5. 确保本地后端在 `http://localhost:8000` 运行

> 注意：Firefox 临时加载的扩展在浏览器重启后会消失，如需永久安装请签名后安装。

## 使用方法

1. 启动本地 CommentMiner 后端（`python3 server.py`，默认端口 8000）
2. 在 B站或 YouTube 打开任意视频页面
3. 点击浏览器工具栏中的 CommentMiner 扩展图标
4. 选择报告语言和分析模式
5. 点击「开始分析」按钮
6. 等待分析完成，实时查看进度
7. 分析完成后，点击按钮查看精华评论或深度报告

## 设置

点击弹窗右上角的 ⚙ 按钮可修改后端地址（默认 `http://localhost:8000`）。

## 已知限制

1. **Chrome/Edge service worker 限制**：如果 popup 关闭，service worker 可能在 30 秒后被终止。任务仍在后端运行，重新打开 popup 可恢复进度。
2. **Firefox MV3 兼容性**：Firefox 的 MV3 实现与 Chrome 略有差异，如遇问题可使用 `manifest.firefox.json`。
3. **本地后端必需**：扩展需要本地运行的 CommentMiner 后端才能工作。
