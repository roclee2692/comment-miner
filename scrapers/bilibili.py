import hashlib
import hmac
import re
import time
import uuid
from functools import reduce
from urllib.parse import unquote, urlencode

import requests
from .base import Comment


# ── Wbi 签名（B站反爬必需） ──────────────────────────────────────────────
_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


def _get_mixin_key(orig: str) -> str:
    return reduce(lambda s, i: s + orig[i], _MIXIN_KEY_ENC_TAB, "")[:32]


def _sign_wbi(params: dict, img_key: str, sub_key: str) -> dict:
    """给请求参数加上 Wbi 签名 (w_rid + wts)"""
    mixin_key = _get_mixin_key(img_key + sub_key)
    params = dict(params)
    params["wts"] = int(time.time())
    params = dict(sorted(params.items()))
    # 过滤 value 中的特殊字符（B站要求）
    params = {
        k: "".join(ch for ch in str(v) if ch not in "!'()*")
        for k, v in params.items()
    }
    query = urlencode(params)
    params["w_rid"] = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return params


class BilibiliScraper:
    """B站评论采集器 — Wbi 签名 + bili_ticket + Cookie 认证"""

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com",
        "Origin": "https://www.bilibili.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    # bili_ticket HMAC key (公开的固定值)
    _TICKET_HMAC_KEY = "XgwSnGZ1p"

    def __init__(self, sessdata: str = ""):
        self._video_id = ""
        self._session = requests.Session()
        self._session.headers.update(self.HEADERS)
        self._img_key = ""
        self._sub_key = ""

        if sessdata:
            sessdata = unquote(sessdata).strip()
            self._session.cookies.set("SESSDATA", sessdata, domain=".bilibili.com")

        # 1. 获取 buvid 指纹 Cookie
        self._init_buvid()
        # 2. 获取 bili_ticket（评论 API 所需）
        self._init_bili_ticket()
        # 3. 获取 Wbi 签名密钥
        self._init_wbi_keys()

        print(f"  [Bilibili] buvid3={'buvid3' in self._cookie_names}, "
              f"bili_ticket={'bili_ticket' in self._cookie_names}, "
              f"wbi_keys={'Y' if self._img_key else 'N'}, "
              f"SESSDATA={'Y' if sessdata else 'N'}")

    @property
    def _cookie_names(self) -> set:
        return {c.name for c in self._session.cookies}

    @property
    def video_id(self) -> str:
        return self._video_id

    def _init_buvid(self):
        """获取 buvid3/buvid4 指纹 Cookie"""
        try:
            self._session.get("https://www.bilibili.com", timeout=10)
        except Exception:
            pass

        try:
            spi = self._session.get(
                "https://api.bilibili.com/x/frontend/finger/spi", timeout=10
            ).json().get("data", {})
            if spi.get("b_3"):
                self._session.cookies.set("buvid3", spi["b_3"], domain=".bilibili.com")
            if spi.get("b_4"):
                self._session.cookies.set("buvid4", spi["b_4"], domain=".bilibili.com")
        except Exception:
            # 没有 buvid 也可以尝试，不致命
            pass

        # 生成 buvid_fp（浏览器指纹，部分 API 需要）
        if "buvid_fp" not in self._cookie_names:
            fp = hashlib.md5(uuid.uuid4().bytes).hexdigest()
            self._session.cookies.set("buvid_fp", fp, domain=".bilibili.com")

    def _init_bili_ticket(self):
        """获取 bili_ticket — 评论等 API 的反爬校验需要"""
        try:
            ts = int(time.time())
            hex_sign = hmac.new(
                self._TICKET_HMAC_KEY.encode(),
                f"ts{ts}".encode(),
                hashlib.sha256,
            ).hexdigest()

            resp = self._session.post(
                "https://api.bilibili.com/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket",
                params={
                    "key_id": "ec02",
                    "hexsign": hex_sign,
                    "context[ts]": str(ts),
                    "csrf": "",
                },
                timeout=10,
            )
            data = resp.json()
            if data.get("code") == 0:
                ticket = data["data"]["ticket"]
                self._session.cookies.set("bili_ticket", ticket, domain=".bilibili.com")
                # bili_ticket_expires
                exp = data["data"].get("created_at", ts) + data["data"].get("ttl", 259200)
                self._session.cookies.set("bili_ticket_expires", str(exp), domain=".bilibili.com")
        except Exception:
            pass

    def _init_wbi_keys(self):
        """从 nav 接口获取 Wbi 签名所需的 img_key 和 sub_key"""
        try:
            resp = self._session.get(
                "https://api.bilibili.com/x/web-interface/nav", timeout=10
            )
            data = resp.json().get("data", {})
            wbi_img = data.get("wbi_img", {})
            img_url = wbi_img.get("img_url", "")
            sub_url = wbi_img.get("sub_url", "")
            self._img_key = img_url.rsplit("/", 1)[-1].split(".")[0] if img_url else ""
            self._sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0] if sub_url else ""
        except Exception:
            pass

    def _signed_params(self, params: dict) -> dict:
        if self._img_key and self._sub_key:
            return _sign_wbi(params, self._img_key, self._sub_key)
        return params

    def fetch_comments(self, url: str, max_count: int = 5000) -> list[Comment]:
        self._video_id = self._extract_bvid(url)
        oid = self._bvid_to_oid(self._video_id)

        # 优先新版 API（游标翻页），失败则降级旧版
        try:
            return self._fetch_new_api(oid, max_count)
        except RuntimeError as e:
            if "412" in str(e):
                try:
                    return self._fetch_old_api(oid, max_count)
                except RuntimeError as e2:
                    if "412" in str(e2):
                        raise RuntimeError(
                            "B站评论 API 持续拦截 (412)。\n"
                            "请尝试以下方案：\n"
                            "1. 在前端填入你的 B站 SESSDATA Cookie\n"
                            "2. 换一个网络（如关闭 VPN 或换热点）\n"
                            "3. 等待几分钟后重试\n"
                            "获取 SESSDATA：浏览器登录 B站 → F12 → Application → Cookies → 复制 SESSDATA"
                        )
                    raise
            raise

    def _fetch_new_api(self, oid: int, max_count: int) -> list[Comment]:
        comments = []
        next_offset = 0

        while len(comments) < max_count:
            params = self._signed_params({
                "type": 1,
                "oid": oid,
                "mode": 3,
                "next": next_offset,
                "ps": 20,
            })

            # /wbi/main 是当前有效的评论端点（需 Wbi 签名）
            resp = self._request("https://api.bilibili.com/x/v2/reply/wbi/main", params)
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
        comments = []
        page = 1

        while len(comments) < max_count:
            params = self._signed_params({
                "type": 1,
                "oid": oid,
                "pn": page,
                "ps": 20,
                "sort": 2,
            })

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
        # 评论请求用视频页面作为 Referer（更像真实浏览器）
        headers = {}
        if self._video_id:
            headers["Referer"] = f"https://www.bilibili.com/video/{self._video_id}"

        try:
            resp = self._session.get(url, params=params, headers=headers, timeout=15)
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

        try:
            data = resp.json()
        except ValueError:
            raise RuntimeError(f"B站 API 返回了无效的响应: {resp.text[:200]}")

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
        params = self._signed_params({"bvid": bvid})
        try:
            resp = self._session.get(
                "https://api.bilibili.com/x/web-interface/view",
                params=params,
                timeout=10,
            )
        except requests.ConnectionError:
            raise ConnectionError("无法连接 B站，请检查网络")
        except requests.Timeout:
            raise TimeoutError("获取视频信息超时")

        if resp.status_code != 200:
            raise RuntimeError(f"获取视频信息失败: HTTP {resp.status_code}")

        data = resp.json()
        if data.get("code") != 0:
            msg = data.get("message", "未知错误")
            raise RuntimeError(f"获取视频信息失败: {msg}（BV号可能无效）")

        return data["data"]["aid"]

    def _extract_bvid(self, url: str) -> str:
        m = re.search(r"(BV[A-Za-z0-9]{10,12})", url)
        if m:
            return m.group(1)

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
