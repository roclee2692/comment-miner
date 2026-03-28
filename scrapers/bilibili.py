import re
import time
import requests
from .base import Comment


class BilibiliScraper:
    """B站评论采集器 — 使用用户 Cookie 模拟登录访问，稳定可靠"""

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com",
    }

    def __init__(self, sessdata: str = ""):
        self._video_id = ""
        self._session = requests.Session()
        self._session.headers.update(self.HEADERS)

        if sessdata:
            # 用户提供了 SESSDATA，模拟登录状态
            self._session.cookies.set("SESSDATA", sessdata, domain=".bilibili.com")
        else:
            # 未提供则尝试获取匿名 Cookie
            self._init_anonymous()

    @property
    def video_id(self) -> str:
        return self._video_id

    def _init_anonymous(self):
        """匿名模式：获取基本 Cookie"""
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
            pass

    def fetch_comments(self, url: str, max_count: int = 5000) -> list[Comment]:
        self._video_id = self._extract_bvid(url)
        oid = self._bvid_to_oid(self._video_id)

        comments = []

        # 有 SESSDATA 时用新版 API（更稳定），否则用旧版
        has_auth = "SESSDATA" in {c.name for c in self._session.cookies}

        if has_auth:
            comments = self._fetch_new_api(oid, max_count)
        else:
            comments = self._fetch_old_api(oid, max_count)

        return comments

    def _fetch_new_api(self, oid: int, max_count: int) -> list[Comment]:
        """新版 API（需要登录 Cookie），游标翻页"""
        comments = []
        next_offset = 0

        while len(comments) < max_count:
            params = {
                "type": 1,
                "oid": oid,
                "mode": 3,      # 按热度
                "next": next_offset,
                "ps": 20,
            }

            resp = self._request("https://api.bilibili.com/x/v2/reply/main", params)
            replies = resp.get("data", {}).get("replies") or []
            if not replies:
                break

            for r in replies:
                comments.append(self._parse_reply(r))

            cursor = resp.get("data", {}).get("cursor", {})
            if cursor.get("is_end", True):
                break
            next_offset = cursor.get("next", 0)
            time.sleep(0.3)

        return comments

    def _fetch_old_api(self, oid: int, max_count: int) -> list[Comment]:
        """旧版 API（匿名可用），页码翻页"""
        comments = []
        page = 1

        while len(comments) < max_count:
            params = {
                "type": 1,
                "oid": oid,
                "pn": page,
                "ps": 20,
                "sort": 2,      # 按热度
            }

            resp = self._request("https://api.bilibili.com/x/v2/reply", params)
            replies = resp.get("data", {}).get("replies") or []
            if not replies:
                break

            for r in replies:
                comments.append(self._parse_reply(r))

            page += 1
            time.sleep(0.5)

        return comments

    def _request(self, url: str, params: dict) -> dict:
        try:
            resp = self._session.get(url, params=params, timeout=15)
        except requests.ConnectionError:
            raise ConnectionError("无法连接 B站 API，请检查网络")
        except requests.Timeout:
            raise TimeoutError("B站 API 请求超时")

        if resp.status_code == 412:
            raise RuntimeError(
                "B站反爬拦截 (412)，请在前端填入你的 B站 SESSDATA Cookie 后重试。\n"
                "获取方式：浏览器登录 B站 → F12 → Application → Cookies → 复制 SESSDATA 的值"
            )
        if resp.status_code != 200:
            raise RuntimeError(f"B站 API 返回 {resp.status_code}")

        data = resp.json()
        if data.get("code") != 0:
            msg = data.get("message", "未知错误")
            raise RuntimeError(f"B站 API 错误 ({data.get('code')}): {msg}")

        return data

    def _parse_reply(self, r: dict) -> Comment:
        content = r.get("content", {})
        member = r.get("member", {})
        return Comment(
            text=content.get("message", ""),
            author=member.get("uname", ""),
            likes=r.get("like", 0),
            reply_count=r.get("rcount", 0),
            video_id=self._video_id,
            comment_id=str(r.get("rpid", "")),
        )

    def _bvid_to_oid(self, bvid: str) -> int:
        """BV号 → aid"""
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
        """从 URL 中提取 BV 号，支持短链接"""
        m = re.search(r"(BV[A-Za-z0-9]{10,12})", url)
        if m:
            return m.group(1)

        # b23.tv 短链接
        if "b23.tv" in url:
            try:
                resp = self._session.head(url, allow_redirects=True, timeout=10)
                m = re.search(r"(BV[A-Za-z0-9]{10,12})", resp.url)
                if m:
                    return m.group(1)
            except Exception:
                pass
            raise ValueError("B站短链接解析失败，请直接使用完整的 bilibili.com 视频链接")

        m = re.search(r"av(\d+)", url, re.IGNORECASE)
        if m:
            raise ValueError("检测到 av 号格式，请使用 BV 号链接")

        raise ValueError(f"无法从链接中提取 B站视频 ID: {url}")
