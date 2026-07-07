from pathlib import Path

PROMPTS_DIR = Path(__file__).parent / "prompts"

# 两种报告模式的 prompt
_PROMPTS = {
    "quick": PROMPTS_DIR / "reporter_quick.txt",
    "deep":  PROMPTS_DIR / "reporter_deep.txt",
}

# 报告输出语言指令（在系统 prompt 前注入，控制最终输出语言）
# 注意：这只控制 Stage2 报告的输出语言，不影响 Stage1 精读（精读可读任意语言评论）
_LANG_INSTRUCTIONS = {
    "zh": "",  # 默认中文，无需额外指令
    "en": "IMPORTANT: You MUST write the entire report in English. All sections, headings, analysis, and commentary must be in English. Do not write in Chinese.\n\n",
    "de": "WICHTIG: Du MUSST den gesamten Bericht auf Deutsch schreiben. Alle Abschnitte, Überschriften, Analysen und Kommentare müssen auf Deutsch sein. Schreibe nicht auf Chinesisch.\n\n",
}


class ReportWriter:
    def __init__(self, llm_client, mode: str = "quick", language: str = "zh"):
        self.llm = llm_client
        self.mode = mode if mode in _PROMPTS else "quick"
        self.language = language if language in _LANG_INSTRUCTIONS else "zh"
        prompt_path = _PROMPTS[self.mode]
        if not prompt_path.exists():
            raise FileNotFoundError(f"报告 prompt 文件不存在: {prompt_path}")
        
        base_prompt = prompt_path.read_text(encoding="utf-8")
        # 注入语言指令（只控制输出语言，不改变分析逻辑）
        lang_instruction = _LANG_INSTRUCTIONS.get(self.language, "")
        self._system_prompt = lang_instruction + base_prompt

    def generate(self, gems_path: str, video_context: dict) -> str:
        gems_content = Path(gems_path).read_text(encoding="utf-8")

        # 深度模式允许更多内容，快速模式适当截断
        limit = 120000 if self.mode == "deep" else 80000
        if len(gems_content) > limit:
            gems_content = self._truncate_smart(gems_content, limit=limit)

        # 在 user message 中也强化语言要求（双保险）
        lang_note = ""
        if self.language == "en":
            lang_note = "\n\n⚠️ Remember: write the entire report in English."
        elif self.language == "de":
            lang_note = "\n\n⚠️ Denken Sie daran: Schreiben Sie den gesamten Bericht auf Deutsch."

        user_msg = (
            f"## 视频信息\n"
            f"标题：{video_context['title']}\n"
            f"简介：{video_context.get('brief', '')}\n\n"
            f"## 精华评论合集（gems.md）\n\n{gems_content}"
            f"{lang_note}"
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
        result = "---".join(keep)
        if len(result) > limit:
            result = result[:limit] + "\n\n... (已截断) ..."
        return result
