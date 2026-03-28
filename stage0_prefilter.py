import re
import hashlib
from scrapers.base import Comment

SPAM_PATTERNS = [
    r"关注我", r"互关", r"求关注", r"私信",
    r"加微信", r"v信", r"免费领", r"点击链接",
    r"subscribe", r"check my channel",
]


def prefilter(comments: list[Comment]) -> list[Comment]:
    """Stage 0: 规则硬筛，只去垃圾，不判断质量。"""
    seen = set()
    result = []

    for c in comments:
        text = c.text.strip()

        # 1. 太短
        if len(text) < 15:
            continue

        # 2. 纯表情 / 纯标点
        content = re.sub(r"[^\w\u4e00-\u9fffa-zA-Z]", "", text)
        if len(content) < 8:
            continue

        # 3. 去重（前 80 字指纹）
        fingerprint = hashlib.md5(text[:80].encode()).hexdigest()[:10]
        if fingerprint in seen:
            continue
        seen.add(fingerprint)

        # 4. 机器人 / 广告
        if any(re.search(p, text, re.IGNORECASE) for p in SPAM_PATTERNS):
            continue

        result.append(c)

    return result
