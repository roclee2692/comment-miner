"""
FastAPI server — exposes the three-stage pipeline via HTTP + SSE.

Endpoints:
  POST /api/run          Start pipeline (returns job_id)
  GET  /api/stream/{id}  SSE stream of progress logs
  GET  /api/gems/{id}    Return gems.md content
  GET  /api/report/{id}  Return report.md content
  GET  /api/status/{id}  Job status (running / done / error)
  GET  /api/defaults     Server-side default config (for cloud deployment)
"""

import asyncio
import json
import os
import re
import sys
import time
import traceback
import uuid

# Windows consoles default to a legacy codepage (e.g. GBK), which raises
# UnicodeEncodeError when the pipeline prints emoji/CJK progress lines. Force
# UTF-8 on stdout/stderr so the pipeline runs locally regardless of codepage.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from pathlib import Path
from threading import Thread, Lock
from typing import AsyncGenerator

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from scrapers.factory import create_scraper
from stage0_prefilter import prefilter
from stage1_llm_read import LLMReader
from stage2_report import ReportWriter
from llm.client import LLMClient
from url_utils import extract_first_url, normalize_video_url, detect_platform

app = FastAPI(title="CommentMiner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Server-side defaults (from environment variables) ─────────────────────
# Set these in Render/Railway dashboard → Environment Variables:
#   READER_PROVIDER, READER_MODEL, READER_BASE_URL, READER_API_KEY
#   THINKER_PROVIDER, THINKER_MODEL, THINKER_BASE_URL, THINKER_API_KEY
#   YOUTUBE_API_KEY, BILIBILI_SESSDATA

def _get_server_defaults() -> dict | None:
    """Return server-side LLM config from env vars, or None if not configured."""
    reader_model = os.environ.get("READER_MODEL", "")
    thinker_model = os.environ.get("THINKER_MODEL", "")
    if not reader_model or not thinker_model:
        return None
    return {
        "reader": {
            "provider": os.environ.get("READER_PROVIDER", "openai_compatible"),
            "model": reader_model,
            "baseUrl": os.environ.get("READER_BASE_URL", ""),
            "apiKey": os.environ.get("READER_API_KEY", ""),
        },
        "thinker": {
            "provider": os.environ.get("THINKER_PROVIDER", "openai_compatible"),
            "model": thinker_model,
            "baseUrl": os.environ.get("THINKER_BASE_URL", ""),
            "apiKey": os.environ.get("THINKER_API_KEY", ""),
        },
        "youtube_api_key": os.environ.get("YOUTUBE_API_KEY", ""),
        "bilibili_sessdata": os.environ.get("BILIBILI_SESSDATA", ""),
    }


def _get_local_config_defaults() -> dict | None:
    """Fallback defaults from the locally saved .user_config.json.

    The web UI sends reader/thinker keys in each request, but the browser
    extension sends empty configs (it has no access to the saved keys). When no
    env-var defaults are configured, fall back to the keys the user saved
    locally so extension-triggered runs work end to end.
    """
    if not _LOCAL_CONFIG_PATH.exists():
        return None
    try:
        cfg = json.loads(_LOCAL_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    reader = cfg.get("reader") or {}
    thinker = cfg.get("thinker") or {}
    if not reader.get("model") or not thinker.get("model"):
        return None
    return {
        "reader": reader,
        "thinker": thinker,
        "youtube_api_key": cfg.get("ytKey", ""),
        "bilibili_sessdata": cfg.get("biliSess", ""),
    }


# In-memory job store (thread-safe)
_jobs: dict[str, dict] = {}  # job_id → {status, logs, video_id, created_at}
_jobs_lock = Lock()
MAX_JOBS = 100

# video_id 只允许安全字符，防止路径穿越
_SAFE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


class RunRequest(BaseModel):
    video_url: str
    video_title: str = ""
    video_brief: str = ""
    max_comments: int = 5000
    bilibili_sessdata: str = ""
    report_mode: str = "quick"   # "quick" | "deep"
    report_language: str = "zh"  # "zh" | "en" | "de" —— 仅控制 Stage2 报告输出语言
    keep_per_batch: int = 5      # 每批20条评论中最多保留几条精华
    reader: dict = {}
    thinker: dict = {}

    @field_validator("max_comments")
    @classmethod
    def clamp_max_comments(cls, v: int) -> int:
        return max(100, min(v, 20000))

    @field_validator("keep_per_batch")
    @classmethod
    def clamp_keep_per_batch(cls, v: int) -> int:
        return max(1, min(v, 15))
    
    @field_validator("report_language")
    @classmethod
    def validate_language(cls, v: str) -> str:
        if v not in ("zh", "en", "de"):
            return "zh"
        return v


# ── 本地配置持久化（保存在服务端，不依赖浏览器） ─────────────────────────
_LOCAL_CONFIG_PATH = Path(__file__).parent / ".user_config.json"


@app.get("/api/saved-config")
async def get_saved_config():
    """读取本地保存的用户配置"""
    if not _LOCAL_CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(_LOCAL_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _merge_preserve_secrets(new: dict, old: dict) -> dict:
    """Merge an incoming config over the existing one without letting blank
    secret fields clobber stored values.

    The web frontend auto-saves its in-memory state on mount/change and may send
    empty apiKey/ytKey/biliSess (keys are masked client-side). Without this guard
    those blanks would wipe the credentials the browser extension relies on.
    """
    merged = dict(new)
    # Top-level secrets
    for key in ("ytKey", "biliSess"):
        if not merged.get(key) and old.get(key):
            merged[key] = old[key]
    # Nested provider apiKeys
    for section in ("reader", "thinker"):
        new_sec = dict(merged.get(section) or {})
        old_sec = old.get(section) or {}
        if not new_sec.get("apiKey") and old_sec.get("apiKey"):
            new_sec["apiKey"] = old_sec["apiKey"]
        if new_sec:
            merged[section] = new_sec
    return merged


def _merge_runtime_llm_config(incoming: dict, fallback: dict) -> dict:
    """Fill missing runtime LLM fields from saved defaults.

    The web UI can send a partial config such as model/baseUrl with an empty
    apiKey when browser storage is stale or masked. Treat blank fields as
    missing, but let explicit incoming values win.
    """
    incoming = dict(incoming or {})
    fallback = dict(fallback or {})
    if not incoming.get("model"):
        return fallback

    merged = dict(incoming)
    for key in ("provider", "baseUrl", "apiKey", "temperature", "maxTokens"):
        if not merged.get(key) and fallback.get(key):
            merged[key] = fallback[key]
    return merged


@app.post("/api/saved-config")
async def save_config(config: dict):
    """保存用户配置到本地文件（保留已存在的密钥，避免被前端空值覆盖）"""
    try:
        old = {}
        if _LOCAL_CONFIG_PATH.exists():
            try:
                old = json.loads(_LOCAL_CONFIG_PATH.read_text(encoding="utf-8"))
            except Exception:
                old = {}
        config = _merge_preserve_secrets(config, old)
        _LOCAL_CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/defaults")
async def get_defaults():
    """Return whether server-side defaults are configured (without exposing keys)."""
    defaults = _get_server_defaults()
    if not defaults:
        return {"has_defaults": False}
    return {
        "has_defaults": True,
        "reader_model": defaults["reader"]["model"],
        "thinker_model": defaults["thinker"]["model"],
        "has_youtube_key": bool(defaults.get("youtube_api_key")),
    }


class ExtractUrlRequest(BaseModel):
    text: str


@app.post("/api/extract-url")
async def extract_url(req: ExtractUrlRequest):
    """从分享文本中提取并规范化视频 URL。
    
    - 自动从任意文本中提取视频链接
    - 还原 b23.tv 短链为真实 BV 号链接
    - 规范化 youtu.be 等短链
    - 返回平台类型
    """
    url = extract_first_url(req.text)
    if not url:
        # 如果没有匹配到 URL，直接把输入当作 URL 尝试（用户可能直接贴了链接）
        url = req.text.strip()
    
    # 规范化（还原短链）
    normalized = normalize_video_url(url)
    platform = detect_platform(normalized)
    
    return {
        "original_url": url,
        "normalized_url": normalized,
        "platform": platform,
    }


@app.post("/api/run")
async def run_pipeline(req: RunRequest):
    job_id = uuid.uuid4().hex[:8]
    with _jobs_lock:
        if len(_jobs) >= MAX_JOBS:
            _cleanup_old_jobs()
        _jobs[job_id] = {"status": "running", "logs": [], "video_id": None, "created_at": time.time()}

    thread = Thread(target=_run_job, args=(job_id, req), daemon=True)
    thread.start()
    return {"job_id": job_id}


@app.get("/api/stream/{job_id}")
async def stream_logs(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    return StreamingResponse(
        _event_generator(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404)
    return {"status": job["status"], "video_id": job.get("video_id")}


def _validate_video_id(video_id: str):
    """防止路径穿越攻击"""
    if not _SAFE_ID.match(video_id):
        raise HTTPException(status_code=400, detail="Invalid video_id")


@app.get("/api/gems/{video_id}")
async def get_gems(video_id: str):
    _validate_video_id(video_id)
    path = Path(f"data/gems_{video_id}.md")
    if not path.exists():
        raise HTTPException(status_code=404, detail="gems.md not found")
    return {"content": path.read_text(encoding="utf-8")}


@app.get("/api/report/{video_id}")
async def get_report(video_id: str):
    _validate_video_id(video_id)
    path = Path(f"reports/{video_id}_report.md")
    if not path.exists():
        raise HTTPException(status_code=404, detail="report.md not found")
    return {"content": path.read_text(encoding="utf-8")}


# ── Internals ──────────────────────────────────────────────────────────────

def _push(job_id: str, msg: str, type_: str = "info"):
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]["logs"].append({"msg": msg, "type": type_})


def _cleanup_old_jobs():
    """Remove oldest finished jobs when store exceeds MAX_JOBS.
    Must be called while holding _jobs_lock."""
    finished = [
        (jid, j) for jid, j in _jobs.items()
        if j["status"] in ("done", "error")
    ]
    finished.sort(key=lambda x: x[1].get("created_at", 0))
    for jid, _ in finished[:len(finished) // 2]:
        del _jobs[jid]


def _run_job(job_id: str, req: RunRequest):
    try:
        # Merge server-side defaults for fields the frontend didn't provide.
        # Prefer env-var defaults; fall back to locally saved .user_config.json
        # so the browser extension (which sends empty configs) also works.
        srv = _get_server_defaults() or _get_local_config_defaults()
        if srv:
            req.reader = _merge_runtime_llm_config(req.reader, srv["reader"])
            req.thinker = _merge_runtime_llm_config(req.thinker, srv["thinker"])
            if not req.bilibili_sessdata and srv.get("bilibili_sessdata"):
                req.bilibili_sessdata = srv["bilibili_sessdata"]

        # ── URL 规范化：从分享文本提取 + 还原短链 ──
        _push(job_id, "🔍 解析视频链接...", "info")
        extracted = extract_first_url(req.video_url)
        if extracted:
            req.video_url = extracted
        normalized_url = normalize_video_url(req.video_url)
        if normalized_url != req.video_url:
            _push(job_id, f"   ✓ 链接已规范化: {normalized_url}", "success")
            req.video_url = normalized_url

        _push(job_id, "📥 Stage 0: 采集评论...", "stage")

        # Build a minimal config dict for the scraper
        config: dict = {
            "youtube": {},
            "bilibili": {},
            "max_comments": req.max_comments,
        }
        yt_key = req.reader.get("youtube_api_key") or (srv or {}).get("youtube_api_key", "")
        if yt_key:
            config["youtube"]["api_key"] = yt_key
        else:
            cfg_path = Path("config.yaml")
            if cfg_path.exists():
                try:
                    saved = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
                    config["youtube"] = saved.get("youtube", {})
                except Exception:
                    pass

        if req.bilibili_sessdata:
            config["bilibili"]["sessdata"] = req.bilibili_sessdata

        scraper = create_scraper(req.video_url, config)
        raw = scraper.fetch_comments(req.video_url, max_count=req.max_comments)
        _push(job_id, f"   ✓ 抓取到 {len(raw)} 条原始评论", "success")

        if not raw:
            _push(job_id, "⚠️ 未抓取到任何评论（视频可能关闭了评论或 API Key 无效）", "error")
            with _jobs_lock:
                _jobs[job_id]["status"] = "error"
            return

        _push(job_id, "🧹 硬筛去垃圾...", "stage")
        filtered = prefilter(raw)
        removed = len(raw) - len(filtered)
        _push(job_id, f"   ✓ 硬筛后剩余 {len(filtered)} 条（去除 {removed} 条垃圾）", "success")

        if not filtered:
            _push(job_id, "⚠️ 硬筛后无剩余评论（全部为垃圾内容）", "error")
            with _jobs_lock:
                _jobs[job_id]["status"] = "error"
            return

        video_context = {
            "video_id": scraper.video_id,
            "title": req.video_title or req.video_url,
            "brief": req.video_brief,
        }
        with _jobs_lock:
            _jobs[job_id]["video_id"] = scraper.video_id

        # Stage 1
        _push(job_id, f"📖 Stage 1: LLM 精读 ({req.reader.get('model', '?')}, 每批保留≤{req.keep_per_batch})...", "stage")
        reader_cfg = {
            "provider": req.reader.get("provider", "openai_compatible"),
            "model": req.reader.get("model", ""),
            "base_url": req.reader.get("baseUrl", ""),
            "api_key": req.reader.get("apiKey", ""),
            "temperature": req.reader.get("temperature", 0.2),
            "max_tokens": req.reader.get("maxTokens", 2048),
        }
        reader_llm = LLMClient(reader_cfg)

        class LoggingReader(LLMReader):
            def _append_gems(self, llm_response, batch_idx):
                super()._append_gems(llm_response, batch_idx)
                kept = llm_response.count("KEEP #") if "PASS ALL" not in llm_response else 0
                _push(job_id, f"   Batch {batch_idx + 1} → KEEP {kept} 条")

        reader = LoggingReader(reader_llm, video_context, keep_per_batch=req.keep_per_batch)
        gems_path = reader.read_all(filtered)
        _push(job_id, f"   ✓ 精读完成，gems.md：{reader.kept_count} 条精华评论", "success")

        # Stage 2
        mode_label = "深度研究" if req.report_mode == "deep" else "快速洞察"
        lang_label = {"zh": "中文", "en": "English", "de": "Deutsch"}.get(req.report_language, "中文")
        _push(job_id, f"🧠 Stage 2: {mode_label}报告 ({lang_label}) ({req.thinker.get('model', '?')})...", "stage")
        thinker_cfg = {
            "provider": req.thinker.get("provider", "openai_compatible"),
            "model": req.thinker.get("model", ""),
            "base_url": req.thinker.get("baseUrl", ""),
            "api_key": req.thinker.get("apiKey", ""),
            "temperature": req.thinker.get("temperature", 0.6),
            "max_tokens": req.thinker.get("maxTokens", 8192 if req.report_mode != "deep" else 16384),
        }
        writer_llm = LLMClient(thinker_cfg)
        writer = ReportWriter(writer_llm, mode=req.report_mode, language=req.report_language)
        report_path = writer.generate(gems_path, video_context)
        _push(job_id, f"   ✓ 报告已生成: {report_path}", "success")

        _push(job_id, "✅ Pipeline 完成", "done")
        with _jobs_lock:
            _jobs[job_id]["status"] = "done"

    except Exception as e:
        _push(job_id, f"❌ 错误: {e}", "error")
        _push(job_id, traceback.format_exc(), "error")
        with _jobs_lock:
            _jobs[job_id]["status"] = "error"


async def _event_generator(job_id: str) -> AsyncGenerator[str, None]:
    sent = 0
    while True:
        job = _jobs.get(job_id, {})
        logs = job.get("logs", [])

        while sent < len(logs):
            entry = logs[sent]
            yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
            sent += 1

        if job.get("status") in ("done", "error"):
            yield f"data: {json.dumps({'msg': '__END__', 'type': 'end'})}\n\n"
            break

        await asyncio.sleep(0.3)


# Serve frontend static files (must be AFTER all /api routes)
_dist = Path(__file__).parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="static")


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port)
