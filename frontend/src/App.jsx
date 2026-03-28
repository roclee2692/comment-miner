import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const PRESETS = {
  gemini: {
    name: "Google Gemini（有$300赠金）",
    desc: "免费额度充裕，效果好",
    reader:  { provider: "openai_compatible", model: "gemini-3.1-flash-lite-preview", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "gemini-3.1-pro-preview",        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKey: "" },
  },
  deepseek: {
    name: "DeepSeek（性价比之王）",
    desc: "约 ¥0.3/次，国产最强",
    reader:  { provider: "openai_compatible", model: "deepseek-chat",     baseUrl: "https://api.deepseek.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com", apiKey: "" },
  },
  openai: {
    name: "OpenAI GPT-5.4",
    desc: "最新旗舰，约 $0.5/次",
    reader:  { provider: "openai_compatible", model: "gpt-5.4-mini", baseUrl: "https://api.openai.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "gpt-5.4",      baseUrl: "https://api.openai.com", apiKey: "" },
  },
  claude: {
    name: "Claude 4.6",
    desc: "Anthropic，约 $0.8/次",
    reader:  { provider: "openai_compatible", model: "claude-haiku-4-5-20251001", baseUrl: "https://api.anthropic.com", apiKey: "" },
    thinker: { provider: "openai_compatible", model: "claude-sonnet-4-6",         baseUrl: "https://api.anthropic.com", apiKey: "" },
  },
  local: {
    name: "全本地（零成本）",
    desc: "需要 Ollama + GPU",
    reader:  { provider: "ollama", model: "qwen2.5:14b", baseUrl: "http://localhost:11434", apiKey: "" },
    thinker: { provider: "ollama", model: "qwq:32b",     baseUrl: "http://localhost:11434", apiKey: "" },
  },
  hybrid: {
    name: "混搭（本地+API）",
    desc: "本地精读 + API 写报告",
    reader:  { provider: "ollama",            model: "qwen2.5:14b",      baseUrl: "http://localhost:11434",    apiKey: "" },
    thinker: { provider: "openai_compatible", model: "deepseek-reasoner", baseUrl: "https://api.deepseek.com", apiKey: "" },
  },
};

// ── Icons ──────────────────────────────────────────────────────────────────
const Cpu     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg>;
const Cloud   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
const Play    = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
const Check   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>;
const Diamond = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 22,12 12,22 2,12"/></svg>;
const Eye     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const Copy    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const Retry   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;

// ── Helpers ────────────────────────────────────────────────────────────────
const now = () => new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const STORAGE_KEY = "commentminer_config";
const KEYS_STORAGE = "commentminer_apikeys"; // baseUrl → apiKey 映射

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// 记住每个平台的 API Key（按 baseUrl 存）
function loadKeyMap() {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveKey(baseUrl, apiKey) {
  if (!baseUrl) return;
  try {
    const map = loadKeyMap();
    if (apiKey) map[baseUrl] = apiKey;
    else delete map[baseUrl];
    localStorage.setItem(KEYS_STORAGE, JSON.stringify(map));
  } catch {}
}

function getKey(baseUrl) {
  return loadKeyMap()[baseUrl] || "";
}

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

function isValidUrl(url) {
  // YouTube
  if (/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)[A-Za-z0-9_-]{11}/.test(url)) return "youtube";
  // B站（完整链接或 b23.tv 短链接）
  if (/bilibili\.com\/video\/BV/.test(url) || /b23\.tv\//.test(url)) return "bilibili";
  return null;
}

function isYouTubeUrl(url) {
  return isValidUrl(url) === "youtube";
}

// ── App ────────────────────────────────────────────────────────────────────
const _saved = loadSaved();

export default function App() {
  const [tab, setTab]         = useState("config");
  const [preset, setPreset]   = useState(_saved?.preset || "gemini");
  const [reader,  setReader]  = useState(_saved?.reader  || { ...PRESETS.gemini.reader });
  const [thinker, setThinker] = useState(_saved?.thinker || { ...PRESETS.gemini.thinker });
  const [ytKey, setYtKey]     = useState(_saved?.ytKey || getKey("__youtube__") || "");
  const [biliSess, setBiliSess] = useState(_saved?.biliSess || getKey("__bilibili_sessdata__") || "");

  const [videoUrl,   setUrl]   = useState("");
  const [videoTitle, setTitle] = useState("");
  const [videoBrief, setBrief] = useState("");
  const [maxCmt, setMax]       = useState(_saved?.maxCmt || 5000);

  const [running, setRunning] = useState(false);
  const [logs,    setLogs]    = useState([]);
  const [videoId, setVid]     = useState(null);
  const [gems,    setGems]    = useState("");
  const [report,  setReport]  = useState("");
  const [copied,  setCopied]  = useState("");
  const [urlError, setUrlErr] = useState("");

  const logRef = useRef(null);
  const esRef  = useRef(null);

  // 切换预设时：换模型和 URL，但自动填入之前保存过的 API Key
  useEffect(() => {
    const p = PRESETS[preset];
    if (!p) return;
    setReader({ ...p.reader,  apiKey: getKey(p.reader.baseUrl) });
    setThinker({ ...p.thinker, apiKey: getKey(p.thinker.baseUrl) });
  }, [preset]);

  // 自动保存配置到 localStorage
  useEffect(() => {
    saveConfig({ preset, reader, thinker, ytKey, biliSess, maxCmt });
  }, [preset, reader, thinker, ytKey, biliSess, maxCmt]);

  // API Key 变化时，按 baseUrl 记住
  useEffect(() => {
    if (reader.apiKey)  saveKey(reader.baseUrl, reader.apiKey);
    if (thinker.apiKey) saveKey(thinker.baseUrl, thinker.apiKey);
    if (ytKey) saveKey("__youtube__", ytKey);
    if (biliSess) saveKey("__bilibili_sessdata__", biliSess);
  }, [reader.apiKey, reader.baseUrl, thinker.apiKey, thinker.baseUrl, ytKey, biliSess]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => { if (esRef.current) esRef.current.close(); };
  }, []);

  const handleUrlChange = (val) => {
    setUrl(val);
    if (val.trim() && !isValidUrl(val.trim())) {
      setUrlErr("请输入 YouTube 或 B站 视频链接");
    } else {
      setUrlErr("");
    }
  };

  const copyToClipboard = useCallback(async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    }
  }, []);

  const runPipeline = async () => {
    const url = videoUrl.trim();
    if (!url || !isValidUrl(url)) return;
    setRunning(true); setLogs([]); setGems(""); setReport(""); setVid(null);
    setTab("pipeline");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url:    url,
          video_title:  videoTitle,
          video_brief:  videoBrief,
          max_comments: maxCmt,
          bilibili_sessdata: biliSess,
          reader:  { ...reader,  youtube_api_key: ytKey },
          thinker: { ...thinker },
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail}`);
      }
      const { job_id } = await res.json();

      if (esRef.current) esRef.current.close();
      const es = new EventSource(`/api/stream/${job_id}`);
      esRef.current = es;

      es.onmessage = async (e) => {
        const data = JSON.parse(e.data);
        if (data.type === "end") {
          es.close();
          esRef.current = null;
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
        setLogs(prev => [...prev, { ...data, time: now() }]);
      };
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setRunning(false);
        setLogs(prev => [...prev, { msg: "❌ 连接中断，请检查后端是否正常运行", type: "error", time: now() }]);
      };
    } catch (err) {
      setLogs(prev => [...prev, { msg: `❌ 请求失败: ${err.message}`, type: "error", time: now() }]);
      setRunning(false);
    }
  };

  const stage = currentStage(logs);
  const progress = running
    ? Math.min(90, Math.max(5, stage * 28 + 12))
    : (stage >= 3 ? 100 : (logs.length > 0 ? 5 : 0));

  const canRun = videoUrl.trim() && isValidUrl(videoUrl.trim()) && !running;

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
          {[["ollama", <Cpu key="cpu" />, "Ollama 本地"], ["openai_compatible", <Cloud key="cloud" />, "API"]].map(([v, ic, l]) => (
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

  const CopyBtn = ({ text, label }) => (
    <button
      style={{ ...S.ghostBtn, ...(copied === label ? { color: "#34d399", borderColor: "#34d399" } : {}) }}
      onClick={() => copyToClipboard(text, label)}
      title="复制到剪贴板"
    >
      {copied === label ? <><Check /> &nbsp;已复制</> : <><Copy /> &nbsp;复制</>}
    </button>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Diamond />
          <span style={{ fontWeight: 700, fontSize: 16 }}>CommentMiner</span>
          <span style={S.badge}>v0.2</span>
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
                <input style={{ ...S.input, ...(urlError ? { borderColor: "#f87171" } : {}) }}
                  value={videoUrl} onChange={e => handleUrlChange(e.target.value)}
                  placeholder="YouTube 或 B站链接，如 https://www.bilibili.com/video/BV..." />
                {urlError && <div style={{ color: "#f87171", fontSize: 11, marginTop: 4 }}>{urlError}</div>}
              </Field>
              <Field label="视频标题（可选，帮助 LLM 理解主题）">
                <input style={S.input} value={videoTitle} onChange={e => setTitle(e.target.value)}
                  placeholder="例如：一加13T 深度评测" />
              </Field>
              <Field label="视频简介（可选）">
                <textarea style={{ ...S.input, height: 56, resize: "vertical" }}
                  value={videoBrief} onChange={e => setBrief(e.target.value)}
                  placeholder="简要描述视频核心内容..." />
              </Field>
              <Field label="YouTube API Key（仅 YouTube 需要，B站无需填写）">
                <input style={S.input} type="password" value={ytKey}
                  onChange={e => setYtKey(e.target.value)} placeholder="AIza..." />
              </Field>
              <Field label="B站 SESSDATA Cookie（可选，提高B站采集稳定性）">
                <input style={S.input} type="password" value={biliSess}
                  onChange={e => setBiliSess(e.target.value)}
                  placeholder="填入后可避免反爬拦截" />
                <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                  获取方式：浏览器登录 B站 → F12 → Application → Cookies → bilibili.com → 复制 SESSDATA 的值
                </div>
              </Field>
              <Field label={`最大采集评论数：${maxCmt.toLocaleString()}`}>
                <input type="range" min={500} max={10000} step={500} value={maxCmt}
                  onChange={e => setMax(Number(e.target.value))} style={{ width: "100%", accentColor: "#6366f1" }} />
              </Field>
            </section>

            <section style={{ marginBottom: 28 }}>
              <h2 style={S.sec}>模型方案</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {Object.entries(PRESETS).map(([k, p]) => (
                  <button key={k} onClick={() => setPreset(k)}
                    style={{ ...S.presetCard, ...(preset === k ? S.presetOn : {}) }}>
                    {preset === k && <span style={{ position: "absolute", top: 8, right: 8, color: "#6366f1" }}><Check /></span>}
                    <div style={{ fontWeight: 600, marginBottom: 2, fontSize: 13 }}>{p.name}</div>
                    {p.desc && <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>{p.desc}</div>}
                    <div style={S.presetRow}><Eye /> {p.reader.model}</div>
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

            <button onClick={runPipeline} disabled={!canRun}
              style={{ ...S.runBtn, ...(!canRun ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}>
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
                  <span style={{ color: "#475569", fontSize: 11, flexShrink: 0, fontFamily: "monospace" }}>{l.time}</span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{l.msg}</span>
                </div>
              ))}
              {running && <div style={{ ...S.logLine, color: "#6366f1" }}>
                <span style={S.spinner} /> 运行中...
              </div>}
            </div>
            {!running && logs.length > 0 && stage < 3 && (
              <button style={{ ...S.ghostBtn, marginTop: 14 }} onClick={() => setTab("config")}>
                <Retry /> &nbsp;返回配置重试
              </button>
            )}
            {(gems || report) && (
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                {gems   && <button style={S.ghostBtn} onClick={() => setTab("gems")}><Eye /> &nbsp;查看精华评论</button>}
                {report && <button style={S.ghostBtn} onClick={() => setTab("report")}><Eye /> &nbsp;查看分析报告</button>}
              </div>
            )}
          </div>
        )}

        {/* GEMS */}
        {tab === "gems" && (
          gems ? (
            <div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 8 }}>
                <CopyBtn text={gems} label="gems" />
              </div>
              <div style={S.mdBox} className="md-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{gems}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <Empty icon="💎" text="精华评论将在 Stage 1 完成后出现" />
          )
        )}

        {/* REPORT */}
        {tab === "report" && (
          report ? (
            <div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 8 }}>
                <CopyBtn text={report} label="report" />
              </div>
              <div style={S.mdBox} className="md-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <Empty icon="📊" text="深度报告将在 Stage 2 完成后出现" />
          )
        )}
      </main>

      <footer style={S.footer}>
        <span>Made by <strong>Raelon</strong></span>
        <span style={S.footerDot} />
        <span>开源免费</span>
        <span style={S.footerDot} />
        <a href="https://github.com/roclee2692/comment-miner" target="_blank" rel="noreferrer" style={S.footerLink}>GitHub</a>
        <span style={S.footerDot} />
        <span style={{ color: "#475569" }}>CC BY-NC 4.0 — 禁止商用</span>
      </footer>
    </div>
  );
}

const Empty = ({ icon, text }) => (
  <div style={{ textAlign: "center", padding: "80px 0", color: "#475569" }}>
    <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
    <div>{text}</div>
  </div>
);

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
  runBtn:      { display: "flex", alignItems: "center", justifyContent: "center", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer", width: "100%" },
  progressWrap:{ height: 3, background: "#1e2435", borderRadius: 2, marginBottom: 20, overflow: "hidden" },
  progressBar: { height: "100%", background: "linear-gradient(90deg,#6366f1,#a78bfa)", borderRadius: 2, transition: "width 0.5s ease" },
  stageChip:   { flex: 1, background: "#141929", border: "1px solid #1e2435", borderRadius: 7, padding: "9px 6px", textAlign: "center", fontSize: 12, color: "#475569", transition: "all 0.3s" },
  stageOn:     { border: "1px solid #6366f1", color: "#a78bfa", background: "#1a1f3a" },
  logBox:      { background: "#080b12", border: "1px solid #1e2435", borderRadius: 8, padding: "14px 16px", minHeight: 260, maxHeight: 420, overflowY: "auto", fontFamily: "monospace", fontSize: 13 },
  logLine:     { display: "flex", gap: 10, marginBottom: 3, lineHeight: 1.6 },
  ghostBtn:    { display: "flex", alignItems: "center", gap: 6, background: "#141929", border: "1px solid #1e2435", borderRadius: 6, color: "#64748b", cursor: "pointer", padding: "7px 14px", fontSize: 12 },
  mdBox:       { background: "#080b12", border: "1px solid #1e2435", borderRadius: 8, padding: "18px 24px", overflowY: "auto", maxHeight: "calc(100vh - 180px)", color: "#cbd5e1", lineHeight: 1.8 },
  spinner:     { display: "inline-block", width: 12, height: 12, border: "2px solid #6366f1", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  footer:      { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "18px 24px", borderTop: "1px solid #1e2435", color: "#64748b", fontSize: 12 },
  footerDot:   { width: 3, height: 3, borderRadius: "50%", background: "#2a3a54" },
  footerLink:  { color: "#6366f1", textDecoration: "none" },
};
