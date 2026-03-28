import math
import re
from datetime import datetime
from pathlib import Path

from scrapers.base import Comment

BATCH_SIZE = 20
PROMPTS_DIR = Path(__file__).parent / "prompts"


class LLMReader:
    def __init__(self, llm_client, video_context: dict):
        self.llm = llm_client
        self.ctx = video_context
        self.gems_path = Path(f"data/gems_{self.ctx['video_id']}.md")
        self.kept_count = 0
        self._system_prompt = (PROMPTS_DIR / "reader.txt").read_text(encoding="utf-8")

    def read_all(self, comments: list[Comment]) -> str:
        # 断点恢复：从上次中断的 batch 继续
        start_batch = self._resume_from()
        if start_batch > 0:
            print(f"  ↩️  Resuming from batch {start_batch + 1}")
        else:
            self._init_gems_file()

        total_batches = math.ceil(len(comments) / BATCH_SIZE)

        for batch_idx in range(start_batch, total_batches):
            start = batch_idx * BATCH_SIZE
            end = min(start + BATCH_SIZE, len(comments))
            batch = comments[start:end]

            print(f"  📖 Batch {batch_idx + 1}/{total_batches} "
                  f"(#{start + 1}-{end})")

            batch_text = self._format_batch(batch, start_idx=start)
            system = self._system_prompt.format(
                video_title=self.ctx["title"],
                video_brief=self.ctx.get("brief", ""),
            )
            user_msg = (
                f"## 本批评论（第 {start + 1}-{end} 条）\n\n{batch_text}"
            )

            try:
                response = self.llm.generate(system=system, user=user_msg)
                self._append_gems(response, batch_idx)
            except Exception as e:
                self._append_error(batch_idx, str(e))
                print(f"  ⚠️  Batch {batch_idx + 1} failed: {e}, skipping...")

        self._finalize()
        return str(self.gems_path)

    # ------------------------------------------------------------------
    def _init_gems_file(self):
        self.gems_path.parent.mkdir(parents=True, exist_ok=True)
        header = (
            f"# 💎 精华评论收集 — {self.ctx['title']}\n\n"
            f"> 由 LLM 精读筛选，Stage 1 自动生成  \n"
            f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n---\n\n"
        )
        self.gems_path.write_text(header, encoding="utf-8")

    def _format_batch(self, batch: list[Comment], start_idx: int) -> str:
        lines = []
        for i, c in enumerate(batch):
            idx = start_idx + i + 1
            lines.append(f"### #{idx} @{c.author} | 👍{c.likes} | 💬{c.reply_count}")
            lines.append(c.text)
            lines.append("")
        return "\n".join(lines)

    def _append_gems(self, llm_response: str, batch_idx: int):
        response = llm_response.strip()
        # PASS ALL: only if the response is essentially just "PASS ALL" (not embedded in longer text)
        if response == "PASS ALL" or response.startswith("PASS ALL") and len(response) < 30:
            with open(self.gems_path, "a", encoding="utf-8") as f:
                f.write(f"<!-- Batch {batch_idx + 1}: PASS ALL -->\n")
            return

        with open(self.gems_path, "a", encoding="utf-8") as f:
            f.write(f"\n<!-- Batch {batch_idx + 1} -->\n")
            f.write(response)
            f.write("\n\n---\n\n")

        self.kept_count += response.count("KEEP #")

    def _append_error(self, batch_idx: int, error: str):
        with open(self.gems_path, "a", encoding="utf-8") as f:
            f.write(f"\n<!-- ⚠️ Batch {batch_idx + 1} FAILED: {error} -->\n\n")

    def _finalize(self):
        with open(self.gems_path, "a", encoding="utf-8") as f:
            f.write(f"\n---\n\n**统计：共筛选出 {self.kept_count} 条精华评论**\n")

    def _resume_from(self) -> int:
        if not self.gems_path.exists():
            return 0
        content = self.gems_path.read_text(encoding="utf-8")
        batches = re.findall(r"<!-- Batch (\d+)", content)
        if batches:
            self.kept_count = content.count("KEEP #")
            return int(batches[-1])  # continue from next batch
        return 0
