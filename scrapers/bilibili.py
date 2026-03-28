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
        self._init_cookies()

    @property
    def video_id(self) -> str:
        return self._video_id

    def _init_cookies(self):
        """访问主站 + SPI 接口获取必要的反爬 Cookie"""
        try:
            self._session.get("https://www.bilibili.com", timeout=10)
            spi = self._session.get(
                "https://api.bilibili.com/x/frontend/finger/spi", timeout=10
            ).json().get("data", {})
            if spi.get("b_3"):
                self._session.cookies.set("buvid3", spi["b_3"], domain=".bilibili.com")
            if spi.get("b_4"):
                self._session.cookies.set("buvid4", spi["b_4"], domain=".bilibili.com")
        except Exception:
            pass  # Cookie 初始化失败不影响旧版 API

    def fetch_comments(self, url: str, max_count: int = 5000) -> list[Comment]:
        self._video_id = self._extract_bvid(url)
        oid = self._bvid_to_oid(self._video_id)

        comments = []
        page = 1

        while len(comments) < max_count:
            params = {
                "type": 1,        # 1 = 视频评论
                "oid": oid,
                "pn": page,       # 页码
                "ps": 20,         # 每页条数
                "sort": 2,        # 0=按时间, 2=按热度
            }

            try:
                resp = self._session.get(
                    "https://api.bilibili.com/x/v2/reply",
                    params=params,
                    timeout=15,
                )
            except requests.ConnectionError:
                raise ConnectionError("无法连接 B站 API，请检查网络")
            except requests.Timeout:
                raise TimeoutError("B站 API 请求超时")

            if resp.status_code != 200:
                raise RuntimeError(f"B站 API 返回 {resp.status_code}")

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

    def _extract_bvid(self, url: str) -> str:
        """从 URL 中提取 BV 号，支持短链接跳转"""
        # 1. 直接从 URL 中找 BV 号
        m = re.search(r"(BV[A-Za-z0-9]{10,12})", url)
        if m:
            return m.group(1)

        # 2. b23.tv 短链接：跟踪跳转获取真实 URL
        if "b23.tv" in url:
            try:
                resp = self._session.head(url, allow_redirects=True, timeout=10)
                real_url = resp.url
                m = re.search(r"(BV[A-Za-z0-9]{10,12})", real_url)
                if m:
                    return m.group(1)
            except Exception:
                pass
            raise ValueError("B站短链接解析失败，请直接使用完整的 bilibili.com 视频链接")

        # 3. av号格式
        m = re.search(r"av(\d+)", url, re.IGNORECASE)
        if m:
            raise ValueError(
                "检测到 av 号格式，请使用 BV 号格式的链接（在 B站 打开视频后从地址栏复制）"
            )

        raise ValueError(f"无法从链接中提取 B站视频 ID: {url}")
