English | [中文](README.md)

# CommentMiner — Video Comment Deep Insight System

> Three-stage pipeline: **Rule Filter** → **LLM Reading** → **Thinking Model Deep Report**

Supports **YouTube** and **Bilibili (B站)**. Distills thousands of video comments into an insightful deep analysis report.

## How It Works

```
YouTube / Bilibili Comments
        │
        ▼
┌───────────────┐
│   Stage 0     │  Rule-based filter (<1s, zero cost)
│   Junk removal│  Remove emoji-only, <15 chars, duplicates, spam
└───────┬───────┘
        │  ≈ 800-1500 comments
        ▼
┌───────────────┐
│   Stage 1     │  LLM batch reading (20 per batch)
│   LLM Reader  │  KEEP → append to gems.md
│               │  PASS → skip
└───────┬───────┘
        │  gems.md (≈ 30-80 gems with annotations)
        ▼
┌───────────────┐
│   Stage 2     │  Thinking model writes report
│   Deep Report │  Cluster, extract, analyze → report.md
└───────────────┘
```

**gems.md is a human-editable intermediate artifact** — before Stage 2 runs, you can manually add or remove entries, preserving human override capability.

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Launch Web UI (Recommended)

```bash
python server.py
```

Open **http://localhost:8000** in your browser, paste a video URL, select a model preset, and click "Start Analysis".

- **Bilibili videos**: Just paste the link — no API key needed
- **YouTube videos**: Requires a YouTube Data API v3 Key

> All settings are auto-saved to browser localStorage — fill once, never re-enter.

### 3. Or Use the CLI

```bash
cp config.yaml.example config.yaml
# Edit config.yaml with your LLM settings

# Bilibili (no API key needed)
python main.py "https://www.bilibili.com/video/BV1xxxxxxxxx"

# YouTube (requires YouTube API Key in config.yaml)
python main.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

> For detailed usage, full API mode configuration, and FAQ, see **[USAGE.md](USAGE.md)**.

## Supported Platforms

| Platform | API Key Required | Notes |
|----------|-----------------|-------|
| **Bilibili** | No | Uses public API, just paste the link |
| **YouTube** | YouTube Data API v3 Key | [How to get one](USAGE.md#youtube-api-key仅分析-youtube-视频时需要) |

## LLM Presets

| Preset | Stage 1 Reader | Stage 2 Report | Cost/run |
|--------|---------------|----------------|----------|
| **Google Gemini** | gemini-3.1-flash-lite | gemini-3.1-pro | $300 free credit |
| DeepSeek | deepseek-chat | deepseek-reasoner | ~¥0.3 |
| OpenAI | gpt-5.4-mini | gpt-5.4 | ~$0.5 |
| Claude | claude-haiku | claude-sonnet | ~$0.8 |
| Local | Ollama qwen2.5:14b | Ollama qwq:32b | Free |

**Using local models?** Install [Ollama](https://ollama.com/), pull models (`ollama pull qwen2.5:14b`), then select the "Fully Local" or "Hybrid" preset in the Web UI. No API key needed. See [USAGE.md](USAGE.md#本地模型配置ollama零成本) for step-by-step setup.

See [USAGE.md](USAGE.md#全-api-模式配置不用本地模型) for API configuration details.

## Project Structure

```
comment-miner/
├── main.py                 # CLI entry point
├── server.py               # Web server (FastAPI + SSE + frontend)
├── config.yaml.example     # Config template
├── requirements.txt
├── USAGE.md                # Detailed usage guide
│
├── scrapers/
│   ├── base.py             # Comment data structure
│   ├── youtube.py          # YouTube Data API scraper
│   ├── bilibili.py         # Bilibili comment API scraper (Wbi signed)
│   └── factory.py          # URL → auto-select scraper
│
├── stage0_prefilter.py     # Rule-based pre-filter
├── stage1_llm_read.py      # LLM reading → gems.md
├── stage2_report.py        # Thinking model → report.md
│
├── llm/
│   └── client.py           # Unified LLM client (auto-retry)
│
├── prompts/
│   ├── reader.txt          # Stage 1 reader prompt
│   ├── reporter_quick.txt  # Stage 2 quick insight prompt
│   └── reporter_deep.txt   # Stage 2 deep research prompt
│
└── frontend/               # React Web UI (Chinese/English)
    ├── src/App.jsx          # Main UI component
    └── dist/                # Pre-built assets (served by server.py)
```

## License

[CC BY-NC 4.0](LICENSE) — Free for personal use, modification, and sharing. **Commercial use prohibited.**

Made by **Raelon**
