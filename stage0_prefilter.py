import re
import hashlib
from scrapers.base import Comment

SPAM_PATTERNS = [
    r"关注我", r"互关", r"求关注", r"私信",
    r"加微信", r"v信", r"免费领", r"点击链接",
    r"subscribe", r"check my channel",
]

# 纯情绪 / 纯赞同 / 零信息量的短评（完整匹配或作为主体内容）
LOW_VALUE_PATTERNS = [
    # 中文
    r"^(说得|讲得|太)?好了?[!！。.~]*$",
    r"^太[对真好牛强棒绝]了[!！。.~吧]*$",
    r"^(确实|真的|对的|没错|可不是|就是说|属实|中肯)[!！。.~嘛呢啊]*$",
    r"^(学到了|涨知识了|受教了|长见识了|记笔记)[!！。.~]*$",
    r"^(哈哈|哈哈哈|笑死|绝了|泪目|破防了|6666|啊这|好家伙|离谱|草)[哈嗝了!！。.~6]*$",
    r"^(顶|支持|赞|up主?[牛厉害]|加油|冲|转发了|已收藏|马[了克]|mark|催更)[!！。.~了]+$",
    r"^(第一|前排|沙发|来了|打卡|签到|报道|火钳刘明)[!！。.~]*$",
    r"^[\+＋1１一]+$",
    r"^同[意感上]?[!！。.~]*$",
    # 英文
    r"^(lol|lmao|nice|cool|great|amazing|awesome|wow|true|facts?|this|same|agreed|exactly|underrated)[!.~\s]*$",
    r"^(first|subscribe|like if|who('s| is) (here|watching)|edit: thanks)[!.~\s]*$",
]

_low_value_re = [re.compile(p, re.IGNORECASE) for p in LOW_VALUE_PATTERNS]


def prefilter(comments: list[Comment]) -> list[Comment]:
    """Stage 0: 规则硬筛，去垃圾和低信息量评论，不做质量判断。"""
    seen = set()
    result = []

    for c in comments:
        text = (c.text or "").strip()

        # 1. 太短（主评论 ≥ 50 字，子评论 ≥ 25 字 — 子评论有上下文所以放宽）
        min_len = 25 if c.parent_id else 50
        if len(text) < min_len:
            continue

        # 2. 纯表情 / 纯标点
        content = re.sub(r"[^\w\u4e00-\u9fffa-zA-Z]", "", text)
        if len(content) < 10:
            continue

        # 3. 去重（前 80 字指纹）
        fingerprint = hashlib.md5(text[:80].encode()).hexdigest()[:10]
        if fingerprint in seen:
            continue
        seen.add(fingerprint)

        # 4. 机器人 / 广告
        if any(re.search(p, text, re.IGNORECASE) for p in SPAM_PATTERNS):
            continue

        # 5. 低信息量短评（纯赞同、纯情绪、打卡等）
        text_stripped = re.sub(r"[\s\u200b]+", "", text)  # 去空白
        if len(text_stripped) < 30 and any(p.search(text_stripped) for p in _low_value_re):
            continue

        result.append(c)

    return result
