# 视频评论深度洞察系统 — 技术方案 v2

> **核心流程** ：硬筛去垃圾 → LLM 逐条精读（好句子攒到 MD）→ 思考模型写深度报告

---

## 1. Pipeline 重新设计

```
4000+ 原始评论
      │
      ▼
┌──────────────┐
│  Stage 0     │  规则硬筛（零成本，< 1秒）
│  去垃圾      │  去掉纯表情、< 15字、重复、机器人
└──────┬───────┘
       │  ≈ 800-1500 条存活
       ▼
┌──────────────┐
│  Stage 1     │  LLM 批量精读（核心环节）
│  模型当读者  │  每批 20 条喂给 LLM，逐条判断：
│              │    KEEP → 摘录原文 + 一句话标注 → 追加写入 gems.md
│              │    PASS → 跳过
└──────┬───────┘
       │  gems.md（≈ 30-80 条精华 + 标注）
       ▼
┌──────────────┐
│  Stage 2     │  思考模型（DeepSeek-R1 / Claude）
│  深度报告    │  读 gems.md 全文 → 聚类、提炼、组织
│              │  输出 report.md 深度研究报告
└──────────────┘
```

**为什么这样设计：**

| 设计决策                       | 理由                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| 硬筛只管"去垃圾"，不管"选好的" | 规则无法判断"深度"，只能判断"明显不行"                       |
| LLM 当读者而非打分器           | 打分是伪需求——人类读评论也不是打分，而是"这条有料，记一下" |
| 批量喂 20 条而非逐条           | 逐条调 4000 次 LLM 不现实；20 条一批 ≈ 50-75 次调用，可控   |
| 中间产物是一个 gems.md         | 人可以直接看、手动增删、二次编辑；断点可恢复                 |
| 最终报告用思考模型             | 聚类+提炼+结构化写作需要长链推理，普通模型写不好             |

---

## 2. Stage 0 — 硬筛（去垃圾）

 **目标** ：不判断"好不好"，只去掉"一定没用的"。4000 → 800-1500 条。

```python
# stage0_prefilter.py

import re, hashlib

def prefilter(comments: list[dict]) -> list[dict]:
    """纯规则硬筛，只去垃圾"""
    seen = set()
    result = []

    for c in comments:
        text = c["text"].strip()

        # --- 硬性淘汰 ---
        # 1. 太短（纯反应式评论："哈哈哈"、"说得对"、"第一"）
        if len(text) < 15:
            continue

        # 2. 纯表情 / 纯标点
        content = re.sub(r"[^\w\u4e00-\u9fffa-zA-Z]", "", text)
        if len(content) < 8:
            continue

        # 3. 去重（前80字指纹）
        fingerprint = hashlib.md5(text[:80].encode()).hexdigest()[:10]
        if fingerprint in seen:
            continue
        seen.add(fingerprint)

        # 4. 机器人 / 广告（简单关键词）
        spam_patterns = [
            r"关注我", r"互关", r"求关注", r"私信",
            r"加微信", r"v信", r"免费领", r"点击链接",
            r"subscribe", r"check my channel",
        ]
        if any(re.search(p, text, re.IGNORECASE) for p in spam_patterns):
            continue

        result.append(c)

    return result
```

 **不在这一步做的事** ：不按点赞数排序淘汰。因为很多深度评论发得晚、点赞少，但内容极有价值。点赞数只作为 Stage 1 的参考信息传给 LLM。

---

## 3. Stage 1 — LLM 精读（核心）

### 3.1 设计思路

把 LLM 当成一个 **认真的读者** ，而不是一个打分机器。

人类在刷评论区时的行为是：快速扫过 → 遇到有意思的停下来 → "这条不错，记一下" → 继续往下。

Stage 1 就是让 LLM 模拟这个过程。

### 3.2 批量精读 Prompt

