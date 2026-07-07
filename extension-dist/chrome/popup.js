/**
 * CommentMiner Popup Script — 多任务版
 *
 * 与旧版区别：
 * - 不再只跟踪一个任务。background 维护一个 jobs 字典，popup 用 videoId
 *   匹配「当前标签页对应的任务」，因此切换标签页能看到各自的进度/结果。
 * - 任务列表（tasksBar）列出所有进行中/已完成的任务，可点击切换查看。
 * - 点击视频卡片可回到「分析当前视频」的配置界面（用于并行启动新任务）。
 */

const browser = (typeof globalThis.browser !== 'undefined') ? globalThis.browser : globalThis.chrome;

// ── 状态 ──────────────────────────────────────────────────────────
let port = null;
let currentVideo = null;
let selectedLang = 'zh';
let selectedMode = 'quick';
let maxComments = 5000;

let jobs = {};               // jobId → job（来自 background）
let selectedJobId = null;    // 当前查看的任务
let autoSelect = true;       // true 时根据当前视频自动选任务；用户手动点选后置 false

let pendingAction = 'inline';   // 内容到达后的处理方式：'inline' | 'tab'
let currentPreview = null;      // { type, content, videoId } 最近一次取到的内容
let lastRenderedJobId = undefined;

// ── DOM 元素 ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const videoCard = $('videoCard');
const tasksBar = $('tasksBar');
const startBtn = $('startBtn');
const configSection = $('configSection');
const progressSection = $('progressSection');
const resultSection = $('resultSection');
const errorBox = $('errorBox');
const logBox = $('logBox');
const progressBar = $('progressBar');
const viewingLabel = $('viewingLabel');
const backendStatus = $('backendStatus');

// ── 初始化 ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  connectToBackground();
  await loadCurrentVideo();
  loadSettings();
  requestJobs();
  bindEvents();
}

function connectToBackground() {
  try {
    port = browser.runtime.connect({ name: 'commentminer-popup' });
    port.onMessage.addListener(handleBackgroundMessage);
    port.onDisconnect.addListener(() => {
      console.log('[Popup] 与 background 的连接断开');
      // 重连后必须重新拉取视频与任务：SW 可能被回收又唤醒，
      // 若不重新请求，popup 会停留在断连那一刻的（可能为空的）状态。
      setTimeout(() => {
        connectToBackground();
        loadCurrentVideo();
        requestJobs();
      }, 800);
    });
    console.log('[Popup] 已连接到 background');
  } catch (e) {
    console.error('[Popup] 连接 background 失败:', e);
  }
}

function handleBackgroundMessage(msg) {
  switch (msg.type) {
    case 'videoInfo':
      if (msg.videoInfo) {
        currentVideo = msg.videoInfo;
      } else {
        currentVideo = null;
        renderNoVideo(msg.error);
      }
      renderAll();
      break;

    case 'jobsUpdate':
      jobs = msg.jobs || {};
      renderAll();
      break;

    case 'analysisStarted':
      if (msg.job) {
        jobs[msg.job.jobId] = msg.job;
        autoSelect = false;
        selectedJobId = msg.job.jobId;
        renderAll();
      }
      break;

    case 'gemsContent':
      handleContent('gems', msg.content, msg.videoId);
      break;

    case 'reportContent':
      handleContent('report', msg.content, msg.videoId);
      break;

    case 'error':
      showError(msg.error);
      break;

    case 'keepalive':
      break;
  }
}

// ── 视频信息 ──────────────────────────────────────────────────────
async function loadCurrentVideo() {
  if (!port) {
    setTimeout(loadCurrentVideo, 200);
    return;
  }
  port.postMessage({ action: 'getCurrentVideo' });
}

function requestJobs() {
  if (!port) {
    setTimeout(requestJobs, 200);
    return;
  }
  port.postMessage({ action: 'getAllJobs' });
}

function renderVideoCard() {
  if (!currentVideo) {
    renderNoVideo();
    return;
  }
  const platformName = currentVideo.platform === 'bilibili' ? 'B站' : 'YouTube';
  videoCard.innerHTML = `
    <div class="platform-tag ${currentVideo.platform}">${platformName}</div>
    <div class="video-title">${escapeHtml(currentVideo.title || '未知标题')}</div>
    <div class="video-id">${escapeHtml(currentVideo.videoId || '')}</div>
  `;
}

