import { useState, useEffect, useRef } from "react";

const API = "";  // proxied via vite → localhost:8000

const PRESETS = {
  local: {
    name: "全本地（零成本）",
    reader:  { provider: "ollama", model: "qwen2.5:14b", baseUrl: "http://localhost:11434", apiKey: "" },
    thinker: { provider: "ollama", model: "qwq:32b",     baseUrl: "http://localhost:11434", apiKey: "" },
  },
  hybrid: {
    name: "混搭推荐",
    reader:  { provider: "ollama",            model: "qwen2.5:14b",      baseUrl: "http://localhost:11434",    apiKey: "" },
    thinker: { provider: "openai_compatible", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com", apiKey: "" },
  },
  api_budget: {
    name: "API 性价比",
    reader:  { provider: "openai_compatible", model: "deepseek-chat",     baseUrl: "https://api.deepseek.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com", apiKey: "" },
  },
  api_quality: {
    name: "API 质量优先",
    reader:  { provider: "openai_compatible", model: "claude-haiku-4-5-20251001", baseUrl: "https://api.anthropic.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "claude-sonnet-4-6",         baseUrl: "https://api.anthropic.com", apiKey: "" },
  },
};

// ── Icons ──────────────────────────────────────────────────────────────────
const Cpu     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>;
const Cloud   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
const Play    = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
const Check   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>;
const Diamond = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 22,12 12,22 2,12"/></svg>;
const Eye     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;

// ── Helpers ────────────────────────────────────────────────────────────────
function currentStage(logs) {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = logs[i].msg;
    if (m.includes("Pipeline 完成") || m.includes("✅")) return 3;
    if (m.includes("Stage 2") || m.includes("思考模型"))  return 2;
    if (m.includes("Stage 1") || m.includes("精读"))      return 1;
    if (m.includes("Stage 0") || m.includes("采集"))      return 0;
  }
  return -1;
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]         = useState("config");
  const [preset, setPreset]   = useState("hybrid");
  const [reader,  setReader]  = useState({ ...PRESETS.hybrid.reader });
  const [thinker, setThinker] = useState({ ...PRESETS.hybrid.thinker });
  const [ytKey, setYtKey]     = useState("");

  const [videoUrl,   setUrl]   = useState("");
  const [videoTitle, setTitle] = useState("");
  const [videoBrief, setBrief] = useState("");
  const [maxCmt, setMax]       = useState(5000);

  const [running, setRunning] = useState(false);
  const [logs,    setLogs]    = useState([]);
  const [videoId, setVid]     = useState(null);
  const [gems,    setGems]    = useState("");
  const [report,  setReport]  = useState("");

  const logRef = useRef(null);

  useEffect(() => {
    const p = PRESETS[preset];
    if (p) { setReader({ ...p.reader }); setThinker({ ...p.thinker }); }
  }, [preset]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const push = (msg, type = "info") => setLogs(prev => [...prev, { msg, type }]);

  const runPipeline = async () => {
    if (!videoUrl.trim()) return;
    setRunning(true); setLogs([]); setGems(""); setReport(""); setVid(null);
    setTab("pipeline");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url:    videoUrl.trim(),
          video_title:  videoTitle,
          video_brief:  videoBrief,
          max_comments: maxCmt,
          reader:  { ...reader,  youtube_api_key: ytKey },
          thinker: { ...thinker },
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { job_id } = await res.json();

      const es = new EventSource(`/api/stream/${job_id}`);
      es.onmessage = async (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "end") {
          es.close();
          setRunning(false);
          const st = await fetch(`/api/status/${job_id}`).then(r => r.json());
          const vid = st.video_id;
          setVid(vid);
          if (vid) {
            const [g, r] = await Promise.all([
              fetch(`/api/gems/${vid}`).then(x => x.ok ? x.json() : null),
              fetch(`/api/report/${vid}`).then(x => x.ok ? x.json() : null),
            ]);
            if (g) setGems(g.content);
            if (r) setReport(r.content);
          }
          return;
        }
        setLogs(prev => [...prev, data]);
      };
      es.onerror = () => { es.close(); setRunning(false); push("❌ 连接中断", "error"); };
    } catch (err) {
      push(`❌ 请求失败: ${err.message}`, "error");
      setRunning(false);
    }
  };

  const stage = currentStage(logs);
  const progress = running
    ? Math.min(90, Math.max(5, stage * 28 + 12))
    : (stage >= 3 ? 100 : (logs.length > 0 ? 5 : 0));

  // ── Sub-components ─────────────────────────────────────────────────────
  const Field = ({ label, children }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={S.label}>{label}</div>
      {children}
    </div>
  );

  const ModelCard = ({ label, cfg, setCfg, icon }) => (
    <div style={S.card}>
      <div style={S.cardHead}>{icon} <span style={{ fontWeight: 600 }}>{label}</span></div>
      <Field label="Provider">
        <div style={{ display: "flex", gap: 6 }}>
          {[["ollama", <Cpu />, "Ollama 本地"], ["openai_compatible", <Cloud />, "API"]].map(([v, ic, l]) => (
            <button key={v} onClick={() => setCfg(c => ({ ...c, provider: v }))}
              style={{ ...S.toggleBtn, ...(cfg.provider === v ? S.toggleOn : {}) }}>
              {ic}<span style={{ marginLeft: 5 }}>{l}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Model">
        <input style={S.input} value={cfg.model}
          onChange={e => setCfg(c => ({ ...c, model: e.target.value }))}
          placeholder="e.g. qwen2.5:14b" />
      </Field>
      <Field label="Base URL">
        <input style={S.input} value={cfg.baseUrl}
          onChange={e => setCfg(c => ({ ...c, baseUrl: e.target.value }))} />
      </Field>
      {cfg.provider === "openai_compatible" && (
        <Field label="API Key">
          <input style={S.input} type="password" value={cfg.apiKey}
            onChange={e => setCfg(c => ({ ...c, apiKey: e.target.value }))}
            placeholder="sk-..." />
        </Field>
      )}
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Diamond />
          <span style={{ fontWeight: 700, fontSize: 16 }}>CommentMiner</span>
          <span style={S.badge}>v0.1</span>
        </div>
        <nav style={{ display: "flex", gap: 4 }}>
          {[["config","⚙ 配置"],["pipeline","▶ Pipeline"],["gems","💎 精华"],["report","📊 报告"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ ...S.navBtn, ...(tab === k ? S.navOn : {}) }}>{l}</button>
          ))}
        </nav>
      </header>

      <main style={S.main}>

        {/* CONFIG */}
        {tab === "config" && (
          <div>
            <section style={{ marginBottom: 28 }}>
              <h2 style={S.sec}>视频信息</h2>
              <Field label="视频 URL *">
                <input style={S.input} value={videoUrl} onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..." />
              </Field>
              <Field label="视频标题（可选）">
                <input style={S.input} value={videoTitle} onChange={e => setTitle(e.target.value)}
                  placeholder="帮助 LLM 理解视频主题" />
              </Field>
              <Field label="视频简介（可选）">
                <textarea style={{ ...S.input, height: 56, resize: "vertical" }}
                  value={videoBrief} onChange={e => setBrief(e.target.value)}
                  placeholder="简要描述视频核心内容..." />
              </Field>
              <Field label="YouTube API Key（留空则读 config.yaml）">
                <input style={S.input} type="password" value={ytKey}
                  onChange={e => setYtKey(e.target.value)} placeholder="AIza..." />
              </Field>
              <Field label={`最大采集评论数：${maxCmt.toLocaleString()}`}>
                <input type="range" min={500} max={10000} step={500} value={maxCmt}
                  onChange={e => setMax(Number(e.target.value))} style={{ width: "100%", accentColor: "#6366f1" }} />
              </Field>
            </section>

            <section style={{ marginBottom: 28 }}>
              <h2 style={S.sec}>模型方案</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <button key={k} onClick={() => setPreset(k)}
                    style={{ ...S.presetCard, ...(preset === k ? S.presetOn : {}) }}>
                    {preset === k && <span style={{ position: "absolute", top: 10, right: 10, color: "#6366f1" }}><Check /></span>}
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.name}</div>
                    <div style={S.presetRow}><Cpu /> {p.reader.model}</div>
                    <div style={S.presetRow}><Cloud /> {p.thinker.model}</div>
                  </button>
                ))}
              </div>
            </section>

            <section style={{ marginBottom: 28 }}>
              <h2 style={S.sec}>模型配置</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <ModelCard label="Stage 1 · 精读模型" cfg={reader}  setCfg={setReader}  icon="📖" />
                <ModelCard label="Stage 2 · 思考模型" cfg={thinker} setCfg={setThinker} icon="🧠" />
              </div>
            </section>

            <button onClick={runPipeline} disabled={running || !videoUrl.trim()}
              style={{ ...S.runBtn, ...(running || !videoUrl.trim() ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}>
              <Play /><span style={{ marginLeft: 8 }}>开始分析</span>
            </button>
          </div>
        )}

        {/* PIPELINE */}
        {tab === "pipeline" && (
          <div>
            <div style={S.progressWrap}>
              <div style={{ ...S.progressBar, width: `${progress}%` }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {["🧹 采集&硬筛", "📖 LLM精读", "🧠 思考报告", "✅ 完成"].map((l, i) => (
                <div key={i} style={{ ...S.stageChip, ...(stage >= i ? S.stageOn : {}) }}>{l}</div>
              ))}
            </div>
            <div ref={logRef} style={S.logBox}>
              {logs.length === 0 && !running && (
                <div style={{ color: "#475569", padding: "20px 0" }}>尚未运行 — 去配置页填参数后点「开始分析」</div>
              )}
              {logs.map((l, i) => (
                <div key={i} style={{ ...S.logLine, color: logColor(l.type) }}>
                  <span style={{ color: "#1e293b", fontSize: 11, flexShrink: 0 }}>{formatTime()}</span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{l.msg}</span>
                </div>
              ))}
              {running && <div style={{ ...S.logLine, color: "#334155" }}>⏳ 运行中...</div>}
            </div>
            {(gems || report) && (
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                {gems   && <button style={S.ghostBtn} onClick={() => setTab("gems")}><Eye /> &nbsp;查看 gems.md</button>}
                {report && <button style={S.ghostBtn} onClick={() => setTab("report")}><Eye /> &nbsp;查看报告</button>}
              </div>
            )}
          </div>
        )}

        {/* GEMS */}
        {tab === "gems" && (
          gems
            ? <pre style={S.mdBox}>{gems}</pre>
            : <Empty icon="💎" text="精华评论将在 Stage 1 完成后出现" />
        )}

        {/* REPORT */}
        {tab === "report" && (
          report
            ? <pre style={S.mdBox}>{report}</pre>
            : <Empty icon="📊" text="深度报告将在 Stage 2 完成后出现" />
        )}
      </main>
    </div>
  );
}