```python
# stage1_llm_read.py

READER_SYSTEM_PROMPT = """你是一位资深的内容研究员，正在阅读一个视频的评论区。
你的任务是从大量评论中**挑出真正有深度、有价值的评论**。

## 视频背景
标题：{video_title}
简介：{video_brief}

## 你的判断标准
一条评论值得被记录，当且仅当它至少满足以下之一：
- 提出了视频没说到的独立观点或补充视角
- 分享了真实的个人经验/案例，能佐证或反驳视频观点
- 有清晰的逻辑推理链条，不是情绪化的赞同/反对
- 带来了跨领域的关联知识或意想不到的类比
- 指出了视频中的盲点、错误或值得商榷的地方
- 引发了有质量的讨论（可参考点赞数和回复数作为辅助信号）

## 不要记录的：
- 单纯的赞美（"说得太好了"、"学到了"）
- 情绪宣泄（"太真实了哈哈哈"）
- 重复视频已说过的内容（无增量）
- 蹭热度、玩梗、无信息量的调侃

## 输出格式（严格遵守）
对于每批评论，逐条判断。只输出你认为值得记录的，格式如下：

KEEP #评论序号 | @作者 | 👍点赞数
标签：（1-3个关键词，如：独立观点、实战经验、反驳、跨领域、盲点）
亮点：（一句话说明为什么这条值得记录）
原文：（完整保留原文，不要删改）

---

如果这一批全都不值得记录，只需输出：
PASS ALL

不需要解释为什么 PASS 的评论被跳过。"""
```

### 3.3 批量喂入 + 流式追加 gems.md

```python
# stage1_llm_read.py

import math
from pathlib import Path

BATCH_SIZE = 20  # 每批喂给 LLM 的评论数

class LLMReader:
    def __init__(self, llm_client, video_context: dict):
        self.llm = llm_client
        self.video_context = video_context
        self.gems_path = Path(f"data/gems_{video_context['video_id']}.md")
        self._init_gems_file()

    def _init_gems_file(self):
        """初始化 gems.md 文件头"""
        header = f"""# 💎 精华评论收集 — {self.video_context['title']}

> 由 LLM 精读筛选，Stage 1 自动生成
> 生成时间：{{timestamp}}

---

"""
        from datetime import datetime
        self.gems_path.parent.mkdir(parents=True, exist_ok=True)
        self.gems_path.write_text(
            header.replace("{timestamp}", datetime.now().strftime("%Y-%m-%d %H:%M")),
            encoding="utf-8"
        )
        self.kept_count = 0

    def read_all(self, comments: list[dict]) -> str:
        """分批精读所有评论，持续追加到 gems.md"""
        total_batches = math.ceil(len(comments) / BATCH_SIZE)

        for batch_idx in range(total_batches):
            start = batch_idx * BATCH_SIZE
            end = start + BATCH_SIZE
            batch = comments[start:end]

            print(f"  📖 Reading batch {batch_idx+1}/{total_batches} "
                  f"(comments {start+1}-{min(end, len(comments))})")

            # 格式化这一批评论
            batch_text = self._format_batch(batch, start_idx=start)

            # LLM 精读
            try:
                response = self.llm.generate(
                    system=READER_SYSTEM_PROMPT.format(
                        video_title=self.video_context["title"],
                        video_brief=self.video_context.get("brief", "")
                    ),
                    user=f"## 本批评论（第 {start+1}-{min(end, len(comments))} 条）\n\n{batch_text}"
                )
                # 追加到 gems.md
                self._append_gems(response, batch_idx)
            except Exception as e:
                # 软失败：这一批失败了，记录错误，继续下一批
                self._append_error(batch_idx, str(e))
                print(f"  ⚠️  Batch {batch_idx+1} failed: {e}, skipping...")
                continue

        # 写入统计尾部
        self._finalize()
        return str(self.gems_path)

    def _format_batch(self, batch: list[dict], start_idx: int) -> str:
        """格式化一批评论供 LLM 阅读"""
        lines = []
        for i, c in enumerate(batch):
            idx = start_idx + i + 1
            lines.append(f"### #{idx} @{c['author']} | 👍{c['likes']} | 💬{c.get('reply_count', 0)}")
            lines.append(f"{c['text']}")
            lines.append("")
        return "\n".join(lines)

    def _append_gems(self, llm_response: str, batch_idx: int):
        """把 LLM 选出的 KEEP 评论追加到 gems.md"""
        if "PASS ALL" in llm_response:
            return

        # 直接追加 LLM 输出（已经是结构化 Markdown）
        with open(self.gems_path, "a", encoding="utf-8") as f:
            f.write(f"\n<!-- Batch {batch_idx+1} -->\n")
            f.write(llm_response.strip())
            f.write("\n\n---\n\n")

        # 统计 KEEP 数量
        self.kept_count += llm_response.count("KEEP #")

    def _append_error(self, batch_idx: int, error: str):
        with open(self.gems_path, "a", encoding="utf-8") as f:
            f.write(f"\n<!-- ⚠️ Batch {batch_idx+1} FAILED: {error} -->\n\n")

    def _finalize(self):
        with open(self.gems_path, "a", encoding="utf-8") as f:
            f.write(f"\n---\n\n**统计：共筛选出 {self.kept_count} 条精华评论**\n")
```

