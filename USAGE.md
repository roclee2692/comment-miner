# 使用教程

## 环境要求

- **Python 3.10+**
- **Node.js 18+**（仅修改前端时需要，直接使用无需安装）

## 安装

```bash
# 1. 克隆仓库
git clone https://github.com/roclee2692/comment-miner.git
cd comment-miner

# 2. 安装 Python 依赖
pip install -r requirements.txt
```

前端已预构建在 `frontend/dist/` 中，无需额外操作。

## 支持的平台

| 平台 | 需要 API Key | 链接格式 |
|------|-------------|---------|
| **YouTube** | 需要 YouTube Data API v3 Key | `https://www.youtube.com/watch?v=xxx` |
| **B站** | **不需要**，直接可用 | `https://www.bilibili.com/video/BVxxx` |

## 配置

### YouTube API Key（仅分析 YouTube 视频时需要）

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目（或选择已有项目）
3. 搜索并启用 **YouTube Data API v3**
4. 左侧菜单 → 凭据 → 创建凭据 → API 密钥
5. 复制生成的 API Key

> 免费配额：每天 10,000 单位。采集 5000 条评论约消耗 50-100 单位，完全够用。

### B站

**无需任何配置**，直接粘贴 B站视频链接即可。采集使用 B站公开 API，不需要登录或 Key。

支持的链接格式：
- `https://www.bilibili.com/video/BV1xxxxxxxxx`
- `https://b23.tv/BV1xxxxxxxxx`

### LLM 配置

有两种使用方式，LLM 配置略有不同：

---

## 使用方式一：Web 界面（推荐）

```bash
python server.py
```

浏览器打开 **http://localhost:8000**，即可看到 CommentMiner 界面。

> 所有配置（API Key、模型选择等）会自动保存到浏览器本地，刷新不丢失，填一次即可。

### Web 界面操作步骤

#### 1. 配置页（⚙ 配置）

**视频信息区域：**
- **视频 URL**（必填）：粘贴 YouTube 或 B站 视频链接
- **视频标题**（可选）：帮助 LLM 理解视频主题
- **视频简介**（可选）：简要描述视频核心内容
- **YouTube API Key**：仅分析 YouTube 视频时需要，B站无需填写
- **最大采集评论数**：拖动滑块调节，默认 5000

**模型方案区域：**

提供 6 种预设方案，点击即可切换：

| 预设 | Stage 1 精读 | Stage 2 报告 | 适合场景 |
|------|-------------|-------------|---------|
| **Google Gemini** | gemini-3.1-flash-lite | gemini-3.1-pro | 有 $300 赠金，推荐 |
| DeepSeek | deepseek-chat | deepseek-reasoner | 约 ¥0.3/次，性价比之王 |
| OpenAI GPT-5.4 | gpt-5.4-mini | gpt-5.4 | 约 $0.5/次 |
| Claude 4.6 | claude-haiku | claude-sonnet | 约 $0.8/次，质量最佳 |
| 全本地 | Ollama qwen2.5:14b | Ollama qwq:32b | 有 GPU，零成本 |
| 混搭 | Ollama 本地 | DeepSeek-R1 API | 本地精读 + API 写报告 |

选择预设后，下方的模型配置会自动填入。你也可以手动修改任何字段。

**切换预设时，已填过的 API Key 会自动记住**（按平台存储），不会丢失。

#### 2. 运行（▶ Pipeline）

点击「开始分析」按钮后自动跳转到 Pipeline 页面，实时显示：
- 进度条和阶段指示器
- 每个 Stage 的详细日志
- 每批精读的 KEEP 数量

#### 3. 查看结果

运行完成后：
- **💎 精华** Tab：查看 gems.md，支持 Markdown 渲染
- **📊 报告** Tab：查看深度分析报告，支持 Markdown 渲染
- 每个 Tab 右上角有**复制按钮**，可一键复制全部内容

---

## 使用方式二：命令行

### 配置文件

```bash
cp config.yaml.example config.yaml
```

编辑 `config.yaml`，填入 LLM 配置（如果分析 YouTube 视频还需要填 YouTube API Key）。

### 运行

```bash
# YouTube 视频
python main.py "https://www.youtube.com/watch?v=VIDEO_ID"

# B站视频
python main.py "https://www.bilibili.com/video/BV1xxxxxxxxx"
```

输出文件：
- `data/gems_<video_id>.md` — 精华评论集
- `reports/<video_id>_report.md` — 深度报告

---

## 本地模型配置（Ollama，零成本）

如果你有独立显卡（NVIDIA / AMD / Apple Silicon），可以用 Ollama 在本地跑大模型，完全免费、无需 API Key、数据不出本机。

### 第一步：安装 Ollama

