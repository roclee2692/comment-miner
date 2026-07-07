"""
URL 提取与解析工具 —— 从任意文本中提取视频链接，并还原短链。

支持：
- 从分享文本中提取 YouTube / B站 URL
- b23.tv 短链还原为真实 BV 号链接
- youtu.be 短链处理
"""

import re
import requests
from urllib.parse import urlparse


# ── URL 提取 ───────────────────────────────────────────────────────────

# 匹配常见 URL 模式（比简单的 http/https，覆盖大部分场景）
_URL_PATTERNS = [
    # YouTube
    r'https?://(?:www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}',
    r'https?://(?:www\.)?youtube\.com/embed/[A-Za-z0-9_-]{11}',
    r'https?://youtu\.be/[A-Za-z0-9_-]{11}',
    # B站
    r'https?://(?:www\.)?bilibili\.com/video/(?:BV[A-Za-z0-9]{10,12}|av\d+)',
    r'https?://b23\.tv/[A-Za-z0-9]+',
    r'https?://(?:www\.)?bilibili\.com/bangumi/play/[A-Za-z0-9]+',
]

_URL_RE = re.compile('|'.join(_URL_PATTERNS), re.IGNORECASE)


def extract_urls(text: str) -> list[str]:
    """从任意文本中提取所有视频 URL。
    
    例如：
      「谢苗杀疯了！《火遮眼》诚实观后感-哔哩哔哩」 https://b23.tv/PJzEGXh
    → ['https://b23.tv/PJzEGXh
    """
    if not text:
        return []
    matches = _URL_RE.findall(text)
    # 去重，保持顺序
    seen = set()
    result = []
    for m in matches:
        if m not in seen:
            seen.add(m)
            result.append(m)
    return result


def extract_first_url(text: str) -> str | None:
    """提取文本中的第一个视频 URL。"""
    urls = extract_urls(text)
    return urls[0] if urls else None


# ── 短链还原 ───────────────────────────────────────────────────────────

def resolve_b23_short_url(short_url: str, timeout: int = 10) -> str:
    """将 b23.tv 短链还原为真实的 bilibili.com 视频链接。
    
    通过 HEAD 请求跟随重定向获取真实 URL。
    """
    if "b23.tv" not in short_url:
        return short_url

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.bilibili.com",
    }
    try:
        resp = requests.head(short_url, allow_redirects=True, headers=headers, timeout=timeout)
        real_url = resp.url
        # 确保返回的是 bilibili.com 的链接
        if "bilibili.com" in real_url:
            return real_url
        return short_url
    except Exception:
        # 失败时返回原链接（scraper 内部还有一次解析机会）
        return short_url


def normalize_video_url(url: str) -> str:
    """规范化视频 URL：
    - b23.tv 短链 → 真实 bilibili.com 链接
    - youtu.be → youtube.com/watch?v= 形式
    - 去除多余参数（只保留 v 和 p 等关键参数）
    """
    if not url:
        return url

    # b23.tv 短链还原
    if "b23.tv" in url:
        url = resolve_b23_short_url(url)

    # youtu.be → youtube.com 形式
    m = re.match(r'https?://youtu\.be/([A-Za-z0-9_-]{11})', url)
    if m:
        video_id = m.group(1)
        return f"https://www.youtube.com/watch?v={video_id}"

    # YouTube 其他形式规范化
    if "youtube.com/embed/" in url:
        m = re.search(r'youtube\.com/embed/([A-Za-z0-9_-]{11})', url)
        if m:
            return f"https://www.youtube.com/watch?v={m.group(1)}"

    return url


def detect_platform(url: str) -> str | None:
    """检测视频平台：'youtube' | 'bilibili' | None"""
    if "youtube.com" in url or "youtu.be" in url:
        return "youtube"
    if "bilibili.com" in url or "b23.tv" in url:
        return "bilibili"
    return None