### 3.4 成本与速度估算（4000 条评论场景）

```
原始评论：         4000 条
Stage 0 硬筛后：   ~1200 条（去掉垃圾 ~70%）
Stage 1 批次数：   1200 / 20 = 60 批 LLM 调用

每批 input tokens：~2000（20条评论平均每条100字）
每批 output tokens：~500（KEEP 3-5条 + 标注）
总 token：         60 × 2500 = 150K tokens

┌──────────────────┬────────────────┬──────────┬──────────┐
│ LLM 方案         │ 单次延迟       │ 总耗时    │ 总成本    │
├──────────────────┼────────────────┼──────────┼──────────┤
│ Ollama qwen2.5   │ ~3-5s/batch    │ ~4-5min  │ ¥0       │
│ DeepSeek API     │ ~1-2s/batch    │ ~2min    │ ~¥0.15   │
│ Claude Sonnet    │ ~2-3s/batch    │ ~3min    │ ~$0.50   │
│ GPT-4o-mini      │ ~1-2s/batch    │ ~2min    │ ~$0.03   │
└──────────────────┴────────────────┴──────────┴──────────┘

gems.md 预计产出：30-80 条精华评论（取决于评论区质量）
```

### 3.5 并发加速（可选）

```python
# 如果用 API 且不想等 5 分钟，可以开并发
import asyncio

async def read_all_concurrent(self, comments, max_concurrent=5):
    """并发版本，5路并行读取"""
    semaphore = asyncio.Semaphore(max_concurrent)
    batches = [comments[i:i+BATCH_SIZE] for i in range(0, len(comments), BATCH_SIZE)]

    async def process_batch(batch, batch_idx):
        async with semaphore:
            # ... same logic, but async
            pass

    tasks = [process_batch(b, i) for i, b in enumerate(batches)]
    await asyncio.gather(*tasks)
    # 注意：并发写 gems.md 需要加锁或最后统一合并
```

---

## 4. Stage 2 — 思考模型写报告

### 4.1 设计思路

gems.md 已经是一份"人类也能直接看"的精华摘录了。

Stage 2 的目标不是"再筛一遍"，而是：

1. **聚类** ：这些评论在讨论哪几个核心话题？
2. **提炼** ：每个话题下，评论区的集体共识和分歧是什么？
3. **升华** ：评论区作为整体，有没有超越视频本身的洞察？
4. **组织** ：写成一份结构化的深度报告

### 4.2 为什么用思考模型

| 能力需求                               | 普通模型       | 思考模型（R1/Claude Thinking）    |
| -------------------------------------- | -------------- | --------------------------------- |
| 从 50 条评论中归纳 5 个主题            | 能做但容易遗漏 | 长链推理，覆盖更全                |
| 识别评论间的矛盾和互补                 | 经常忽略       | 自然会在思考链中对比              |
| 区分"多数人的共识"和"少数人的独到见解" | 倾向于只写共识 | 能同时兼顾                        |
| 写出信息密度高的分析段落               | 容易注水       | thinking 阶段已完成分析，输出更干 |