function renderNoVideo(error) {
  videoCard.innerHTML = `
    <div class="no-video">
      <div class="no-video-icon">🎬</div>
      <div>请打开 B站 或 YouTube 视频页面</div>
      ${error ? `<div style="font-size:11px;margin-top:6px;opacity:0.6">${escapeHtml(error)}</div>` : ''}
    </div>
  `;
}

// ── 任务选择 / 渲染调度 ───────────────────────────────────────────

function jobsSortedByTime() {
  return Object.values(jobs).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

function pickDefaultSelection() {
  if (currentVideo && currentVideo.videoId) {
    const forVideo = Object.values(jobs)
      .filter((j) => j.videoId === currentVideo.videoId)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    selectedJobId = forVideo.length ? forVideo[0].jobId : null;
  } else {
    const all = jobsSortedByTime();
    selectedJobId = all.length ? all[0].jobId : null;
  }
}

function selectJob(jobId) {
  autoSelect = false;
  selectedJobId = jobId;
  showError('');
  renderAll();
}

function goToConfigForCurrentVideo() {
  autoSelect = false;
  selectedJobId = null;
  showError('');
  renderAll();
}

function resetPreview() {
  currentPreview = null;
  const pb = $('previewBox');
  if (pb) {
    pb.classList.add('hidden');
    pb.innerHTML = '';
  }
  const g = $('viewGemsBtn');
  const r = $('viewReportBtn');
  if (g) g.classList.remove('active');
  if (r) r.classList.remove('active');
}

function renderAll() {
  // 自动选择：未手动点选时，按当前视频挑对应任务
  if (autoSelect) {
    pickDefaultSelection();
  } else if (selectedJobId && !jobs[selectedJobId]) {
    // 选中的任务被清除了 → 回到自动
    autoSelect = true;
    pickDefaultSelection();
  }

  // 切换到不同任务时清掉旧预览，避免串内容
  if (selectedJobId !== lastRenderedJobId) {
    resetPreview();
    lastRenderedJobId = selectedJobId;
  }

  renderVideoCard();
  renderTasksBar();

  const job = selectedJobId ? jobs[selectedJobId] : null;
  if (job) {
    renderJobView(job);
  } else {
    showConfigView();
  }
}

function renderTasksBar() {
  const list = jobsSortedByTime();
  if (!list.length) {
    tasksBar.classList.add('hidden');
    tasksBar.innerHTML = '';
    return;
  }
  tasksBar.classList.remove('hidden');

  const hasFinished = list.some((j) => j.status !== 'running');
  const statusText = (s) => (s === 'running' ? '分析中' : s === 'error' ? '失败' : '完成');
  const statusIcon = (s) =>
    s === 'running'
      ? '<span class="task-chip-icon spin">⏳</span>'
      : s === 'error'
      ? '<span class="task-chip-icon">⚠️</span>'
      : '<span class="task-chip-icon">✅</span>';

  const chips = list
    .map((j) => {
      const title = escapeHtml(j.videoTitle || j.videoId || '分析任务');
      const active = j.jobId === selectedJobId ? ' active' : '';
      return `
        <button class="task-chip status-${j.status}${active}" data-job="${j.jobId}">
          ${statusIcon(j.status)}
          <span class="task-chip-title">${title}</span>
          <span class="task-chip-status">${statusText(j.status)}</span>
        </button>`;
    })
    .join('');

  tasksBar.innerHTML = `
    <div class="tasks-bar-title">
      <span>分析任务（${list.length}）</span>
      ${hasFinished ? '<button class="tasks-clear" id="clearFinishedBtn">清除已完成</button>' : ''}
    </div>
    <div class="task-chips">${chips}</div>
  `;

  tasksBar.querySelectorAll('.task-chip').forEach((c) => {
    c.addEventListener('click', () => selectJob(c.dataset.job));
  });
  const clearBtn = $('clearFinishedBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      port.postMessage({ action: 'clearFinished' });
    });
  }
}

