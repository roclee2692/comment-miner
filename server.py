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
import traceback
import uuid
from pathlib import Path
from threading import Thread
from typing import AsyncGenerator

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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

# In-memory job store
_jobs: dict[str, dict] = {}  # job_id → {status, logs, video_id, config}


class RunRequest(BaseModel):
    video_url: str
    video_title: str = ""
    video_brief: str = ""
    max_comments: int = 5000
    reader: dict
    thinker: dict


@app.post("/api/run")
async def run_pipeline(req: RunRequest):
    job_id = uuid.uuid4().hex[:8]
    _jobs[job_id] = {"status": "running", "logs": [], "video_id": None}

    # Run in background thread (LLM calls are blocking)
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


@app.get("/api/gems/{video_id}")
async def get_gems(video_id: str):
    path = Path(f"data/gems_{video_id}.md")
    if not path.exists():
        raise HTTPException(status_code=404, detail="gems.md not found")
    return {"content": path.read_text(encoding="utf-8")}


@app.get("/api/report/{video_id}")
async def get_report(video_id: str):
    path = Path(f"reports/{video_id}_report.md")
    if not path.exists():
        raise HTTPException(status_code=404, detail="report.md not found")
    return {"content": path.read_text(encoding="utf-8")}


# ── Internals ──────────────────────────────────────────────────────────────

def _push(job_id: str, msg: str, type_: str = "info"):
    _jobs[job_id]["logs"].append({"msg": msg, "type": type_})


def _run_job(job_id: str, req: RunRequest):
    job = _jobs[job_id]
    try:
        _push(job_id, "📥 Stage 0: 采集评论...", "stage")

        # Build a minimal config dict for the scraper
        config = {
            "youtube": {},  # api_key comes from reader config or env
            "max_comments": req.max_comments,
        }
        # Allow passing YouTube API key via reader config's extra field
        if req.reader.get("youtube_api_key"):
            config["youtube"]["api_key"] = req.reader["youtube_api_key"]
        else:
            # Fall back to config.yaml if it exists
            cfg_path = Path("config.yaml")
            if cfg_path.exists():
                saved = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
                config["youtube"] = saved.get("youtube", {})

        scraper = create_scraper(req.video_url, config)
        raw = scraper.fetch_comments(req.video_url, max_count=req.max_comments)
        _push(job_id, f"   ✓ 抓取到 {len(raw)} 条原始评论", "success")

        _push(job_id, "🧹 硬筛去垃圾...", "stage")
        filtered = prefilter(raw)
        removed = len(raw) - len(filtered)
        _push(job_id, f"   ✓ 硬筛后剩余 {len(filtered)} 条（去除 {removed} 条垃圾）", "success")

        video_context = {
            "video_id": scraper.video_id,
            "title": req.video_title or req.video_url,
            "brief": req.video_brief,
        }
        job["video_id"] = scraper.video_id

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

        # Wrap LLMReader to emit logs per batch
        class LoggingReader(LLMReader):
            def _append_gems(self, llm_response, batch_idx):
                super()._append_gems(llm_response, batch_idx)
                kept = llm_response.count("KEEP #") if "PASS ALL" not in llm_response else 0
                _push(job_id, f"   Batch {batch_idx + 1} → KEEP {kept} 条")

        reader = LoggingReader(reader_llm, video_context)
        gems_path = reader.read_all(filtered)
        _push(job_id, f"   ✓ 精读完成，gems.md：{reader.kept_count} 条精华评论", "success")

        # Stage 2
        _push(job_id, f"🧠 Stage 2: 思考模型写报告 ({req.thinker.get('model', '?')})...", "stage")
        thinker_cfg = {
            "provider": req.thinker.get("provider", "openai_compatible"),
            "model": req.thinker.get("model", ""),
            "base_url": req.thinker.get("baseUrl", ""),
            "api_key": req.thinker.get("apiKey", ""),
            "temperature": req.thinker.get("temperature", 0.6),
            "max_tokens": req.thinker.get("maxTokens", 8192),
        }
        writer_llm = LLMClient(thinker_cfg)
        writer = ReportWriter(writer_llm)
        report_path = writer.generate(gems_path, video_context)
        _push(job_id, f"   ✓ 报告已生成: {report_path}", "success")

        _push(job_id, "✅ Pipeline 完成", "done")
        job["status"] = "done"

    except Exception as e:
        _push(job_id, f"❌ 错误: {e}", "error")
        _push(job_id, traceback.format_exc(), "error")
        job["status"] = "error"


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
