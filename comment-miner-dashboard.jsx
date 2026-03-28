import { useState, useEffect, useRef } from "react";

const PRESETS = {
  local: {
    name: "全本地（零成本）",
    reader: { provider: "ollama", model: "qwen2.5:14b", baseUrl: "http://localhost:11434", apiKey: "" },
    thinker: { provider: "ollama", model: "qwq:32b", baseUrl: "http://localhost:11434", apiKey: "" },
  },
  hybrid: {
    name: "混搭推荐（本地精读 + API报告）",
    reader: { provider: "ollama", model: "qwen2.5:14b", baseUrl: "http://localhost:11434", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com", apiKey: "" },
  },
  api_budget: {
    name: "API 性价比",
    reader: { provider: "openai_compatible", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com", apiKey: "" },
  },
  api_quality: {
    name: "API 质量优先",
    reader: { provider: "openai_compatible", model: "claude-haiku-4-5-20251001", baseUrl: "https://api.anthropic.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "claude-sonnet-4-20250514", baseUrl: "https://api.anthropic.com", apiKey: "" },
  },
};

const DEMO_GEMS = [
  { id: 23, author: "张三_产品经理", likes: 342, tags: ["实战经验", "补充视角"], highlight: "用自身踩坑经历佐证了\"Markdown优于JSON\"的论点", text: "我们团队之前也用JSON做LLM的中间态，上线第一周就崩了3次，全是括号匹配问题。后来换成Markdown+YAML front matter的方案，稳定性直接提升了一个量级。" },
  { id: 47, author: "CodeMonkey", likes: 128, tags: ["反驳", "独立观点"], highlight: "对\"极简架构\"提出有力反面论证", text: "不完全同意静态HTML方案。这种方案确实维护成本低，但天花板也很明显——一旦需要用户交互，整套架构就得推翻重来。" },
  { id: 89, author: "创业老王", likes: 567, tags: ["跨领域", "实战经验"], highlight: "从创业角度补充了技术选型的商业考量", text: "作为连续创业者，我觉得李老师说的\"越原始越好\"其实有个隐含前提：你得清楚知道自己要什么。很多团队用Next.js不是因为随波逐流，而是因为不确定产品方向时需要框架的灵活性。" },
  { id: 156, author: "AI_Researcher", likes: 89, tags: ["独立观点", "盲点"], highlight: "指出视频忽略了Prompt Engineering的长期价值", text: "视频说不要迷恋花哨的Prompt技巧，但我认为结构化Prompt在企业级应用中仍然不可替代。个人项目可以靠经验ad-hoc，但团队协作需要可复现的Prompt规范。" },
  { id: 201, author: "全栈小明", likes: 234, tags: ["补充视角", "实战经验"], highlight: "分享了角色分离在实际项目中的变体应用", text: "我在做客服AI时也用了类似的角色分离：理解意图→生成回复→安全审核→情感校准，四个角色各自独立Prompt。关键发现是：审核角色的误杀率要重点关注，太严了会让整个系统变哑巴。" },
];

const DEMO_REPORT = `## 评论区全景概述

本视频评论区呈现出典型的"技术+商业"双轨讨论格局。评论者群体以有实战经验的开发者和产品经理为主，其中不乏连续创业者和AI领域从业者。讨论质量整体较高，约15%的评论包含原创观点或实战案例补充。

## 核心议题深度分析

### 议题一：极简架构 vs 框架灵活性

最激烈的分歧出现在技术选型问题上。@创业老王 指出静态HTML方案有一个被忽略的前提——"你得清楚知道自己要什么"，这实际上点出了视频论述的一个隐含假设：创作者已有清晰的产品形态认知。而@CodeMonkey 更直接地指出静态方案的天花板问题。这些反驳并非否定李自然的方案，而是补充了其适用边界。

**评论区集体智慧**：技术选型不是"简单vs复杂"的二元选择，而是"确定性vs灵活性"的权衡。产品方向越确定，越应该极简；越模糊，越需要框架的灵活性。

### 议题二：中间数据格式的工程哲学

@张三_产品经理 用真实踩坑经历验证了"Markdown优于JSON"的论点——团队用JSON做LLM中间态一周崩了3次。多位评论者呼应了这一观点，并补充了YAML在配置类数据上的优势。

### 议题三：Prompt Engineering 的定位之争

@AI_Researcher 提出了视频最大的盲点：结构化Prompt在企业级场景中仍不可替代。这与视频"不要迷恋花哨Prompt"的论调形成直接张力，但细究会发现两者并不矛盾——个人项目和团队项目的需求本质不同。

## 独到洞察精选

💎 **@全栈小明** 的角色分离变体尤其值得关注：他发现"审核角色的误杀率"是关键瓶颈。这个洞察在视频中完全没有提及，但对实际落地至关重要——过度审核会让系统"变哑巴"，这比放过几个错误更致命。

## 元反思

评论区反映出当前AI工程实践者的一个共同焦虑：**如何在"AI能力快速迭代"和"工程稳定性需求"之间找到平衡点**。视频和评论区共同构成了一幅完整图景——视频提供了"防御性编程"的方法论，评论区则补充了这套方法论的适用边界和变体应用。`;

// ── Icons ──
const Cpu = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>;
const Cloud = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
const Play = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
const Check = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>;
const Diamond = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 22,12 12,22 2,12"/></svg>;
const ChevDown = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>;

export default function CommentMiner() {
  const [tab, setTab] = useState("config");
  const [preset, setPreset] = useState("hybrid");
  const [readerConfig, setReaderConfig] = useState(PRESETS.hybrid.reader);
  const [thinkerConfig, setThinkerConfig] = useState(PRESETS.hybrid.thinker);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoBrief, setVideoBrief] = useState("");
  const [params, setParams] = useState({
    maxComments: 5000,
    minLength: 15,
    batchSize: 20,
    stage1TopK: 50,
    readerTemp: 0.2,
    thinkerTemp: 0.6,
    maxReportTokens: 8192,
  });
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(-1);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [showGems, setShowGems] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [expandedGem, setExpandedGem] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    const p = PRESETS[preset];
    if (p) {
      setReaderConfig({ ...p.reader });
      setThinkerConfig({ ...p.thinker });
    }
  }, [preset]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg, type = "info") => {
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const runPipeline = async () => {
    if (!videoUrl) return;
    setRunning(true); setLogs([]); setStage(0); setProgress(0);
    setShowGems(false); setShowReport(false); setTab("pipeline");

    addLog("📥 Stage 0: 采集评论...", "stage");
    await sleep(800);
    addLog(`  正在从 ${videoUrl.includes("bilibili") ? "Bilibili" : "YouTube"} 抓取评论...`);
    await sleep(1500);
    addLog(`  ✓ 抓取到 4,237 条原始评论`, "success");
    setProgress(10);

    addLog("🧹 硬筛去垃圾...", "stage");
    await sleep(600);
    addLog(`  去除 < ${params.minLength}字短评: -1,892`);
    await sleep(400);
    addLog("  去除重复评论: -203");
    await sleep(300);
    addLog("  去除广告/机器人: -47");
    addLog("  ✓ 硬筛后剩余 2,095 条", "success");
    setProgress(20); setStage(1);

    addLog(`📖 Stage 1: LLM 精读（${readerConfig.provider === "ollama" ? "本地 " + readerConfig.model : readerConfig.model}）`, "stage");
    const totalBatches = Math.ceil(2095 / params.batchSize);
    addLog(`  共 ${totalBatches} 批，每批 ${params.batchSize} 条`);
    await sleep(500);

    const batchSteps = [10, 25, 40, 55, 70, 85, 100];
    for (let i = 0; i < batchSteps.length; i++) {
      const batchNum = Math.floor(totalBatches * batchSteps[i] / 100);
      await sleep(500 + Math.random() * 400);
      const kept = Math.floor(Math.random() * 4) + 1;
      addLog(`  📖 Batch ${batchNum}/${totalBatches} — KEEP ${kept} 条`);
      setProgress(20 + Math.floor(batchSteps[i] * 0.5));
    }

    await sleep(600);
    addLog("  ✓ 精读完成，gems.md 已生成：52 条精华评论", "success");
    setShowGems(true);
    setProgress(75); setStage(2);

    addLog(`🧠 Stage 2: 思考模型生成报告（${thinkerConfig.provider === "ollama" ? "本地 " + thinkerConfig.model : thinkerConfig.model}）`, "stage");
    await sleep(800);
    addLog("  正在聚类分析...");
    await sleep(1200);
    addLog("  正在识别共识与分歧...");
    await sleep(1000);
    addLog("  正在撰写深度报告...");
    await sleep(1500);
    addLog("  正在审核与润色...");
    await sleep(800);
    addLog("  ✓ 报告生成完成: report.md (2,847字)", "success");
    setShowReport(true);
    setProgress(100); setStage(3);

    addLog("✅ Pipeline 完成", "done");
    setRunning(false);
  };

  const ModelCard = ({ label, config, setConfig, icon }) => (
    <div style={styles.modelCard}>
      <div style={styles.modelCardHeader}>
        <span style={styles.modelCardIcon}>{icon}</span>
        <span style={styles.modelCardLabel}>{label}</span>
      </div>
      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Provider</label>
        <div style={styles.providerToggle}>
          {[{ v: "ollama", l: "Ollama 本地", i: <Cpu /> }, { v: "openai_compatible", l: "API", i: <Cloud /> }].map(opt => (
            <button key={opt.v} onClick={() => setConfig(c => ({ ...c, provider: opt.v }))}
              style={{ ...styles.toggleBtn, ...(config.provider === opt.v ? styles.toggleActive : {}) }}>
              {opt.i}<span style={{ marginLeft: 6 }}>{opt.l}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Model</label>
        <input style={styles.input} value={config.model} onChange={e => setConfig(c => ({ ...c, model: e.target.value }))} placeholder="e.g. qwen2.5:14b" />
      </div>
      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Base URL</label>
        <input style={styles.input} value={config.baseUrl} onChange={e => setConfig(c => ({ ...c, baseUrl: e.target.value }))} />
      </div>
      {config.provider === "openai_compatible" && (
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>API Key</label>
          <input style={styles.input} type="password" value={config.apiKey} onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))} placeholder="sk-..." />
        </div>
      )}
    </div>
  );

  const Slider = ({ label, value, min, max, step, unit, onChange, hint }) => (
    <div style={styles.sliderGroup}>
      <div style={styles.sliderHeader}>
        <span style={styles.fieldLabel}>{label}</span>
        <span style={styles.sliderValue}>{value}{unit || ""}</span>
      </div>
      <input type="range" min={min} max={max} step={step || 1} value={value} onChange={e => onChange(Number(e.target.value))}
        style={styles.slider} />
      {hint && <div style={styles.sliderHint}>{hint}</div>}
    </div>
  );

  const stageInfo = [
    { label: "采集 & 硬筛", icon: "🧹" },
    { label: "LLM 精读", icon: "📖" },
    { label: "思考模型报告", icon: "🧠" },
    { label: "完成", icon: "✅" },
  ];

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <Diamond /><span style={{ marginLeft: 8 }}>CommentMiner</span>
          </div>
          <span style={styles.version}>v0.1</span>
        </div>
        <nav style={styles.nav}>
          {[["config", "⚙ 配置"], ["pipeline", "▶ Pipeline"], ["gems", "💎 精华"], ["report", "📊 报告"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ ...styles.navBtn, ...(tab === key ? styles.navActive : {}) }}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={styles.main}>
        {/* ── CONFIG TAB ── */}
        {tab === "config" && (
          <div style={styles.configPage}>
            {/* Video Input */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>视频信息</h2>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>视频 URL</label>
                <input style={styles.input} value={videoUrl} onChange={e => setVideoUrl(e.target.value)}
                  placeholder="YouTube / Bilibili 视频链接" />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>视频简介（可选，帮助 LLM 理解上下文）</label>
                <textarea style={{ ...styles.input, height: 60, resize: "vertical" }} value={videoBrief}
                  onChange={e => setVideoBrief(e.target.value)} placeholder="简要描述视频主题和核心内容..." />
              </div>
            </section>

            {/* Preset */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>模型方案</h2>
              <div style={styles.presetGrid}>
                {Object.entries(PRESETS).map(([key, p]) => (
                  <button key={key} onClick={() => setPreset(key)}
                    style={{ ...styles.presetCard, ...(preset === key ? styles.presetActive : {}) }}>
                    <div style={styles.presetName}>{p.name}</div>
                    <div style={styles.presetDetail}>
                      精读: {p.reader.provider === "ollama" ? <><Cpu /> {p.reader.model}</> : <><Cloud /> {p.reader.model}</>}
                    </div>
                    <div style={styles.presetDetail}>
                      报告: {p.thinker.provider === "ollama" ? <><Cpu /> {p.thinker.model}</> : <><Cloud /> {p.thinker.model}</>}
                    </div>
                    {preset === key && <div style={styles.presetCheck}><Check /></div>}
                  </button>
                ))}
              </div>
            </section>

            {/* Model Cards */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>模型配置</h2>
              <div style={styles.modelGrid}>
                <ModelCard label="Stage 1 · 精读模型" config={readerConfig} setConfig={setReaderConfig} icon="📖" />
                <ModelCard label="Stage 2 · 思考模型" config={thinkerConfig} setConfig={setThinkerConfig} icon="🧠" />
              </div>
            </section>

            {/* Pipeline Params */}
            <section style={styles.section}>
              <h2 style={styles.sectionTitle}>管线参数</h2>
              <div style={styles.paramsGrid}>
                <div style={styles.paramCol}>
                  <div style={styles.paramGroupTitle}>Stage 0 · 采集与硬筛</div>
                  <Slider label="最大采集评论数" value={params.maxComments} min={500} max={10000} step={500} onChange={v => setParams(p => ({ ...p, maxComments: v }))} hint="建议 3000-5000" />
                  <Slider label="最短评论字数" value={params.minLength} min={5} max={50} unit=" 字" onChange={v => setParams(p => ({ ...p, minLength: v }))} hint="低于此字数直接淘汰" />
                </div>
                <div style={styles.paramCol}>
                  <div style={styles.paramGroupTitle}>Stage 1 · LLM 精读</div>
                  <Slider label="每批评论数" value={params.batchSize} min={5} max={50} step={5} unit=" 条/批" onChange={v => setParams(p => ({ ...p, batchSize: v }))} hint="越大越快，但可能降低精度" />
                  <Slider label="精华上限" value={params.stage1TopK} min={10} max={200} step={5} unit=" 条" onChange={v => setParams(p => ({ ...p, stage1TopK: v }))} hint="gems.md 最多保留条数" />
                  <Slider label="精读温度" value={params.readerTemp} min={0} max={1} step={0.1} onChange={v => setParams(p => ({ ...p, readerTemp: v }))} hint="低 = 判断稳定，高 = 更宽容" />
                </div>
                <div style={styles.paramCol}>
                  <div style={styles.paramGroupTitle}>Stage 2 · 深度报告</div>
                  <Slider label="报告温度" value={params.thinkerTemp} min={0} max={1} step={0.1} onChange={v => setParams(p => ({ ...p, thinkerTemp: v }))} hint="0.5-0.7 推荐" />
                  <Slider label="最大输出 Tokens" value={params.maxReportTokens} min={2048} max={16384} step={1024} onChange={v => setParams(p => ({ ...p, maxReportTokens: v }))} hint="报告篇幅控制" />
                </div>
              </div>
            </section>

            {/* Run Button */}
            <button onClick={runPipeline} disabled={running || !videoUrl}
              style={{ ...styles.runBtn, ...(!videoUrl ? styles.runBtnDisabled : {}) }}>
              <Play /><span style={{ marginLeft: 8 }}>{running ? "运行中..." : "开始分析"}</span>
            </button>
          </div>
        )}

        {/* ── PIPELINE TAB ── */}
        {tab === "pipeline" && (
          <div style={styles.pipelinePage}>
            {/* Stage Progress */}
            <div style={styles.stageBar}>
              {stageInfo.map((s, i) => (
                <div key={i} style={{ ...styles.stageItem, opacity: stage >= i ? 1 : 0.3 }}>
                  <div style={{ ...styles.stageDot, background: stage > i ? "var(--accent)" : stage === i ? "var(--accent)" : "var(--border)", boxShadow: stage === i ? "0 0 12px var(--accent)" : "none" }}>
                    {stage > i ? <Check /> : <span style={{ fontSize: 14 }}>{s.icon}</span>}
                  </div>
                  <span style={styles.stageLabel}>{s.label}</span>
                </div>
              ))}
              <div style={styles.stageBarLine}>
                <div style={{ ...styles.stageBarFill, width: `${Math.min(100, (stage / 3) * 100)}%` }} />
              </div>
            </div>

            {/* Progress */}
            <div style={styles.progressWrap}>
              <div style={styles.progressBar}>
                <div style={{ ...styles.progressFill, width: `${progress}%`, transition: "width 0.6s ease" }} />
              </div>
              <span style={styles.progressText}>{progress}%</span>
            </div>

            {/* Log */}
            <div style={styles.logBox} ref={logRef}>
              {logs.length === 0 && <div style={styles.logEmpty}>点击"开始分析"运行 Pipeline...</div>}
              {logs.map((l, i) => (
                <div key={i} style={{ ...styles.logLine, color: l.type === "success" ? "var(--green)" : l.type === "stage" ? "var(--accent)" : l.type === "done" ? "var(--gold)" : "var(--text-dim)" }}>
                  <span style={styles.logTime}>{l.time}</span> {l.msg}
                </div>
              ))}
              {running && <div style={styles.cursor}>▊</div>}
            </div>

            {/* Quick nav to results */}
            {(showGems || showReport) && (
              <div style={styles.resultNav}>
                {showGems && <button style={styles.resultNavBtn} onClick={() => setTab("gems")}>💎 查看精华评论</button>}
                {showReport && <button style={styles.resultNavBtn} onClick={() => setTab("report")}>📊 查看深度报告</button>}
              </div>
            )}
          </div>
        )}

        {/* ── GEMS TAB ── */}
        {tab === "gems" && (
          <div style={styles.gemsPage}>
            <div style={styles.gemsHeader}>
              <h2 style={styles.sectionTitle}>💎 gems.md — 精华评论集</h2>
              <span style={styles.gemsStat}>52 条精华 / 4,237 条原始（1.2% 精选率）</span>
            </div>
            <p style={styles.gemsHint}>以下是 LLM 精读后认为值得记录的评论。你可以在正式生成报告前，手动增删调整。</p>

            {DEMO_GEMS.map((gem, i) => (
              <div key={gem.id} style={styles.gemCard} onClick={() => setExpandedGem(expandedGem === i ? null : i)}>
                <div style={styles.gemTop}>
                  <span style={styles.gemIdx}>#{gem.id}</span>
                  <span style={styles.gemAuthor}>@{gem.author}</span>
                  <span style={styles.gemLikes}>👍 {gem.likes}</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ ...styles.gemChev, transform: expandedGem === i ? "rotate(180deg)" : "rotate(0)" }}><ChevDown /></div>
                </div>
                <div style={styles.gemTags}>
                  {gem.tags.map(t => <span key={t} style={styles.gemTag}>{t}</span>)}
                </div>
                <div style={styles.gemHighlight}>✦ {gem.highlight}</div>
                {expandedGem === i && (
                  <div style={styles.gemText}>{gem.text}</div>
                )}
              </div>
            ))}
            <div style={styles.gemMore}>... 还有 47 条精华评论</div>
          </div>
        )}

        {/* ── REPORT TAB ── */}
        {tab === "report" && (
          <div style={styles.reportPage}>
            <div style={styles.reportHeader}>
              <h2 style={styles.sectionTitle}>📊 深度研究报告</h2>
              <div style={styles.reportMeta}>
                <span>思考模型: {thinkerConfig.model}</span>
                <span style={styles.reportDot}>·</span>
                <span>2,847 字</span>
                <span style={styles.reportDot}>·</span>
                <span>基于 52 条精华评论</span>
              </div>
            </div>
            <div style={styles.reportBody}>
              {DEMO_REPORT.split("\n").map((line, i) => {
                if (line.startsWith("## ")) return <h2 key={i} style={styles.rptH2}>{line.replace("## ", "")}</h2>;
                if (line.startsWith("### ")) return <h3 key={i} style={styles.rptH3}>{line.replace("### ", "")}</h3>;
                if (line.startsWith("**") && line.endsWith("**")) return <p key={i} style={styles.rptBold}>{line.replace(/\*\*/g, "")}</p>;
                if (line.startsWith("💎")) return <p key={i} style={styles.rptGem}>{line}</p>;
                if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
                return <p key={i} style={styles.rptP}>{line}</p>;
              })}
            </div>
            <div style={styles.reportActions}>
              <button style={styles.actionBtn}>📋 复制 Markdown</button>
              <button style={styles.actionBtn}>📥 导出 PDF</button>
              <button style={{ ...styles.actionBtn, ...styles.actionBtnPrimary }}>🔄 重新生成（调整 Prompt）</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Styles ──
const styles = {
  root: {
    "--bg": "#0f1117",
    "--bg2": "#161822",
    "--bg3": "#1c1f2e",
    "--border": "#2a2d3e",
    "--text": "#e2e4ed",
    "--text-dim": "#8b8fa3",
    "--accent": "#6c8cff",
    "--accent2": "#4a6adf",
    "--green": "#4ade80",
    "--gold": "#fbbf24",
    "--red": "#f87171",
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
    fontSize: 13,
    color: "var(--text)",
    background: "var(--bg)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 24px", borderBottom: "1px solid var(--border)", background: "var(--bg2)",
    position: "sticky", top: 0, zIndex: 10,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  logo: { display: "flex", alignItems: "center", fontSize: 16, fontWeight: 700, color: "var(--accent)", letterSpacing: 1 },
  version: { fontSize: 10, color: "var(--text-dim)", background: "var(--bg3)", padding: "2px 6px", borderRadius: 4 },
  nav: { display: "flex", gap: 2 },
  navBtn: {
    background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer",
    padding: "6px 14px", borderRadius: 6, fontSize: 12, fontFamily: "inherit", transition: "all 0.2s",
  },
  navActive: { background: "var(--bg3)", color: "var(--accent)" },
  main: { flex: 1, padding: "20px 24px", maxWidth: 960, margin: "0 auto", width: "100%" },

  // Config page
  configPage: { display: "flex", flexDirection: "column", gap: 28 },
  section: {},
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 14px 0", letterSpacing: 0.5 },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { display: "block", fontSize: 11, color: "var(--text-dim)", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.8 },
  input: {
    width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit",
    outline: "none", transition: "border 0.2s",
  },
  providerToggle: { display: "flex", gap: 6 },
  toggleBtn: {
    display: "flex", alignItems: "center", padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)",
    background: "var(--bg)", color: "var(--text-dim)", cursor: "pointer", fontSize: 12, fontFamily: "inherit", transition: "all 0.2s",
  },
  toggleActive: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },

  // Presets
  presetGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 },
  presetCard: {
    position: "relative", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--bg2)", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "var(--text)", transition: "all 0.2s",
  },
  presetActive: { borderColor: "var(--accent)", background: "var(--bg3)" },
  presetName: { fontSize: 12, fontWeight: 600, marginBottom: 6 },
  presetDetail: { fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4, marginTop: 2 },
  presetCheck: { position: "absolute", top: 8, right: 8, color: "var(--accent)" },

  // Model Cards
  modelGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  modelCard: { background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 },
  modelCardHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
  modelCardIcon: { fontSize: 18 },
  modelCardLabel: { fontSize: 13, fontWeight: 600 },

  // Params
  paramsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 },
  paramCol: {},
  paramGroupTitle: { fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 },
  sliderGroup: { marginBottom: 16 },
  sliderHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  sliderValue: { fontSize: 13, fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums" },
  slider: { width: "100%", accentColor: "var(--accent)", cursor: "pointer", height: 4 },
  sliderHint: { fontSize: 10, color: "var(--text-dim)", marginTop: 2, fontStyle: "italic" },

  // Run
  runBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "14px 0",
    background: "linear-gradient(135deg, var(--accent), var(--accent2))", border: "none", borderRadius: 10,
    color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", letterSpacing: 1,
    transition: "all 0.3s", boxShadow: "0 4px 20px rgba(108,140,255,0.25)",
  },
  runBtnDisabled: { opacity: 0.4, cursor: "not-allowed" },

  // Pipeline
  pipelinePage: { display: "flex", flexDirection: "column", gap: 16 },
  stageBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 0", position: "relative" },
  stageItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, zIndex: 2, transition: "opacity 0.3s" },
  stageDot: {
    width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
    border: "2px solid var(--border)", transition: "all 0.3s", color: "#fff",
  },
  stageLabel: { fontSize: 11, color: "var(--text-dim)" },
  stageBarLine: { position: "absolute", left: 40, right: 40, top: 38, height: 2, background: "var(--border)", zIndex: 1 },
  stageBarFill: { height: "100%", background: "var(--accent)", borderRadius: 1, transition: "width 0.5s ease" },
  progressWrap: { display: "flex", alignItems: "center", gap: 12 },
  progressBar: { flex: 1, height: 6, background: "var(--bg3)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: "linear-gradient(90deg, var(--accent), var(--green))", borderRadius: 3 },
  progressText: { fontSize: 13, fontWeight: 700, color: "var(--accent)", width: 40, textAlign: "right", fontVariantNumeric: "tabular-nums" },

  // Log
  logBox: {
    flex: 1, minHeight: 340, maxHeight: 500, overflowY: "auto", background: "var(--bg2)", border: "1px solid var(--border)",
    borderRadius: 8, padding: 16, fontFamily: "'JetBrains Mono', 'SF Mono', monospace", fontSize: 12, lineHeight: 1.7,
  },
  logEmpty: { color: "var(--text-dim)", fontStyle: "italic" },
  logLine: { whiteSpace: "pre-wrap" },
  logTime: { color: "var(--text-dim)", marginRight: 8, fontSize: 10 },
  cursor: { color: "var(--accent)", animation: "blink 1s infinite", display: "inline-block" },
  resultNav: { display: "flex", gap: 10 },
  resultNavBtn: {
    flex: 1, padding: "10px 0", background: "var(--bg3)", border: "1px solid var(--border)",
    borderRadius: 8, color: "var(--accent)", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 600,
  },

  // Gems
  gemsPage: {},
  gemsHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  gemsStat: { fontSize: 11, color: "var(--text-dim)" },
  gemsHint: { fontSize: 12, color: "var(--text-dim)", marginBottom: 16, lineHeight: 1.6 },
  gemCard: {
    background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px",
    marginBottom: 8, cursor: "pointer", transition: "all 0.2s",
  },
  gemTop: { display: "flex", alignItems: "center", gap: 10 },
  gemIdx: { color: "var(--accent)", fontWeight: 700, fontSize: 12 },
  gemAuthor: { color: "var(--text)", fontWeight: 600, fontSize: 12 },
  gemLikes: { color: "var(--gold)", fontSize: 11 },
  gemChev: { color: "var(--text-dim)", transition: "transform 0.2s" },
  gemTags: { display: "flex", gap: 6, marginTop: 8 },
  gemTag: { fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(108,140,255,0.12)", color: "var(--accent)", fontWeight: 600 },
  gemHighlight: { fontSize: 12, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 },
  gemText: {
    fontSize: 12, color: "var(--text)", marginTop: 10, padding: "10px 12px",
    background: "var(--bg3)", borderRadius: 6, lineHeight: 1.7, borderLeft: "3px solid var(--accent)",
  },
  gemMore: { textAlign: "center", color: "var(--text-dim)", fontSize: 12, padding: 16 },

  // Report
  reportPage: {},
  reportHeader: { marginBottom: 20 },
  reportMeta: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)", marginTop: 6 },
  reportDot: { color: "var(--border)" },
  reportBody: {
    background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10,
    padding: "24px 28px", lineHeight: 1.8,
  },
  rptH2: { fontSize: 16, fontWeight: 700, color: "var(--accent)", margin: "24px 0 12px 0", fontFamily: "inherit" },
  rptH3: { fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "18px 0 8px 0", fontFamily: "inherit" },
  rptP: { fontSize: 13, color: "var(--text)", margin: "6px 0", lineHeight: 1.8 },
  rptBold: { fontSize: 13, fontWeight: 700, color: "var(--gold)", margin: "10px 0", lineHeight: 1.8 },
  rptGem: { fontSize: 13, color: "var(--green)", margin: "10px 0", lineHeight: 1.8 },
  reportActions: { display: "flex", gap: 10, marginTop: 16 },
  actionBtn: {
    padding: "8px 16px", background: "var(--bg3)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-dim)", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
  },
  actionBtnPrimary: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
};
