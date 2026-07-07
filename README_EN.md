English | [中文](README.md)

# CommentMiner — Video Comment Deep Insight System

> Three-stage pipeline: **Rule Filter** → **LLM Reading** → **Thinking Model Deep Report**

CommentMiner supports **YouTube** and **Bilibili**. It turns a video comment section into a readable, quotable, and human-editable research report. You can use it as a local Web app or install the Chrome / Edge / Firefox browser extension to start analysis directly from a video page.

## Latest Version

Current version: **v0.4.0**

- Fixed missing API key fallback when runtime model settings include an empty `apiKey`, preventing Gemini `Missing or invalid Authorization header` failures.
- Browser extension now supports multi-task recovery, task switching, inline popup preview, and full-page new-tab viewing.
- Chrome / Edge support side panel result viewing; Firefox automatically hides unsupported side panel controls.
- Extension result pages now render Markdown locally without any external CDN dependency.
- `python server.py` now defaults to port `8000`.

See [UPDATE_NOTES.md](UPDATE_NOTES.md) for the full bilingual changelog.

## How It Works

```text
YouTube / Bilibili Comments
        │
        ▼
┌───────────────┐
│   Stage 0     │  Rule-based filter (<1s, zero cost)
│   Junk removal│  Remove emoji-only, short, duplicate, spam, low-value comments
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Stage 1     │  LLM batch reading (20 comments per batch)
│   LLM Reader  │  KEEP → append to gems.md
│               │  PASS → skip
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Stage 2     │  Thinking model writes the report
│   Deep Report │  Cluster, extract, analyze → report.md
└───────────────┘
```

`gems.md` is a human-editable intermediate artifact. Before Stage 2 runs, you can remove weak entries, add missed comments, or adjust annotations.

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Launch the Web UI

```bash
python server.py
```

Open [http://localhost:8000](http://localhost:8000), paste a YouTube or Bilibili video URL, select a model preset, and click **Start Analysis**.

- **Bilibili videos**: Paste the link directly; optionally provide `SESSDATA` if anti-scraping blocks appear.
- **YouTube videos**: Requires a YouTube Data API v3 key.
- **Shared text / short links**: CommentMiner can extract video URLs from shared text and normalize short links such as `b23.tv` and `youtu.be`.
- **Config persistence**: Web settings are saved in browser localStorage and also synced to local `.user_config.json`. The server can fill missing runtime model keys from saved local config.

### 3. Or Use the CLI

```bash
cp config.yaml.example config.yaml
# Edit config.yaml with your LLM settings

python main.py "https://www.bilibili.com/video/BV1xxxxxxxxx"
python main.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

For detailed setup, Ollama local models, cloud deployment, and FAQ, see [USAGE.md](USAGE.md).

## Browser Extension

The browser extension detects the current video page and starts analysis through your local CommentMiner backend.

| Browser | Support | Result Views |
| --- | --- | --- |
| Chrome | Supported | Inline popup preview, side panel, new tab |
| Edge | Supported | Inline popup preview, side panel, new tab |
| Firefox | Supported | Inline popup preview, new tab |

Install:

1. Start the local backend: `python server.py`
2. Chrome / Edge: open `chrome://extensions` or `edge://extensions`, enable developer mode, and load `extension-dist/chrome/`
3. Firefox: open `about:debugging` and load `extension-dist/firefox/manifest.json`
4. Open a Bilibili or YouTube video page and click the CommentMiner extension icon

Extension source lives in `extension/`. Build with:

```bash
python extension/build.py
```

Build outputs:

- `extension-dist/chrome/`
- `extension-dist/firefox/`

## Supported Platforms

| Platform | API Key Required | Notes |
| --- | --- | --- |
| Bilibili | No | Uses public APIs; optional `SESSDATA` improves stability |
| YouTube | YouTube Data API v3 key | Required for comment collection |

## LLM Presets

| Preset | Stage 1 Reader | Stage 2 Report | Best For |
| --- | --- | --- | --- |
| Google Gemini | gemini-3.1-flash-lite | gemini-3.1-pro | Fast runs with Google credits |
| DeepSeek | deepseek-chat | deepseek-reasoner | Cost-effective API runs |
| OpenAI | gpt-5.4-mini | gpt-5.4 | General high-quality analysis |
| Claude | claude-haiku | claude-sonnet | Strong long-form writing |
| Fully Local | Ollama qwen2.5:14b | Ollama qwq:32b | Local GPU, zero API cost |
| Hybrid | Local Ollama | DeepSeek / other API | Local reading + cloud reporting |

Report output languages: Chinese, English, and German.

## Cloud Deployment and Render

The repository includes `render.yaml` and `Dockerfile`, so it can be deployed to Render directly.

- If your Render service is connected to the GitHub repository and **Auto Deploy** is enabled, pushes to `main` trigger a new deployment automatically.
- If Auto Deploy is disabled, use **Manual Deploy → Deploy latest commit** in the Render dashboard.
- For hosted deployments, configure model settings and keys as environment variables: `READER_PROVIDER`, `READER_MODEL`, `READER_BASE_URL`, `READER_API_KEY`, `THINKER_PROVIDER`, `THINKER_MODEL`, `THINKER_BASE_URL`, `THINKER_API_KEY`, `YOUTUBE_API_KEY`, and `BILIBILI_SESSDATA`.

## Project Structure

```text
comment-miner/
├── main.py                 # CLI entry point
├── server.py               # FastAPI Web server + SSE job stream
├── url_utils.py            # Shared-text URL extraction and short-link normalization
├── config.yaml.example     # CLI config template
├── requirements.txt
├── USAGE.md                # Detailed usage guide
├── UPDATE_NOTES.md         # Bilingual release notes
│
├── scrapers/
│   ├── base.py             # Comment data structure
│   ├── youtube.py          # YouTube Data API scraper
│   ├── bilibili.py         # Bilibili comment API scraper with Wbi signing
│   └── factory.py          # URL → scraper factory
│
├── stage0_prefilter.py     # Rule-based pre-filter
├── stage1_llm_read.py      # LLM reading → gems.md
├── stage2_report.py        # Thinking model → report.md
│
├── llm/
│   └── client.py           # Unified Ollama / OpenAI-compatible client
│
├── prompts/
│   ├── reader.txt
│   ├── reporter_quick.txt
│   └── reporter_deep.txt
│
├── frontend/               # React Web UI
│   ├── src/App.jsx
│   └── dist/               # Pre-built assets served by server.py
│
├── extension/              # Browser extension source
└── extension-dist/         # Chrome / Edge / Firefox extension builds
```

## License

[CC BY-NC 4.0](LICENSE) — Free for personal use, modification, and sharing. **Commercial use prohibited.**

Made by **Raelon**
