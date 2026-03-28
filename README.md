# 视频评论深度洞察系统 (Comment Miner)

> 三阶段 Pipeline：**规则硬筛** → **LLM 精读** → **思考模型写深度报告**

把一个视频的 4000+ 条评论，提炼成一份有洞察力的深度研究报告。

## 工作原理

```
4000+ 原始评论
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

### 2. 配置

```bash
cp config.yaml.example config.yaml
```

编辑 `config.yaml`，填入：
- `youtube.api_key`：[Google Cloud Console](https://console.cloud.google.com/) 获取 YouTube Data API v3 Key
- `llm.reader` 和 `llm.thinker`：选择你的 LLM 方案（见下方）

### 3. 运行

```bash
python main.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

输出：
- `data/gems_<video_id>.md` — Stage 1 精华评论集
- `reports/<video_id>_report.md` — Stage 2 深度报告

## LLM 方案选择

| 场景 | Stage 1 精读 | Stage 2 报告 | 成本/次 |
|------|-------------|-------------|---------|
| 纯本地 | Ollama qwen2.5:14b | Ollama qwq:32b | ¥0 |
| 性价比 | DeepSeek-V3 | DeepSeek-R1 | ~¥0.3 |
| 质量优先 | Claude Haiku | Claude Sonnet | ~$0.8 |
| 混搭推荐 | Ollama 本地 | DeepSeek-R1 API | ~¥0.1 |

详细配置见 `config.yaml.example`。

## 断点恢复

Stage 1 支持断点恢复。如果中途中断，重新运行同一个 URL，会从上次处理的 batch 继续。

## 项目结构

```
comment-miner/
├── main.py                 # 主入口
├── config.yaml.example     # 配置示例
├── requirements.txt
│
├── scrapers/
│   ├── base.py             # Comment 数据结构
│   ├── youtube.py          # YouTube Data API 采集
│   └── factory.py          # URL → 自动选 scraper
│
├── stage0_prefilter.py     # 规则硬筛
├── stage1_llm_read.py      # LLM 精读 → gems.md
├── stage2_report.py        # 思考模型 → report.md
│
├── llm/
│   └── client.py           # 统一 LLM 客户端
│
└── prompts/
    ├── reader.txt          # Stage 1 精读 prompt
    └── reporter.txt        # Stage 2 报告 prompt
```

## 获取 YouTube API Key

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目 → 启用 **YouTube Data API v3**
3. 创建凭据 → API Key
4. 填入 `config.yaml` 的 `youtube.api_key`

> 免费配额：每天 10,000 单位。采集 5000 条评论约消耗 50-100 单位。

## License

MIT