前往 [ollama.com](https://ollama.com/) 下载安装：

| 系统 | 安装方式 |
|------|---------|
| **Windows** | 下载 `.exe` 安装包，双击安装 |
| **macOS** | 下载 `.dmg`，或 `brew install ollama` |
| **Linux** | `curl -fsSL https://ollama.com/install.sh \| sh` |

安装后 Ollama 会自动在后台运行。如果没有，手动启动：

```bash
ollama serve
```

验证是否正常：

```bash
# 应该返回 "Ollama is running"
curl http://localhost:11434
```

### 第二步：下载模型

根据你的显存选择合适的模型：

```bash
# Stage 1 精读模型（推荐 qwen2.5:14b，需要 ~10GB 显存）
ollama pull qwen2.5:14b

# Stage 2 报告模型（推荐 qwq:32b，需要 ~20GB 显存）
ollama pull qwq:32b
```

**显存不够？** 用小一号的模型：

| 显存 | Stage 1 精读 | Stage 2 报告 | 效果 |
|------|-------------|-------------|------|
| **24GB+** | `qwen2.5:14b` | `qwq:32b` | 最佳 |
| **16GB** | `qwen2.5:14b` | `qwq:14b` | 很好 |
| **8GB** | `qwen2.5:7b` | `qwen2.5:14b` | 够用 |
| **6GB** | `qwen2.5:3b` | `qwen2.5:7b` | 勉强 |

> **提示**：也可以用其他模型，如 `llama3.3:70b`、`deepseek-r1:14b`、`gemma3:27b` 等。
> 完整模型列表：运行 `ollama list` 查看已下载的模型，或访问 [ollama.com/library](https://ollama.com/library) 浏览。

### 第三步：在前端配置

**方式 A：一键预设（最简单）**

1. 启动后端：`python server.py`
2. 浏览器打开 `http://localhost:8000`
3. 在配置页的「模型方案」区域，点击 **「全本地（零成本）」** 预设
4. 模型配置会自动填入：
   - Stage 1：Ollama 本地 → `qwen2.5:14b` → `http://localhost:11434`
   - Stage 2：Ollama 本地 → `qwq:32b` → `http://localhost:11434`
5. **API Key 留空**（本地模型不需要）
6. 填入视频 URL，点击「开始分析」

**方式 B：混搭模式（推荐显存不够的用户）**

点击 **「混搭（本地+API）」** 预设：
- Stage 1 精读用本地 Ollama（省钱，精读对模型要求不高）
- Stage 2 报告用云端 API（DeepSeek-R1，¥0.1 一次，报告质量更好）

这样只需要 ~10GB 显存跑 Stage 1，Stage 2 交给云端。

**方式 C：手动配置**

如果你用了不同的模型名或端口，手动修改：
1. Provider 下拉选择 **「Ollama 本地」**
2. Base URL 填 `http://localhost:11434`（默认端口，通常不用改）
3. Model 填你下载的模型名，如 `qwen2.5:7b`
4. API Key 留空

### 第四步：命令行模式

如果用命令行而非 Web 界面，编辑 `config.yaml`：

```yaml
llm:
  reader:
    provider: ollama
    model: qwen2.5:14b
    base_url: http://localhost:11434
    temperature: 0.2
    max_tokens: 2048

  thinker:
    provider: ollama
    model: qwq:32b
    base_url: http://localhost:11434
    temperature: 0.6
    max_tokens: 8192
```

然后运行：

```bash
python main.py "https://www.bilibili.com/video/BV1xxxxxxxxx"
```

### 常见问题

**Q: 报错 "无法连接 Ollama"？**
- 确认 Ollama 正在运行：`ollama serve`
- 确认端口没被占用：`curl http://localhost:11434`
- Windows 防火墙可能阻止了连接，允许 Ollama 通过防火墙

**Q: 模型加载很慢？**
- 第一次加载模型需要时间（加载到显存），后续调用会快很多
- 如果持续很慢，可能显存不足导致模型在 CPU 上运行，换更小的模型

**Q: 生成质量不如 API？**
- 本地模型参数量有限，质量确实不如 GPT-5.4 / Claude 4.6 等大模型
- 建议：Stage 1 用本地（精读任务简单），Stage 2 用 API（报告需要强推理）
- 即「混搭」模式，兼顾成本和质量

**Q: 可以用 Google Gemma / Meta Llama / DeepSeek 本地模型吗？**
- 可以！只要 Ollama 支持的模型都能用
- `ollama pull gemma3:27b`、`ollama pull llama3.3:70b`、`ollama pull deepseek-r1:14b`
- 在前端 Model 字段填对应模型名即可

---

## 全 API 模式配置（不用本地模型）

如果你没有本地 GPU 或不想跑 Ollama，可以全部使用云端 API。

### 方案 A：Google Gemini（推荐，有 $300 赠金）

**Web 界面**：选择「Google Gemini」预设，在两个模型卡片中填入你的 Google API Key。

**API Key 获取**：
1. 前往 [Google AI Studio](https://aistudio.google.com/)
2. 点击 Get API Key → Create API key
3. 或在 [Google Cloud Console](https://console.cloud.google.com/) 启用 Generative Language API 后创建凭据

**命令行** `config.yaml`：
```yaml
llm:
  reader:
    provider: openai_compatible
    model: gemini-3.1-flash-lite-preview
    base_url: https://generativelanguage.googleapis.com/v1beta/openai
    api_key: "你的Google_API_Key"
    temperature: 0.2
    max_tokens: 2048

  thinker:
    provider: openai_compatible
    model: gemini-3.1-pro-preview
    base_url: https://generativelanguage.googleapis.com/v1beta/openai
    api_key: "你的Google_API_Key"
    temperature: 0.6
    max_tokens: 8192
```

### 方案 B：DeepSeek（性价比最高，约 ¥0.3/次）

**Web 界面**：选择「DeepSeek」预设，填入 DeepSeek API Key。

**命令行** `config.yaml`：
```yaml
llm:
  reader:
    provider: openai_compatible
    model: deepseek-chat
    base_url: https://api.deepseek.com
    api_key: "你的DeepSeek_API_Key"
    temperature: 0.2
    max_tokens: 2048

  thinker:
    provider: openai_compatible
    model: deepseek-reasoner
    base_url: https://api.deepseek.com
    api_key: "你的DeepSeek_API_Key"
    temperature: 0.6
    max_tokens: 8192
```

> DeepSeek API Key 获取：前往 [platform.deepseek.com](https://platform.deepseek.com/) 注册并充值。

### 方案 C：OpenAI GPT-5.4（约 $0.5/次）

**Web 界面**：选择「OpenAI GPT-5.4」预设，填入 OpenAI API Key。

**命令行** `config.yaml`：
```yaml
llm:
  reader:
    provider: openai_compatible
    model: gpt-5.4-mini
    base_url: https://api.openai.com
    api_key: "你的OpenAI_API_Key"
    temperature: 0.2
    max_tokens: 2048

  thinker:
    provider: openai_compatible
    model: gpt-5.4
    base_url: https://api.openai.com
    api_key: "你的OpenAI_API_Key"
    temperature: 0.6
    max_tokens: 8192
```

### 方案 D：Claude 4.6（质量最佳，约 $0.8/次）

**Web 界面**：选择「Claude 4.6」预设，填入 Anthropic API Key。

**命令行** `config.yaml`：
```yaml
llm:
  reader:
    provider: openai_compatible
    model: claude-haiku-4-5-20251001
    base_url: https://api.anthropic.com
    api_key: "你的Anthropic_API_Key"
    temperature: 0.2
    max_tokens: 2048

  thinker:
    provider: openai_compatible
    model: claude-sonnet-4-6
    base_url: https://api.anthropic.com
    api_key: "你的Anthropic_API_Key"
    temperature: 0.6
    max_tokens: 8192
```

> Anthropic API Key 获取：前往 [console.anthropic.com](https://console.anthropic.com/) 注册。

### 方案 E：其他 OpenAI 兼容 API

任何支持 OpenAI 格式的 API 都可以用，只需要填入对应的 `base_url`、`model` 和 `api_key`。

---

## 断点恢复

Stage 1 支持断点恢复。如果运行中途中断（网络错误、手动停止等），再次运行**同一个视频 URL**，会自动从上次处理到的 batch 继续，不会重复处理已完成的评论。

## gems.md 人工编辑

Stage 1 输出的 `gems.md` 是人可以直接编辑的中间产物。在 Stage 2 运行前，你可以：
- 删除你认为不重要的评论
- 手动添加你觉得遗漏的精华评论
- 调整标注和分类

Stage 2 会基于编辑后的 gems.md 生成报告。

## 常见问题

### Q: 前端页面打不开？
确保用 `python server.py` 启动（不是 `python main.py`），然后浏览器访问 `http://localhost:8000`。

### Q: YouTube API 报错 403？
检查：1) API Key 是否正确 2) 是否启用了 YouTube Data API v3 3) 是否超出每日配额

### Q: Gemini API 报错 403？
检查：1) 是否启用了 Generative Language API 2) API Key 是否属于正确的项目 3) 凭据的 API restrictions 是否允许了 Generative Language API

### Q: B站评论抓取失败？
检查：1) 链接是否包含 BV 号 2) 视频是否存在且未被删除 3) 网络是否能访问 bilibili.com

### Q: LLM 调用超时？
- 本地模型：确保 Ollama 正在运行（`ollama serve`）
- API 模式：检查 API Key 和余额

### Q: API Key 每次刷新都要重填？
v0.2 起已支持自动保存，所有配置存储在浏览器 localStorage 中。如果仍然丢失，可能是加载了旧版前端，重启一次 `python server.py` 即可。

### Q: 如何修改前端界面？
```bash
cd frontend
npm install    # 首次需要
npm run dev    # 启动开发服务器（端口 5173，自动代理到后端 8000）
# 修改 src/App.jsx 后浏览器会自动刷新
npm run build  # 修改完成后重新构建
```
