from .youtube import YouTubeScraper


def create_scraper(url: str, config: dict):
    if "youtube.com" in url or "youtu.be" in url:
        api_key = config.get("youtube", {}).get("api_key", "")
        if not api_key:
            raise ValueError("YouTube API key not set in config.yaml (youtube.api_key)")
        return YouTubeScraper(api_key)
    raise ValueError(f"Unsupported URL: {url}")