const Empty = ({ icon, text }) => (
  <div style={{ textAlign: "center", padding: "80px 0", color: "#475569" }}>
    <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
    <div>{text}</div>
  </div>
);

let _logTime = null;
const formatTime = () => {
  _logTime = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return _logTime;
};

const logColor = (type) =>
  type === "stage"   ? "#a78bfa" :
  type === "success" ? "#34d399" :
  type === "error"   ? "#f87171" :
  type === "done"    ? "#60a5fa" : "#94a3b8";

const S = {
  root:        { minHeight: "100vh", background: "#0f1117", color: "#e2e8f0", fontFamily: "system-ui,-apple-system,sans-serif", fontSize: 14 },
  header:      { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid #1e2435", background: "#0d1020", position: "sticky", top: 0, zIndex: 10 },
  badge:       { fontSize: 11, color: "#64748b", background: "#1e2435", padding: "2px 6px", borderRadius: 4 },
  navBtn:      { background: "transparent", border: "none", color: "#64748b", cursor: "pointer", padding: "6px 12px", borderRadius: 6, fontSize: 13 },
  navOn:       { background: "#1e2435", color: "#e2e8f0" },
  main:        { maxWidth: 900, margin: "0 auto", padding: "28px 20px" },
  sec:         { fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 0, marginBottom: 14 },
  label:       { fontSize: 12, color: "#64748b", marginBottom: 5 },
  input:       { width: "100%", background: "#141929", border: "1px solid #1e2a40", borderRadius: 6, color: "#e2e8f0", padding: "8px 10px", fontSize: 13, boxSizing: "border-box", outline: "none" },
  card:        { background: "#141929", border: "1px solid #1e2a40", borderRadius: 8, padding: "14px 16px" },
  cardHead:    { display: "flex", alignItems: "center", gap: 6, marginBottom: 14 },
  toggleBtn:   { display: "flex", alignItems: "center", background: "#0f1117", border: "1px solid #1e2a40", borderRadius: 6, color: "#64748b", cursor: "pointer", padding: "5px 10px", fontSize: 12 },
  toggleOn:    { border: "1px solid #6366f1", color: "#a78bfa", background: "#1a1f3a" },
  presetCard:  { background: "#141929", border: "1px solid #1e2a40", borderRadius: 8, padding: "12px 14px", cursor: "pointer", textAlign: "left", position: "relative" },
  presetOn:    { border: "1px solid #6366f1", background: "#1a1f3a" },
  presetRow:   { display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#475569", marginTop: 4 },
  runBtn:      { display: "flex", alignItems: "center", justifyContent: "center", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  progressWrap:{ height: 3, background: "#1e2435", borderRadius: 2, marginBottom: 20, overflow: "hidden" },
  progressBar: { height: "100%", background: "linear-gradient(90deg,#6366f1,#a78bfa)", borderRadius: 2, transition: "width 0.5s ease" },
  stageChip:   { flex: 1, background: "#141929", border: "1px solid #1e2435", borderRadius: 7, padding: "9px 6px", textAlign: "center", fontSize: 12, color: "#475569", transition: "all 0.3s" },
  stageOn:     { border: "1px solid #6366f1", color: "#a78bfa", background: "#1a1f3a" },
  logBox:      { background: "#080b12", border: "1px solid #1e2435", borderRadius: 8, padding: "14px 16px", minHeight: 260, maxHeight: 420, overflowY: "auto", fontFamily: "monospace", fontSize: 13 },
  logLine:     { display: "flex", gap: 10, marginBottom: 3, lineHeight: 1.6 },
  ghostBtn:    { display: "flex", alignItems: "center", gap: 6, background: "#141929", border: "1px solid #1e2435", borderRadius: 6, color: "#64748b", cursor: "pointer", padding: "7px 14px", fontSize: 12 },
  mdBox:       { background: "#080b12", border: "1px solid #1e2435", borderRadius: 8, padding: "18px 20px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 13, lineHeight: 1.8, overflowY: "auto", maxHeight: "calc(100vh - 140px)", color: "#cbd5e1", margin: 0 },
};
