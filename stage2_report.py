from pathlib import Path

PROMPTS_DIR = Path(__file__).parent / "prompts"


class ReportWriter:
    def __init__(self, llm_client):
        self.llm = llm_client
        self._system_prompt = (PROMPTS_DIR / "reporter.txt").read_text(encoding="utf-8")

    def generate(self, gems_path: str, video_context: dict) -> str:
        gems_content = Path(gems_path).read_text(encoding="utf-8")

        if len(gems_content) > 80000:
            gems_content = self._truncate_smart(gems_content, limit=80000)

        user_msg = (
            f"## 视频信息\n"
            f"标题：{video_context['title']}\n"
            f"简介：{video_context.get('brief', '')}\n\n"
            f"## 精华评论合集（gems.md）\n\n{gems_content}"
        )

        response = self.llm.generate(
            system=self._system_prompt,
            user=user_msg,
        )

        report_path = Path(f"reports/{video_context['video_id']}_report.md")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(response, encoding="utf-8")
        return str(report_path)

    @staticmethod
    def _truncate_smart(text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        blocks = text.split("---")
        half = max(len(blocks) // 4, 1)
        keep = blocks[:half] + ["\n\n... (中间部分省略) ...\n\n"] + blocks[-half:]
        return "---".join(keep)[:limit]
