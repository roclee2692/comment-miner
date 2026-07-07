[English](README_EN.md) | 中文

# 视频评论深度洞察系统 (CommentMiner)

> 三阶段 Pipeline：**规则硬筛** → **LLM 精读** → **思考模型写深度报告**

CommentMiner 支持 **YouTube** 和 **B站**，可以把一个视频的评论区提炼成一份可读、可引用、可继续编辑的深度研究报告。它既能作为本地 Web 工具使用，也提供 Chrome / Edge / Firefox 浏览器扩展，方便在视频页面一键启动分析。

## 最新版本

当前版本：**v0.4.0**

- 修复 API Key 为空时服务端不会回填本地保存配置的问题，避免 Gemini 报 `Missing or invalid Authorization header`。
- 浏览器扩展支持多任务恢复、任务切换、popup 内嵌预览、新标签整页查看。
- Chrome / Edge 支持右侧边栏查看结果；Firefox 自动隐藏不支持的 side panel 入口。
- 扩展结果页已改为本地 Markdown 渲染，不再依赖外部 CDN。
- `python server.py` 默认端口统一为 `8000`。

完整更新记录见 [UPDATE_NOTES.md](UPDATE_NOTES.md)。

## 工作原理

```text
YouTube / B站 评论
      │
      ▼
┌─────────────┐
│  Stage 0    │  规则硬筛（<1秒，零成本）
│  去垃圾     │  去掉纯表情、短评、重复、广告、低信息量内容
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Stage 1    │  LLM 批量精读（每批 20 条）
│  模型当读者 │  KEEP → 追加到 gems.md
│             │  PASS → 跳过
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Stage 2    │  思考模型写报告
│  深度报告   │  聚类、提炼、分析 → report.md
└─────────────┘
```

`gems.md` 是人可以直接编辑的中间产物。Stage 2 运行前，你可以手动增删、改标注、补充遗漏评论，保留人类 override 的能力。

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动 Web 界面

```bash
python server.py
```

浏览器打开 [http://localhost:8000](http://localhost:8000)，粘贴 YouTube 或 B站视频链接，选择模型方案，点击「开始分析」。

- **B站视频**：直接粘贴链接即可；如遇反爬，可填入 B站 `SESSDATA`。
- **YouTube 视频**：需要 YouTube Data API v3 Key。
- **分享文本 / 短链**：支持从分享文本中提取链接，并规范化 `b23.tv`、`youtu.be` 等短链。
- **配置保存**：Web 配置会保存到浏览器 localStorage，同时同步到本地 `.user_config.json`。服务端会在运行时回填缺失的模型 Key，避免浏览器状态丢失导致任务失败。

### 3. 或使用命令行

```bash
cp config.yaml.example config.yaml
# 编辑 config.yaml，填入 LLM 配置

python main.py "https://www.bilibili.com/video/BV1xxxxxxxxx"
python main.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

详细配置、Ollama 本地模型、云端部署和常见问题见 [USAGE.md](USAGE.md)。

## 浏览器扩展

扩展支持在视频页直接识别当前视频并启动本地 CommentMiner 后端分析。

| 浏览器 | 支持情况 | 结果查看方式 |
| --- | --- | --- |
| Chrome | 支持 | popup 内嵌预览、右侧边栏、新标签 |
| Edge | 支持 | popup 内嵌预览、右侧边栏、新标签 |
| Firefox | 支持 | popup 内嵌预览、新标签 |

安装方式：

1. 启动本地后端：`python server.py`
2. Chrome / Edge：打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式，加载 `extension-dist/chrome/`
3. Firefox：打开 `about:debugging`，临时载入 `extension-dist/firefox/manifest.json`
4. 打开 B站或 YouTube 视频页，点击 CommentMiner 扩展图标开始分析

扩展源码在 `extension/`，构建脚本为：

```bash
python extension/build.py
```

构建产物：

- `extension-dist/chrome/`
- `extension-dist/firefox/`

## 支持的平台

| 平台 | 需要 API Key | 说明 |
| --- | --- | --- |
| B站 | 不需要 | 使用公开 API；可选填 `SESSDATA` 提高稳定性 |
| YouTube | 需要 YouTube Data API v3 Key | 用于抓取评论 |

## LLM 方案选择

| 方案 | Stage 1 精读 | Stage 2 报告 | 适合场景 |
| --- | --- | --- | --- |
| Google Gemini | gemini-3.1-flash-lite | gemini-3.1-pro | 有 Google 额度，速度快 |
| DeepSeek | deepseek-chat | deepseek-reasoner | 性价比高 |
| OpenAI | gpt-5.4-mini | gpt-5.4 | 通用高质量 |
| Claude | claude-haiku | claude-sonnet | 长文质量好 |
| 全本地 | Ollama qwen2.5:14b | Ollama qwq:32b | 本地 GPU，零 API 成本 |
| 混搭 | Ollama 本地 | DeepSeek / 其他 API | 本地精读 + 云端写报告 |

报告输出语言支持：中文、English、Deutsch。

## 云端部署与 Render

仓库包含 `render.yaml` 和 `Dockerfile`，可直接部署到 Render。

- Render 服务连接 GitHub 仓库后，如果开启 **Auto Deploy**，推送到 `main` 会自动触发线上部署。
- 如果没有开启 Auto Deploy，可在 Render 控制台点击 **Manual Deploy → Deploy latest commit**。
- 线上环境建议使用环境变量保存模型配置和 Key：`READER_PROVIDER`、`READER_MODEL`、`READER_BASE_URL`、`READER_API_KEY`、`THINKER_PROVIDER`、`THINKER_MODEL`、`THINKER_BASE_URL`、`THINKER_API_KEY`、`YOUTUBE_API_KEY`、`BILIBILI_SESSDATA`。

## 项目结构

```text
comment-miner/
├── main.py                 # CLI 入口
├── server.py               # FastAPI Web 服务 + SSE 任务流
├── url_utils.py            # 分享文本 URL 提取与短链规范化
├── config.yaml.example     # CLI 配置示例
├── requirements.txt
├── USAGE.md                # 详细使用教程
├── UPDATE_NOTES.md         # 中英双语更新说明
│
├── scrapers/
│   ├── base.py             # Comment 数据结构
│   ├── youtube.py          # YouTube Data API 采集
│   ├── bilibili.py         # B站评论 API 采集（Wbi 签名）
│   └── factory.py          # URL → 自动选择 scraper
│
├── stage0_prefilter.py     # 规则硬筛
├── stage1_llm_read.py      # LLM 精读 → gems.md
├── stage2_report.py        # 思考模型 → report.md
│
├── llm/
│   └── client.py           # Ollama / OpenAI-compatible 统一客户端
│
├── prompts/
│   ├── reader.txt
│   ├── reporter_quick.txt
│   └── reporter_deep.txt
│
├── frontend/               # React Web UI
│   ├── src/App.jsx
│   └── dist/               # 预构建产物，server.py 直接托管
│
├── extension/              # 浏览器扩展源码
└── extension-dist/         # Chrome / Edge / Firefox 扩展产物
```

## License

[CC BY-NC 4.0](LICENSE) — 个人免费使用、修改、分享，**禁止商业用途**。

Made by **Raelon**
