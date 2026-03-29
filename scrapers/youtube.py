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
                    main_comment = Comment(
                        text=snippet.get("textDisplay", ""),
                        author=snippet.get("authorDisplayName", ""),
                        likes=snippet.get("likeCount", 0),
                        reply_count=item["snippet"].get("totalReplyCount", 0),
                        video_id=self._video_id,
                        comment_id=item.get("id", ""),
                    )
                    comments.append(main_comment)

                    # 抓取子评论（回复）
                    reply_count = item["snippet"].get("totalReplyCount", 0)
                    if reply_count > 0 and len(comments) < max_count:
                        sub = self._fetch_replies(item["id"], main_comment.author, max_count - len(comments))
                        comments.extend(sub)
                except (KeyError, TypeError):
                    continue

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return comments

    def _fetch_replies(self, parent_id: str, parent_author: str, remaining: int) -> list[Comment]:
        """抓取某条主评论下的回复"""
        replies = []
        page_token = None
        max_per_thread = min(remaining, 100)  # 每条主评论最多抓 100 条回复

        while len(replies) < max_per_thread:
            params = {
                "part": "snippet",
                "parentId": parent_id,
                "maxResults": min(100, max_per_thread - len(replies)),
                "key": self.api_key,
            }
            if page_token:
                params["pageToken"] = page_token

            try:
                resp = requests.get(f"{self.API_BASE}/comments", params=params, timeout=30)
            except (requests.ConnectionError, requests.Timeout):
                break

            if resp.status_code != 200:
                break

            data = resp.json()
            for item in data.get("items", []):
                try:
                    snippet = item["snippet"]
                    replies.append(Comment(
                        text=snippet.get("textDisplay", ""),
                        author=snippet.get("authorDisplayName", ""),
                        likes=snippet.get("likeCount", 0),
                        reply_count=0,
                        video_id=self._video_id,
                        comment_id=item.get("id", ""),
                        parent_id=parent_id,
                        parent_author=parent_author,
                    ))
                except (KeyError, TypeError):
                    continue

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return replies

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
