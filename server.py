"""
FastAPI server — exposes the three-stage pipeline via HTTP + SSE.

Endpoints:
  POST /api/run          Start pipeline (returns job_id)
  GET  /api/stream/{id}  SSE stream of progress logs
  GET  /api/gems/{id}    Return gems.md content
  GET  /api/report/{id}  Return report.md content
  GET  /api/status/{id}  Job status (running / done / error)
"""

import asyncio
import json
import re
import time
import traceback
import uuid
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

app = FastAPI(title="CommentMiner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    reader: dict
    thinker: dict

    @field_validator("max_comments")
    @classmethod
    def clamp_max_comments(cls, v: int) -> int:
        return max(100, min(v, 20000))


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
        _push(job_id, "📥 Stage 0: 采集评论...", "stage")

        # Build a minimal config dict for the scraper
        config: dict = {
            "youtube": {},
            "bilibili": {},
            "max_comments": req.max_comments,
        }
        if req.reader.get("youtube_api_key"):
            config["youtube"]["api_key"] = req.reader["youtube_api_key"]
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
        _push(job_id, f"📖 Stage 1: LLM 精读 ({req.reader.get('model', '?')})...", "stage")
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

        reader = LoggingReader(reader_llm, video_context)
        gems_path = reader.read_all(filtered)
        _push(job_id, f"   ✓ 精读完成，gems.md：{reader.kept_count} 条精华评论", "success")

        # Stage 2
        mode_label = "深度研究" if req.report_mode == "deep" else "快速洞察"
        _push(job_id, f"🧠 Stage 2: {mode_label}报告 ({req.thinker.get('model', '?')})...", "stage")
        thinker_cfg = {
            "provider": req.thinker.get("provider", "openai_compatible"),
            "model": req.thinker.get("model", ""),
            "base_url": req.thinker.get("baseUrl", ""),
            "api_key": req.thinker.get("apiKey", ""),
            "temperature": req.thinker.get("temperature", 0.6),
            "max_tokens": req.thinker.get("maxTokens", 8192 if req.report_mode != "deep" else 16384),
        }
        writer_llm = LLMClient(thinker_cfg)
        writer = ReportWriter(writer_llm, mode=req.report_mode)
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
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