### 4.3 报告生成 Prompt

```python
# stage2_report.py

REPORT_SYSTEM_PROMPT = """你是一位顶级的深度内容分析师。

你将收到一份从视频评论区中精选出的高质量评论合集（gems.md）。
这些评论已经过初步筛选，每条都附有"标签"和"亮点"标注。

## 你的任务

基于这些评论，撰写一份**深度研究报告**。

## 报告结构

### 第一部分：评论区全景概述（200字以内）
- 评论区整体的讨论氛围和热度分布
- 评论者群体画像（从评论内容推断：从业者多？学生多？创业者多？）

### 第二部分：核心议题深度分析
- 自动识别 3-7 个核心讨论主题
- 每个主题下：
  - 主流观点是什么？（引用具体评论）
  - 有没有有力的反对/补充意见？（引用具体评论）
  - 评论区的"集体智慧"在这个话题上超越视频本身的部分

### 第三部分：独到洞察精选（最有价值的部分）
- 挑出 3-5 条最具原创性的评论
- 对每条展开分析：为什么这个观点重要？它补充了什么？

### 第四部分：共识与分歧地图
- 哪些观点几乎所有人都同意？
- 哪些观点存在明显分歧？分歧的根源是什么？

### 第五部分：元反思
- 这个评论区作为整体，反映了当前社会/行业对视频主题的什么态度？
- 评论区的讨论质量如何？有没有系统性的盲区？

## 写作风格
- 信息密度极高，每句话都要有信息量
- 引用评论时标注作者名（@xxx），让读者可以回溯
- 不要套话、不要"总的来说"、不要"值得注意的是"
- 允许有你自己的判断和分析，但要标注哪些是评论区的观点、哪些是你的分析
- 如果你在思考过程中发现了评论者们自己都没意识到的深层规律，大胆写出来"""


class ReportWriter:
    def __init__(self, thinking_model_client):
        """
        thinking_model_client: 使用思考模型
        - DeepSeek R1: deepseek-reasoner
        - Claude: claude-sonnet-4-20250514 with extended thinking
        - QwQ: qwq-32b
        """
        self.llm = thinking_model_client

    def generate(self, gems_path: str, video_context: dict) -> str:
        gems_content = Path(gems_path).read_text(encoding="utf-8")

        # 检查 gems.md 是否超出 context window
        # 大多数思考模型支持 32K-128K，gems.md 通常 < 20K
        if len(gems_content) > 80000:
            gems_content = self._truncate_smart(gems_content, limit=80000)

        response = self.llm.generate(
            system=REPORT_SYSTEM_PROMPT,
            user=f"""## 视频信息
标题：{video_context['title']}
简介：{video_context.get('brief', '')}

## 精华评论合集（gems.md）

{gems_content}""",
            # 思考模型特有参数
            temperature=0.6,        # 适度创造性
            max_tokens=8192,        # 报告不超过 8K tokens
        )

        # 保存报告
        report_path = Path(f"reports/{video_context['video_id']}_report.md")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(response, encoding="utf-8")

        return str(report_path)

    def _truncate_smart(self, text: str, limit: int) -> str:
        """智能截断：保留头尾，中间按评论边界裁剪"""
        if len(text) <= limit:
            return text
        # 按 "---" 分割评论块，保留前后各一半
        blocks = text.split("---")
        half = len(blocks) // 2
        keep = blocks[:half//2] + ["\n\n... (中间部分省略) ...\n\n"] + blocks[-half//2:]
        return "---".join(keep)[:limit]
```

---

## 5. LLM 客户端统一封装

