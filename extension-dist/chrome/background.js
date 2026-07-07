/**
 * CommentMiner Background Script / Service Worker — 多任务版
 *
 * 核心职责：
 * 1. 管理与本地后端 (localhost:8000) 的所有网络请求（避免混合内容问题）
 * 2. 同时维护「多个」分析任务的 SSE 长连接，支持两个及以上视频并行分析
 * 3. 把所有任务状态持久化到 storage.local，支持 popup 关闭/SW 终止后恢复
 * 4. 跨浏览器兼容：Chrome/Edge (service worker) + Firefox (background script)
 *
 * 与旧版（单任务）的区别：
 * - 旧版只有一个全局 activeJob + 一个 sseConnection，启动第二个分析会顶掉第一个。
 * - 新版用 jobs 字典（jobId → job）+ sseConnections 字典，任务之间互不干扰。
 * - popup 通过 videoId 匹配「当前标签页对应的任务」，因此切换页面不会丢结果。
 */

const browser = (typeof globalThis.browser !== 'undefined') ? globalThis.browser : globalThis.chrome;

// ── 配置 ──────────────────────────────────────────────────────────
const DEFAULT_BACKEND = 'http://localhost:8000';
const STORAGE_KEY = 'commentminer_jobs';      // 存的是 jobId → job 的字典
const KEEP_ALIVE_INTERVAL = 25000;            // 25 秒保活心跳（SW 30s 超时阈值）
const MAX_JOBS = 12;                          // 最多保留的任务数（不会删除运行中的）

// ── 全局状态（SW 重启后丢失，需从 storage 恢复） ──
let jobs = {};                 // jobId → { jobId, videoId, videoUrl, videoTitle, platform,
                               //           status, logs, reportMode, reportLanguage,
                               //           currentStage, startTime, completedAt, backendUrl }
let sseConnections = {};       // jobId → { closed, close }
let keepAliveTimer = null;
let connectedPorts = new Set();
let restored = false;          // 是否已从 storage 恢复过

// ── 工具函数 ──────────────────────────────────────────────────────

function getBackendUrl() {
  return new Promise((resolve) => {
    browser.storage.local.get('backend_url', (result) => {
      resolve(result.backend_url || DEFAULT_BACKEND);
    });
  });
}

function saveJobs() {
  return new Promise((resolve) => {
    browser.storage.local.set({ [STORAGE_KEY]: jobs }, resolve);
  });
}

function loadJobs() {
  return new Promise((resolve) => {
    browser.storage.local.get(STORAGE_KEY, (result) => {
      resolve(result[STORAGE_KEY] || {});
    });
  });
}

function anyRunning() {
  return Object.values(jobs).some((j) => j.status === 'running');
}

function pruneJobs() {
  const ids = Object.keys(jobs);
  if (ids.length <= MAX_JOBS) return;
  const removable = Object.values(jobs)
    .filter((j) => j.status !== 'running')
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  while (Object.keys(jobs).length > MAX_JOBS && removable.length) {
    delete jobs[removable.shift().jobId];
  }
}

function broadcastJobs() {
  broadcastToPorts({ type: 'jobsUpdate', jobs });
}

// ── SSE 连接管理（每个任务一条） ───────────────────────────────────

