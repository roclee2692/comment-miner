# 视频评论深度洞察系统 (Comment Miner)

> 三阶段 Pipeline：**规则硬筛** → **LLM 精读** → **思考模型写深度报告**

支持 **YouTube** 和 **B站**，把一个视频的数千条评论提炼成一份有洞察力的深度研究报告。

## 工作原理

```
YouTube / B站 评论
      │
      ▼
┌─────────────┐
│  Stage 0    │  规则硬筛（<1秒，零成本）
│  去垃圾     │  去掉纯表情、<15字、重复、广告
└──────┬──────┘
       │  ≈ 800-1500 条
       ▼
┌─────────────┐
│  Stage 1    │  LLM 批量精读（每批 20 条）
│  模型当读者 │  KEEP → 追加到 gems.md
│             │  PASS → 跳过
└──────┬──────┘
       │  gems.md（≈ 30-80 条精华 + 标注）
       ▼
┌─────────────┐
│  Stage 2    │  思考模型写报告
│  深度报告   │  聚类、提炼、分析 → report.md
└─────────────┘
```

**gems.md 是人可以直接编辑的中间产物**——Stage 2 运行前，你可以手动增删，保留人类 override 的能力。

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动 Web 界面（推荐）

```bash
python server.py
```

浏览器打开 **http://localhost:8000**，粘贴视频链接，选择模型方案，点击「开始分析」。

- **B站视频**：直接粘贴链接即可，无需任何 Key
- **YouTube 视频**：需要填入 YouTube Data API v3 Key

> 所有配置自动保存到浏览器，填一次即可，刷新不丢失。

### 3. 或使用命令行

```bash
cp config.yaml.example config.yaml
# 编辑 config.yaml，填入 LLM 配置

# B站视频（无需 API Key）
python main.py "https://www.bilibili.com/video/BV1xxxxxxxxx"

# YouTube 视频（需要在 config.yaml 填入 YouTube API Key）
python main.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

> 详细使用说明、全 API 模式配置、常见问题等请参考 **[USAGE.md](USAGE.md)**。

## 支持的平台

| 平台 | 需要 API Key | 说明 |
|------|-------------|------|
| **B站** | 不需要 | 使用公开 API，直接粘贴链接 |
| **YouTube** | 需要 YouTube Data API v3 Key | [获取方式](USAGE.md#youtube-api-key仅分析-youtube-视频时需要) |

## LLM 方案选择

| 方案 | Stage 1 精读 | Stage 2 报告 | 成本/次 |
|------|-------------|-------------|---------|
| **Google Gemini** | gemini-3.1-flash-lite | gemini-3.1-pro | 有$300赠金 |
| DeepSeek | deepseek-chat | deepseek-reasoner | ~¥0.3 |
| OpenAI | gpt-5.4-mini | gpt-5.4 | ~$0.5 |
| Claude | claude-haiku | claude-sonnet | ~$0.8 |
| 全本地 | Ollama qwen2.5:14b | Ollama qwq:32b | ¥0 |

详细配置见 [USAGE.md](USAGE.md#全-api-模式配置不用本地模型)。

## 项目结构

```
comment-miner/
├── main.py                 # CLI 入口
├── server.py               # Web 服务（FastAPI + SSE + 前端）
├── config.yaml.example     # 配置示例
├── requirements.txt
├── USAGE.md                # 详细使用教程
│
├── scrapers/
│   ├── base.py             # Comment 数据结构
│   ├── youtube.py          # YouTube Data API 采集
│   ├── bilibili.py         # B站评论 API 采集
│   └── factory.py          # URL → 自动选 scraper
│
├── stage0_prefilter.py     # 规则硬筛
├── stage1_llm_read.py      # LLM 精读 → gems.md
├── stage2_report.py        # 思考模型 → report.md
│
├── llm/
│   └── client.py           # 统一 LLM 客户端
│
├── prompts/
│   ├── reader.txt          # Stage 1 精读 prompt
│   └── reporter.txt        # Stage 2 报告 prompt
│
└── frontend/               # React Web UI
    ├── src/App.jsx          # 主界面组件
    └── dist/                # 预构建产物（server.py 直接 serve）
```

## License

[CC BY-NC 4.0](LICENSE) — 个人免费使用、修改、分享，**禁止商业用途**。

Made by **Raelon**