```python
# llm/client.py

import json, requests

class LLMClient:
    """统一封装：Ollama / OpenAI 兼容 / DeepSeek"""

    def __init__(self, config: dict):
        self.provider = config["provider"]
        self.model = config["model"]
        self.base_url = config["base_url"]
        self.api_key = config.get("api_key", "")
        self.temperature = config.get("temperature", 0.3)
        self.max_tokens = config.get("max_tokens", 4096)

    def generate(self, system: str, user: str) -> str:
        if self.provider == "ollama":
            return self._ollama(system, user)
        else:  # openai_compatible / deepseek / claude
            return self._openai_compat(system, user)

    def _ollama(self, system: str, user: str) -> str:
        resp = requests.post(f"{self.base_url}/api/chat", json={
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": False,
            "options": {"temperature": self.temperature}
        })
        return resp.json()["message"]["content"]

    def _openai_compat(self, system: str, user: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        resp = requests.post(f"{self.base_url}/v1/chat/completions", json={
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }, headers=headers)
        return resp.json()["choices"][0]["message"]["content"]
```

---

## 6. 主入口

```python
# main.py

import yaml, sys
from scrapers.factory import create_scraper
from stage0_prefilter import prefilter
from stage1_llm_read import LLMReader
from stage2_report import ReportWriter
from llm.client import LLMClient

def main(video_url: str):
    config = yaml.safe_load(open("config.yaml"))

    # --- Stage 0: 采集 + 硬筛 ---
    print("📥 Scraping comments...")
    scraper = create_scraper(video_url)
    raw = scraper.fetch_comments(video_url, max_count=config.get("max_comments", 5000))
    print(f"   Got {len(raw)} raw comments")

    print("🧹 Pre-filtering...")
    filtered = prefilter(raw)
    print(f"   {len(filtered)} survived (removed {len(raw)-len(filtered)} junk)")

    # --- Stage 1: LLM 精读 ---
    print("📖 LLM reading comments...")
    reader_llm = LLMClient(config["llm"]["reader"])
    reader = LLMReader(reader_llm, video_context={
        "video_id": scraper.video_id,
        "title": config["video_title"],
        "brief": config.get("video_brief", ""),
    })
    gems_path = reader.read_all(filtered)
    print(f"   💎 Gems saved to: {gems_path}")
    print(f"   Kept {reader.kept_count} quality comments")

    # --- Stage 2: 思考模型写报告 ---
    print("🧠 Generating deep report...")
    writer_llm = LLMClient(config["llm"]["thinker"])
    writer = ReportWriter(writer_llm)
    report_path = writer.generate(gems_path, {
        "video_id": scraper.video_id,
        "title": config["video_title"],
        "brief": config.get("video_brief", ""),
    })
    print(f"✅ Report saved to: {report_path}")

if __name__ == "__main__":
    main(sys.argv[1])
```

---

## 7. 配置文件

```yaml
# config.yaml

video_title: "Vibe Coding实战复盘：做玩具容易，做产品难"
video_brief: "李自然复盘用AI独立开发资讯网站的经验"

max_comments: 5000

llm:
  # Stage 1 精读用的模型（追求速度和性价比）
  reader:
    provider: ollama
    model: qwen2.5:14b
    base_url: http://localhost:11434
    temperature: 0.2          # 低温度 = 判断更稳定
    max_tokens: 2048

  # Stage 2 报告用的思考模型（追求深度）
  thinker:
    provider: openai_compatible
    model: deepseek-reasoner   # 或 claude-sonnet-4-20250514
    base_url: https://api.deepseek.com
    api_key: sk-xxx
    temperature: 0.6
    max_tokens: 8192

# B站配置
bilibili:
  cookie: "SESSDATA=xxx"
```

---

## 8. 项目结构（极简）

```
comment-miner/
├── main.py                  # 主入口，30 行
├── config.yaml              # 配置
├── requirements.txt         # < 10 个依赖
│
├── scrapers/                # 采集层
│   ├── base.py              # 统一数据结构
│   ├── youtube.py
│   ├── bilibili.py
│   └── factory.py           # URL → 自动选 scraper
│
├── stage0_prefilter.py      # 规则硬筛（50行）
├── stage1_llm_read.py       # LLM 精读 → gems.md（100行）
├── stage2_report.py         # 思考模型 → report.md（80行）
│
├── llm/
│   └── client.py            # LLM 统一客户端（60行）
│
├── prompts/                 # Prompt 外置，方便迭代
│   ├── reader.txt           # Stage 1 精读 prompt
│   └── reporter.txt         # Stage 2 报告 prompt
│
├── data/                    # 中间产物
│   ├── raw/                 # 原始评论 dump
│   └── gems_*.md            # ⭐ 精华评论集（人可读、可编辑）
│
└── reports/                 # 最终输出
    └── *_report.md
```