async function startSSEStream(jobId, backendUrl) {
  // 关掉同一任务的旧连接（避免重复）
  if (sseConnections[jobId]) {
    try { sseConnections[jobId].close(); } catch (e) {}
    delete sseConnections[jobId];
  }

  const streamUrl = `${backendUrl}/api/stream/${jobId}`;
  console.log('[CommentMiner] 连接 SSE 流:', streamUrl);

  const response = await fetch(streamUrl, {
    method: 'GET',
    headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) {
    throw new Error(`SSE 连接失败: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const conn = {
    closed: false,
    close: () => {
      conn.closed = true;
      try { reader.cancel(); } catch (e) {}
    },
  };
  sseConnections[jobId] = conn;

  startKeepAlive();

  const processStream = async () => {
    try {
      while (!conn.closed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop();

        for (const eventStr of events) {
          if (!eventStr.trim()) continue;
          const dataMatch = eventStr.match(/^data:\s*(.+)$/m);
          if (dataMatch) {
            try {
              handleSSEMessage(jobId, JSON.parse(dataMatch[1]));
            } catch (e) {
              console.warn('[CommentMiner] SSE 消息解析失败:', e, dataMatch[1]);
            }
          }
        }
      }
    } catch (e) {
      if (!conn.closed) {
        console.error('[CommentMiner] SSE 流错误:', e);
        handleSSEMessage(jobId, { type: 'error', msg: `连接中断: ${e.message}` });
      }
    } finally {
      conn.closed = true;
      delete sseConnections[jobId];
      if (!anyRunning()) stopKeepAlive();
    }
  };

  processStream();
  return true;
}

function handleSSEMessage(jobId, data) {
  const job = jobs[jobId];
  if (!job) return;

  // 结束事件
  if (data.type === 'end' || data.msg === '__END__') {
    job.status = data.type === 'error' ? 'error' : 'completed';
    job.completedAt = Date.now();
    saveJobs();
    broadcastJobs();
    fetchJobStatus(jobId).catch(() => {});
    if (!anyRunning()) stopKeepAlive();
    return;
  }

  if (!job.logs) job.logs = [];
  job.logs.push({
    ...data,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });
  if (job.logs.length > 500) job.logs = job.logs.slice(-300);

  if (!job.videoId && data.video_id) job.videoId = data.video_id;
  if (data.type === 'stage') job.currentStage = data.msg;

  if (job.logs.length % 10 === 0) saveJobs();
  broadcastJobs();
}

async function fetchJobStatus(jobId) {
  const job = jobs[jobId];
  if (!job) return;
  const backendUrl = job.backendUrl || (await getBackendUrl());
  try {
    const resp = await fetch(`${backendUrl}/api/status/${jobId}`);
    if (resp.ok) {
      const data = await resp.json();
      job.videoId = data.video_id || job.videoId;
      if (data.status) job.status = data.status;
      saveJobs();
      broadcastJobs();
    }
  } catch (e) {
    console.warn('[CommentMiner] 获取任务状态失败:', e);
  }
}

// ── 保活机制 ──────────────────────────────────────────────────────

function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    broadcastToPorts({ type: 'keepalive', timestamp: Date.now() });
    if (anyRunning()) {
      saveJobs();
    } else {
      stopKeepAlive();
    }
  }, KEEP_ALIVE_INTERVAL);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// ── 端口通信管理 ──────────────────────────────────────────────────

function broadcastToPorts(message) {
  for (const port of connectedPorts) {
    try {
      port.postMessage(message);
    } catch (e) {
      connectedPorts.delete(port);
    }
  }
}

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'commentminer-popup') return;
  connectedPorts.add(port);
  console.log('[CommentMiner] Popup 已连接');

  port.onMessage.addListener((msg) => handlePortMessage(msg, port));

  port.onDisconnect.addListener(() => {
    connectedPorts.delete(port);
    console.log('[CommentMiner] Popup 已断开');
    if (connectedPorts.size === 0 && !anyRunning()) stopKeepAlive();
  });

  // 关键：SW 可能刚被唤醒，此时 jobs 还没从 storage 恢复。必须等恢复完成再推送，
  // 否则 popup 会收到一个空的 jobsUpdate → 误显示成「需要重新开始」。
  (async () => {
    if (!restored) {
      try { await initFromStorage(); } catch (e) { console.warn(e); }
    }
    try { port.postMessage({ type: 'jobsUpdate', jobs }); } catch (e) {}
  })();
});

async function handlePortMessage(msg, port) {
  switch (msg.action) {
    case 'getCurrentVideo': {
      try {
        const videoInfo = await getCurrentTabVideoInfo();
        port.postMessage({ type: 'videoInfo', videoInfo });
      } catch (e) {
        port.postMessage({ type: 'videoInfo', videoInfo: null, error: e.message });
      }
      break;
    }

    case 'startAnalysis': {
      try {
        const result = await startAnalysis(msg.params);
        port.postMessage({ type: 'analysisStarted', job: result });
        broadcastJobs();
      } catch (e) {
        port.postMessage({ type: 'error', error: e.message });
      }
      break;
    }

    case 'getAllJobs': {
      // SW 可能刚被唤醒，先确保从 storage 恢复完成
      if (!restored) await initFromStorage();
      port.postMessage({ type: 'jobsUpdate', jobs });
      break;
    }

    case 'getGems': {
      try {
        const content = await fetchGems(msg.videoId);
        port.postMessage({ type: 'gemsContent', content, videoId: msg.videoId });
      } catch (e) {
        port.postMessage({ type: 'error', error: e.message });
      }
      break;
    }

    case 'getReport': {
      try {
        const content = await fetchReport(msg.videoId);
        port.postMessage({ type: 'reportContent', content, videoId: msg.videoId });
      } catch (e) {
        port.postMessage({ type: 'error', error: e.message });
      }
      break;
    }

    case 'clearJob': {
      const id = msg.jobId;
      if (id && sseConnections[id]) {
        try { sseConnections[id].close(); } catch (e) {}
        delete sseConnections[id];
      }
      if (id) delete jobs[id];
      if (!anyRunning()) stopKeepAlive();
      await saveJobs();
      broadcastJobs();
      break;
    }

    case 'clearFinished': {
      for (const id of Object.keys(jobs)) {
        if (jobs[id].status !== 'running') delete jobs[id];
      }
      await saveJobs();
      broadcastJobs();
      break;
    }

    case 'openDashboard': {
      const backendUrl = await getBackendUrl();
      browser.tabs.create({ url: backendUrl });
      break;
    }
  }
}

// ── 获取当前标签页视频信息 ────────────────────────────────────────

async function getCurrentTabVideoInfo() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return null;

  const url = tab.url;
  const platform = detectPlatformFromUrl(url);

  try {
    const response = await browser.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });
    if (response && response.videoId) return response;
  } catch (e) {
    console.log('[CommentMiner] content script 未就绪，从 URL 解析');
  }

  if (platform) {
    const videoId = extractVideoIdFromUrl(url, platform);
    if (videoId) {
      return { platform, videoId, title: tab.title || '', url, fromUrl: true };
    }
  }
  return null;
}

function detectPlatformFromUrl(url) {
  if (!url) return null;
  if (url.includes('bilibili.com')) return 'bilibili';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  return null;
}

function extractVideoIdFromUrl(url, platform) {
  if (platform === 'bilibili') {
    const bvMatch = url.match(/(BV[A-Za-z0-9]{10,12})/);
    if (bvMatch) return bvMatch[1];
    const avMatch = url.match(/av(\d+)/i);
    if (avMatch) return 'av' + avMatch[1];
    return null;
  }
  if (platform === 'youtube') {
    const ytMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (ytMatch) return ytMatch[1];
    const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    return null;
  }
  return null;
}

// ── 启动分析任务 ──────────────────────────────────────────────────

async function startAnalysis(params) {
  const { videoUrl, videoTitle, videoId, platform, reportMode, reportLanguage, maxComments } = params;

  // 同一视频若已有运行中的任务，直接返回该任务，避免并发跑同一视频（报告文件会互相覆盖）
  const existing = Object.values(jobs).find(
    (j) => j.videoId === videoId && j.status === 'running'
  );
  if (existing) return existing;

  const backendUrl = await getBackendUrl();
  console.log('[CommentMiner] 启动分析:', videoUrl);

  const runResp = await fetch(`${backendUrl}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_url: videoUrl,
      video_title: videoTitle || '',
      video_brief: '',
      max_comments: maxComments || 5000,
      report_mode: reportMode || 'quick',
      report_language: reportLanguage || 'zh',
      keep_per_batch: 5,
      reader: {},
      thinker: {},
    }),
  });

  if (!runResp.ok) {
    const detail = await runResp.text();
    throw new Error(`启动失败: HTTP ${runResp.status} - ${detail}`);
  }

  const { job_id } = await runResp.json();
  console.log('[CommentMiner] 任务已启动:', job_id);

  const job = {
    jobId: job_id,
    videoId: videoId || null,
    videoUrl,
    videoTitle: videoTitle || '',
    platform: platform || detectPlatformFromUrl(videoUrl),
    status: 'running',
    reportMode,
    reportLanguage,
    logs: [],
    startTime: Date.now(),
    backendUrl,
  };
  jobs[job_id] = job;
  pruneJobs();
  await saveJobs();

  try {
    await startSSEStream(job_id, backendUrl);
  } catch (e) {
    console.warn('[CommentMiner] SSE 连接失败，任务仍在后端运行');
    job.logs.push({
      type: 'warning',
      msg: `实时进度连接失败: ${e.message}（任务仍在后端运行，可刷新重试）`,
      time: new Date().toLocaleTimeString('zh-CN'),
    });
  }

  return job;
}

