from .youtube import YouTubeScraper
from .bilibili import BilibiliScraper


def create_scraper(url: str, config: dict):
    # YouTube
    if "youtube.com" in url or "youtu.be" in url:
        api_key = config.get("youtube", {}).get("api_key", "")
        if not api_key:
            raise ValueError("YouTube API key not set in config.yaml (youtube.api_key)")
        return YouTubeScraper(api_key)

    # B站
    if "bilibili.com" in url or "b23.tv" in url:
        sessdata = config.get("bilibili", {}).get("sessdata", "")
        return BilibiliScraper(sessdata=sessdata)

    raise ValueError(f"不支持的链接: {url}\n目前支持：YouTube、B站")