**总代码量预估：~400 行 Python**

---

## 9. gems.md 示例（Stage 1 的输出长这样）

```markdown
# 💎 精华评论收集 — Vibe Coding实战复盘

> 由 LLM 精读筛选
> 生成时间：2026-03-28 15:30
> 原始评论 4200 条 → 硬筛后 1180 条 → 精读保留 52 条

---

KEEP #23 | @张三_产品经理 | 👍342
标签：实战经验、补充视角
亮点：用自身踩坑经历佐证了"Markdown优于JSON"的论点，并补充了YAML的适用场景
原文：我们团队之前也用JSON做LLM的中间态，上线第一周就崩了3次，全是括号匹配问题。
后来换成Markdown+YAML front matter的方案，稳定性直接提升了一个量级。
补充一点李老师没说的：YAML在配置类数据上比MD更合适，两者可以混用...

---

KEEP #47 | @CodeMonkey | 👍128
标签：反驳、独立观点
亮点：对"极简架构"观点提出了有力的反面论证，指出了静态方案的天花板
原文：不完全同意静态HTML方案。这种方案确实维护成本低，但天花板也很明显——
一旦需要用户交互（登录、评论、个性化推荐），整套架构就得推翻重来。
真正的工程智慧应该是"选择当前阶段最合适的架构"，而不是一味追求极简...

---

... (更多精华评论) ...

---

**统计：共筛选出 52 条精华评论**
```

---

## 10. 关键工程细节

### 10.1 断点恢复

```python
# gems.md 本身就是断点——如果中途 crash，检查已处理到哪个 batch
def get_last_batch(gems_path: str) -> int:
    """从 gems.md 的 HTML 注释中读取最后处理的 batch 号"""
    import re
    content = Path(gems_path).read_text()
    batches = re.findall(r"<!-- Batch (\d+) -->", content)
    return int(batches[-1]) if batches else 0

# 恢复时从 last_batch + 1 开始继续
```

### 10.2 人工介入点

gems.md 设计为**人可以直接编辑**的格式：

```
Stage 1 完成后，可以暂停：
  1. 打开 gems.md
  2. 删掉你觉得不该选的
  3. 手动添加 LLM 漏掉的好评论
  4. 再运行 Stage 2 生成报告
```

这不是 bug，是 feature——保留人类 override 的能力。

### 10.3 Stage 1 的 Prompt 调优方向

| 问题                          | 调优方法                             |
| ----------------------------- | ------------------------------------ |
| LLM 选太多（50% 都 KEEP）     | 在 prompt 中加入"每批最多 KEEP 5 条" |
| LLM 选太少（有价值的被 PASS） | 降低标准描述，或加"宁可多选不要漏选" |
| LLM 偏好长评论                | 加入"短评论如果观点精炼同样值得记录" |
| 对特定领域理解不足            | 在 video_brief 中补充领域背景知识    |

---

## 11. 两套模型的推荐搭配

| 场景               | Stage 1（精读）     | Stage 2（报告）         | 总成本/次 |
| ------------------ | ------------------- | ----------------------- | --------- |
| **纯本地**   | Ollama qwen2.5:14b  | Ollama QwQ-32b          | ¥0       |
| **性价比**   | DeepSeek-V3 API     | DeepSeek-R1 API         | ~¥0.3    |
| **质量优先** | Claude Haiku        | Claude Sonnet(thinking) | ~$0.8     |
| **混搭推荐** | Ollama qwen2.5 本地 | DeepSeek-R1 API         | ~¥0.1    |
