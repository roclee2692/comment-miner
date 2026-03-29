from dataclasses import dataclass, field


@dataclass
class Comment:
    text: str
    author: str
    likes: int = 0
    reply_count: int = 0
    video_id: str = ""
    comment_id: str = ""
    parent_id: str = ""       # 非空表示这是子评论（楼中楼回复）
    parent_author: str = ""   # 被回复的作者