// ── 启动分析 ──────────────────────────────────────────────────────
function startAnalysis() {
  if (!currentVideo || !currentVideo.videoId) return;

  // 当前视频已有运行中的任务 → 直接切到它，不重复启动
  const running = Object.values(jobs).find(
    (j) => j.videoId === currentVideo.videoId && j.status === 'running'
  );
  if (running) {
    selectJob(running.jobId);
    return;
  }

  showError('');
  port.postMessage({
    action: 'startAnalysis',
    params: {
      videoUrl: currentVideo.url,
      videoTitle: currentVideo.title,
      videoId: currentVideo.videoId,
      platform: currentVideo.platform,
      reportMode: selectedMode,
      reportLanguage: selectedLang,
      maxComments: maxComments,
    },
  });
}

// ── 任务视图渲染 ──────────────────────────────────────────────────
function renderJobView(job) {
  const logs = job.logs || [];

  logBox.innerHTML = logs
    .map(
      (log) => `
    <div class="log-line type-${log.type || 'info'}">
      <span class="log-time">${log.time || ''}</span>
      <span class="log-msg">${escapeHtml(log.msg || '')}</span>
    </div>`
    )
    .join('');
  logBox.scrollTop = logBox.scrollHeight;

  const stage = getCurrentStage(logs);
  progressBar.style.width = `${calculateProgress(logs, stage, job.status)}%`;

  document.querySelectorAll('.stage-chip').forEach((chip, i) => {
    chip.classList.remove('active', 'done');
    if (i < stage) chip.classList.add('done');
    else if (i === stage && job.status === 'running') chip.classList.add('active');
    else if ((job.status === 'completed' || job.status === 'done') && i <= 3) chip.classList.add('done');
  });

  // 查看的任务与当前标签页视频不一致时，给出提示
  const differs = !currentVideo || job.videoId !== currentVideo.videoId;
  if (differs) {
    viewingLabel.classList.remove('hidden');
    viewingLabel.textContent = `正在查看：${job.videoTitle || job.videoId || '其它视频'}`;
  } else {
    viewingLabel.classList.add('hidden');
  }

  const done = job.status === 'completed' || job.status === 'done';
  if (done) {
    showResultView();
  } else if (job.status === 'error') {
    showProgressView(); // 保留日志可见，便于排查失败原因
  } else {
    showProgressView();
  }

  updateStartButton();
}

function getCurrentStage(logs) {
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = logs[i].msg || '';
    if (msg.includes('Pipeline 完成') || msg.includes('✅')) return 3;
    if (msg.includes('Stage 2')) return 2;
    if (msg.includes('Stage 1')) return 1;
    if (msg.includes('Stage 0') || msg.includes('采集')) return 0;
  }
  return -1;
}

function calculateProgress(logs, stage, status) {
  if (status === 'completed' || status === 'done') return 100;
  if (logs.length === 0) return 0;
  const baseProgress = stage * 30;
  const logCount = logs.filter((l) => l.type === 'info').length;
  const stageProgress = Math.min(25, logCount * 2);
  return Math.min(95, baseProgress + stageProgress);
}

function updateStartButton() {
  if (!currentVideo || !currentVideo.videoId) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="btn-icon">▶</span><span class="btn-text">开始分析</span>';
    return;
  }
  const running = Object.values(jobs).find(
    (j) => j.videoId === currentVideo.videoId && j.status === 'running'
  );
  if (running) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">该视频分析中...</span>';
  } else {
    startBtn.disabled = false;
    startBtn.innerHTML = '<span class="btn-icon">▶</span><span class="btn-text">开始分析</span>';
  }
}

// ── 视图切换 ──────────────────────────────────────────────────────
function showConfigView() {
  configSection.classList.remove('hidden');
  startBtn.classList.remove('hidden');
  progressSection.classList.add('hidden');
  resultSection.classList.add('hidden');
  viewingLabel.classList.add('hidden');
  updateStartButton();
}

function showProgressView() {
  configSection.classList.add('hidden');
  startBtn.classList.add('hidden');
  progressSection.classList.remove('hidden');
  resultSection.classList.add('hidden');
}

function showResultView() {
  configSection.classList.add('hidden');
  startBtn.classList.add('hidden');
  progressSection.classList.remove('hidden');
  resultSection.classList.remove('hidden');
}

// ── 查看结果 ──────────────────────────────────────────────────────
// 三种查看方式共用同一份内容获取流程：viewGems/viewReport 触发，
// background 取回后走 handleContent，根据 pendingAction 决定内嵌预览还是新标签打开。

