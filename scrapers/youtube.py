import re
import requests
from .base import Comment


class YouTubeScraper:
    API_BASE = "https://www.googleapis.com/youtube/v3"

    def __init__(self, api_key: str):
        self.api_key = api_key

    @property
    def video_id(self) -> str:
        return self._video_id

    def fetch_comments(self, url: str, max_count: int = 5000) -> list[Comment]:
        self._video_id = self._extract_video_id(url)
        comments = []
        page_token = None

        while len(comments) < max_count:
            params = {
                "part": "snippet",
                "videoId": self._video_id,
                "maxResults": min(100, max_count - len(comments)),
                "order": "relevance",
                "key": self.api_key,
            }
            if page_token:
                params["pageToken"] = page_token

            try:
                resp = requests.get(f"{self.API_BASE}/commentThreads", params=params, timeout=30)
            except requests.ConnectionError:
                raise ConnectionError("无法连接 YouTube API，请检查网络")
            except requests.Timeout:
                raise TimeoutError("YouTube API 请求超时")

            if resp.status_code == 403:
                error_detail = resp.json().get("error", {}).get("message", resp.text[:200])
                raise RuntimeError(
                    f"YouTube API 返回 403: {error_detail}\n"
                    "可能原因：API Key 无效、未启用 YouTube Data API v3、或超出每日配额"
                )
            if resp.status_code != 200:
                raise RuntimeError(f"YouTube API 返回 {resp.status_code}: {resp.text[:200]}")

            data = resp.json()

            for item in data.get("items", []):
                try:
                    snippet = item["snippet"]["topLevelComment"]["snippet"]
                    comments.append(Comment(
                        text=snippet.get("textDisplay", ""),
                        author=snippet.get("authorDisplayName", ""),
                        likes=snippet.get("likeCount", 0),
                        reply_count=item["snippet"].get("totalReplyCount", 0),
                        video_id=self._video_id,
                        comment_id=item.get("id", ""),
                    ))
                except (KeyError, TypeError):
                    continue

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return comments

    @staticmethod
    def _extract_video_id(url: str) -> str:
        patterns = [
            r"(?:v=|youtu\.be/)([A-Za-z0-9_-]{11})",
            r"(?:embed/)([A-Za-z0-9_-]{11})",
        ]
        for pattern in patterns:
            m = re.search(pattern, url)
            if m:
                return m.group(1)
        raise ValueError(f"Cannot extract video ID from URL: {url}")
