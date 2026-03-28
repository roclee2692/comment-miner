import sys
from pathlib import Path

import yaml
from scrapers.factory import create_scraper
from stage0_prefilter import prefilter
from stage1_llm_read import LLMReader
from stage2_report import ReportWriter
from llm.client import LLMClient


def main(video_url: str):
    cfg_path = Path("config.yaml")
    if not cfg_path.exists():
        print("❌ 未找到 config.yaml")
        print("   请先执行: cp config.yaml.example config.yaml")
        print("   然后编辑 config.yaml 填入 API Key 和 LLM 配置")
        sys.exit(1)
    config = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))

    # Stage 0: 采集 + 硬筛
    print("📥 Scraping comments...")
    scraper = create_scraper(video_url, config)
    raw = scraper.fetch_comments(video_url, max_count=config.get("max_comments", 5000))
    print(f"   Got {len(raw)} raw comments")

    print("🧹 Pre-filtering...")
    filtered = prefilter(raw)
    print(f"   {len(filtered)} survived (removed {len(raw) - len(filtered)} junk)")

    video_context = {
        "video_id": scraper.video_id,
        "title": config.get("video_title", video_url),
        "brief": config.get("video_brief", ""),
    }

    # Stage 1: LLM 精读
    print("📖 LLM reading comments...")
    reader_llm = LLMClient(config["llm"]["reader"])
    reader = LLMReader(reader_llm, video_context)
    gems_path = reader.read_all(filtered)
    print(f"   💎 Gems saved to: {gems_path}")
    print(f"   Kept {reader.kept_count} quality comments")

    # Stage 2: 思考模型写报告
    print("🧠 Generating deep report...")
    writer_llm = LLMClient(config["llm"]["thinker"])
    writer = ReportWriter(writer_llm)
    report_path = writer.generate(gems_path, video_context)
    print(f"✅ Report saved to: {report_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python main.py <youtube_url>")
        sys.exit(1)
    main(sys.argv[1])