// ── 获取 gems 和报告 ──────────────────────────────────────────────

async function fetchGems(videoId) {
  const backendUrl = await getBackendUrl();
  const resp = await fetch(`${backendUrl}/api/gems/${videoId}`);
  if (!resp.ok) throw new Error('gems 不存在');
  return (await resp.json()).content;
}

async function fetchReport(videoId) {
  const backendUrl = await getBackendUrl();
  const resp = await fetch(`${backendUrl}/api/report/${videoId}`);
  if (!resp.ok) throw new Error('报告不存在');
  return (await resp.json()).content;
}

// ── 初始化：从 storage 恢复所有任务 ──────────────────────────────

// 用一个共享 Promise 记忆化，避免「顶层启动恢复」与「onConnect/getAllJobs 触发的恢复」
// 并发跑两遍，从而重复重连 SSE、打乱日志。
let restorePromise = null;

function initFromStorage() {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const saved = await loadJobs();

    // 恢复所有任务（completed / error 也要恢复，否则切页/重开后结果丢失）
    if (saved && typeof saved === 'object') {
      for (const [id, job] of Object.entries(saved)) {
        if (!jobs[id]) jobs[id] = job;
      }
    }
    restored = true;

    // 仅对仍在运行的任务重连 SSE，且避免重复连接
    for (const job of Object.values(jobs)) {
      if (job.status === 'running' && !sseConnections[job.jobId]) {
        try {
          await startSSEStream(job.jobId, job.backendUrl || DEFAULT_BACKEND);
        } catch (e) {
          console.warn('[CommentMiner] 恢复 SSE 连接失败:', job.jobId, e);
          fetchJobStatus(job.jobId);
        }
      }
    }
  })();
  return restorePromise;
}

// Service Worker 安装/激活事件（Chrome/Edge）
if (typeof self !== 'undefined') {
  self.addEventListener('install', () => console.log('[CommentMiner] Service Worker 已安装'));
  self.addEventListener('activate', () => {
    console.log('[CommentMiner] Service Worker 已激活');
    initFromStorage();
  });
}

// 启动时初始化（Firefox background script 和 service worker 都执行）
initFromStorage().catch(console.error);

// 监听来自 content script 的消息
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'videoPageDetected') return true;
  return false;
});

console.log('[CommentMiner] Background script (多任务版) 已加载');
