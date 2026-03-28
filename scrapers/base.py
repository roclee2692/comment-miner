from dataclasses import dataclass, field


@dataclass
class Comment:
    text: str
    author: str
    likes: int = 0
    reply_count: int = 0
    video_id: str = ""
    comment_id: str = ""