function requestContent(type) {
  const job = jobs[selectedJobId];
  const vid = job?.videoId;
  if (!vid) {
    showError('该任务还没有可查看的结果');
    return;
  }
  port.postMessage({ action: type === 'gems' ? 'getGems' : 'getReport', videoId: vid });
}

function viewGems() {
  pendingAction = 'inline';
  requestContent('gems');
}

function viewReport() {
  pendingAction = 'inline';
  requestContent('report');
}

function handleContent(type, content, videoId) {
  currentPreview = { type, content, videoId };
  if (pendingAction === 'tab') {
    openContentPage(type, content, videoId);
  } else {
    renderPreview(type, content);
  }
}

function renderPreview(type, content) {
  const previewBox = $('previewBox');
  const head = type === 'gems' ? '💎 精华评论' : '📊 分析报告';
  previewBox.innerHTML =
    `<div class="preview-head">${head}</div>` + renderMarkdown(content);
  previewBox.classList.remove('hidden');
  previewBox.scrollTop = 0;
  // 高亮当前预览的按钮
  $('viewGemsBtn').classList.toggle('active', type === 'gems');
  $('viewReportBtn').classList.toggle('active', type === 'report');
}

// 新标签整页查看：内容在 popup 端本地渲染好再注入，不依赖任何 CDN（修复整页空白）。
function openContentPage(type, content, videoId) {
  const titleText = type === 'gems' ? '精华评论' : '分析报告';
  const body = renderMarkdown(content);
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CommentMiner - ${titleText}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f1117; color: #cbd5e1; padding: 40px 20px; line-height: 1.8; }
    .container { max-width: 820px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 20px; border-bottom: 1px solid #1e2a40; padding-bottom: 12px; }
    .header h1 { font-size: 22px; color: #e2e8f0; }
    .badge { background: #141929; padding: 4px 12px; border-radius: 20px; font-size: 12px; color: #64748b; }
    h1, h2, h3, h4 { color: #e2e8f0; margin: 20px 0 10px; }
    h2 { font-size: 18px; color: #a78bfa; }
    h3 { font-size: 15px; color: #93c5fd; }
    p { margin: 8px 0; }
    ul, ol { margin: 10px 0 10px 24px; }
    li { margin: 4px 0; }
    blockquote { border-left: 3px solid #6366f1; padding-left: 12px; margin: 10px 0; color: #94a3b8; }
    code { background: #141929; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    pre { background: #080b12; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 10px 0; }
    pre code { background: transparent; padding: 0; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #1e2a40; margin: 20px 0; }
    strong { color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💎 CommentMiner · ${titleText}</h1>
      <span class="badge">${escapeHtml(videoId || '')}</span>
    </div>
    <div class="content">${body}</div>
  </div>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  browser.tabs.create({ url });
}

// 新标签打开当前预览的内容（没有预览过则默认打开报告）
function openInTab() {
  if (currentPreview) {
    openContentPage(currentPreview.type, currentPreview.content, currentPreview.videoId);
  } else {
    pendingAction = 'tab';
    requestContent('report');
  }
}

// 右侧边栏查看（Chrome/Edge 原生 side panel，约占 1/4 屏）
async function openSidePanel() {
  const job = jobs[selectedJobId];
  if (!job?.videoId) {
    showError('该任务还没有可查看的结果');
    return;
  }
  if (!browser.sidePanel) {
    showError('当前浏览器不支持侧边栏，请用「新标签」查看');
    return;
  }
  const type = currentPreview?.type || 'report';
  // 目标写入用 fire-and-forget，不 await：sidePanel.open() 必须紧贴用户手势，
  // 中间 await 太多会让 Chrome 判定「非用户手势」而拒绝打开（之前看不到侧边栏的原因）。
  browser.storage.local.set({
    cm_sidepanel: { videoId: job.videoId, type, title: job.videoTitle || job.videoId },
  });
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await browser.sidePanel.open({ tabId: tab.id });
    // open 之后再指定页面（manifest 已配 default_path，这步只是兜底）
    try {
      browser.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html', enabled: true });
    } catch (e) {}
  } catch (e) {
    console.error('[Popup] 侧边栏打开失败:', e);
    showError('侧边栏打开失败：' + e.message + '（可改用「新标签」查看）');
  }
}

function openDashboard() {
  port.postMessage({ action: 'openDashboard' });
}

function restartAnalysis() {
  const job = jobs[selectedJobId];
  if (job) {
    if (job.status === 'running') return;
    port.postMessage({ action: 'clearJob', jobId: job.jobId });
    delete jobs[job.jobId];
  }
  goToConfigForCurrentVideo();
}

// ── 设置 ──────────────────────────────────────────────────────────
function loadSettings() {
  browser.storage.local.get(['commentminer_settings', 'backend_url'], (result) => {
    const settings = result.commentminer_settings || {};
    if (settings.lang) {
      selectedLang = settings.lang;
      updateLangButtons();
    }
    if (settings.mode) {
      selectedMode = settings.mode;
      updateModeButtons();
    }
    if (settings.maxComments) {
      maxComments = settings.maxComments;
      $('maxCmtSlider').value = maxComments;
      $('maxCmtValue').textContent = maxComments.toLocaleString();
    }
    if (result.backend_url) {
      $('backendUrlInput').value = result.backend_url;
    }
    checkBackendConnection(result.backend_url || 'http://localhost:8000');
  });
}

function saveSettings() {
  browser.storage.local.set({
    commentminer_settings: { lang: selectedLang, mode: selectedMode, maxComments: maxComments },
  });
}

function saveBackendUrl() {
  const url = $('backendUrlInput').value.trim();
  if (url) {
    browser.storage.local.set({ backend_url: url }, () => {
      $('settingsPanel').classList.add('hidden');
      checkBackendConnection(url);
    });
  }
}

function checkBackendConnection(backendUrl) {
  backendStatus.textContent = '● 后端连接中...';
  backendStatus.className = 'backend-status';
  fetch(`${backendUrl}/api/defaults`)
    .then((r) => {
      if (r.ok) {
        backendStatus.textContent = '● 后端已连接';
        backendStatus.classList.add('connected');
      } else {
        backendStatus.textContent = '● 后端连接异常';
        backendStatus.classList.add('disconnected');
      }
    })
    .catch(() => {
      backendStatus.textContent = '● 后端未连接';
      backendStatus.classList.add('disconnected');
    });
}

// ── UI 更新 ───────────────────────────────────────────────────────
function updateLangButtons() {
  document.querySelectorAll('.option-btn[data-lang]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === selectedLang);
  });
}

function updateModeButtons() {
  document.querySelectorAll('.mode-btn[data-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === selectedMode);
  });
}

// ── 事件绑定 ──────────────────────────────────────────────────────
function bindEvents() {
  document.querySelectorAll('.option-btn[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedLang = btn.dataset.lang;
      updateLangButtons();
      saveSettings();
    });
  });

  document.querySelectorAll('.mode-btn[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedMode = btn.dataset.mode;
      updateModeButtons();
      saveSettings();
    });
  });

  $('maxCmtSlider').addEventListener('input', (e) => {
    maxComments = parseInt(e.target.value);
    $('maxCmtValue').textContent = maxComments.toLocaleString();
    saveSettings();
  });

  startBtn.addEventListener('click', startAnalysis);

  // 点击视频卡片 → 回到「分析当前视频」配置（用于并行开新任务）
  videoCard.addEventListener('click', () => {
    if (currentVideo && currentVideo.videoId) goToConfigForCurrentVideo();
  });

  $('viewGemsBtn').addEventListener('click', viewGems);
  $('viewReportBtn').addEventListener('click', viewReport);
  $('openTabBtn').addEventListener('click', openInTab);
  $('sidePanelBtn').addEventListener('click', openSidePanel);
  $('openDashboardBtn').addEventListener('click', openDashboard);
  $('restartBtn').addEventListener('click', restartAnalysis);

  // 仅在支持 side panel 的浏览器（Chrome/Edge）显示侧边栏按钮
  if (browser.sidePanel) {
    $('sidePanelBtn').classList.remove('hidden');
  }

  $('settingsBtn').addEventListener('click', () => {
    $('settingsPanel').classList.remove('hidden');
  });
  $('closeSettingsBtn').addEventListener('click', () => {
    $('settingsPanel').classList.add('hidden');
  });
  $('saveSettingsBtn').addEventListener('click', saveBackendUrl);
}

// ── 工具函数 ──────────────────────────────────────────────────────
function showError(message) {
  if (!message) {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
    return;
  }
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
