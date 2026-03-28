import re
import time
import requests
from .base import Comment


class BilibiliScraper:
    """B站评论采集器 — 使用公开 API，无需登录/Key"""

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com",
    }

    def __init__(self):
        self._video_id = ""
        self._session = requests.Session()
        self._session.headers.update(self.HEADERS)

    @property
    def video_id(self) -> str:
        return self._video_id

    def fetch_comments(self, url: str, max_count: int = 5000) -> list[Comment]:
        self._video_id = self._extract_bvid(url)
        oid = self._bvid_to_oid(self._video_id)

        comments = []
        next_offset = 0
        page = 1

        while len(comments) < max_count:
            params = {
                "type": 1,           # 1 = 视频评论
                "oid": oid,
                "mode": 3,           # 3 = 按热度排序
                "next": next_offset,
                "ps": 20,            # 每页条数
            }

            try:
                resp = self._session.get(
                    "https://api.bilibili.com/x/v2/reply/main",
                    params=params,
                    timeout=15,
                )
            except requests.ConnectionError:
                raise ConnectionError("无法连接 B站 API，请检查网络")
            except requests.Timeout:
                raise TimeoutError("B站 API 请求超时")

            if resp.status_code != 200:
                raise RuntimeError(f"B站 API 返回 {resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            if data.get("code") != 0:
                msg = data.get("message", "未知错误")
                raise RuntimeError(f"B站 API 错误 ({data.get('code')}): {msg}")

            replies = data.get("data", {}).get("replies") or []
            if not replies:
                break

            for r in replies:
                content = r.get("content", {})
                member = r.get("member", {})
                comments.append(Comment(
                    text=content.get("message", ""),
                    author=member.get("uname", ""),
                    likes=r.get("like", 0),
                    reply_count=r.get("rcount", 0),
                    video_id=self._video_id,
                    comment_id=str(r.get("rpid", "")),
                ))

            # 游标翻页
            cursor = data.get("data", {}).get("cursor", {})
            if cursor.get("is_end", True):
                break
            next_offset = cursor.get("next", 0)

            page += 1
            # 反爬：每页间隔 0.5s
            time.sleep(0.5)

        return comments

    def _bvid_to_oid(self, bvid: str) -> int:
        """BV号 → aid（评论 API 的 oid 就是 aid）"""
        resp = self._session.get(
            "https://api.bilibili.com/x/web-interface/view",
            params={"bvid": bvid},
            timeout=10,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"获取视频信息失败: HTTP {resp.status_code}")

        data = resp.json()
        if data.get("code") != 0:
            msg = data.get("message", "未知错误")
            raise RuntimeError(f"获取视频信息失败: {msg}（BV号可能无效）")

        return data["data"]["aid"]

    @staticmethod
    def _extract_bvid(url: str) -> str:
        """从 URL 中提取 BV 号"""
        # 支持格式：
        #   https://www.bilibili.com/video/BV1xx...
        #   https://b23.tv/BV1xx...
        #   https://www.bilibili.com/video/av12345  (旧格式)
        m = re.search(r"(BV[A-Za-z0-9]{10})", url)
        if m:
            return m.group(1)

        # av号格式
        m = re.search(r"av(\d+)", url, re.IGNORECASE)
        if m:
            raise ValueError(
                f"检测到 av 号格式，请使用 BV 号格式的链接（在 B站 打开视频后从地址栏复制）"
            )

        raise ValueError(f"无法从链接中提取 B站视频 ID: {url}")
