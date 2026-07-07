/**
 * CommentMiner 侧边栏脚本
 *
 * 显示 popup 指定的分析结果（精华评论 / 分析报告）。展示目标通过
 * storage.local 的 cm_sidepanel = { videoId, type, title } 传入；内容经
 * background 的 port 协议（getGems / getReport）从本地后端获取，本地渲染。
 */

const browser = (typeof globalThis.browser !== 'undefined') ? globalThis.browser : globalThis.chrome;

let port = null;
let target = null; // { videoId, type, title }

const $ = (id) => document.getElementById(id);

function connect() {
  try {
    port = browser.runtime.connect({ name: 'commentminer-popup' });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 1000);
    });
  } catch (e) {
    console.error('[SidePanel] 连接 background 失败:', e);
  }
}

function onMessage(msg) {
  if (!target) return;
  if (msg.type === 'gemsContent' && target.type === 'gems' && msg.videoId === target.videoId) {
    render(msg.content);
  } else if (msg.type === 'reportContent' && target.type === 'report' && msg.videoId === target.videoId) {
    render(msg.content);
  } else if (msg.type === 'error') {
    $('content').innerHTML = `<p style="color:#f87171">${escapeHtml(msg.error || '加载失败')}</p>`;
  }
}

function applyTarget(t) {
  target = t || null;
  if (!target) {
    $('content').innerHTML = '<p class="sp-hint">请在扩展弹窗中选择要查看的结果。</p>';
    return;
  }
  $('title').textContent = target.title || target.videoId || 'CommentMiner';
  $('subtitle').textContent = target.type === 'gems' ? '💎 精华评论' : '📊 分析报告';
  requestContent();
}

function requestContent() {
  if (!target) return;
  $('content').innerHTML = '<p class="sp-hint">加载中…</p>';
  const send = () => port.postMessage({
    action: target.type === 'gems' ? 'getGems' : 'getReport',
    videoId: target.videoId,
  });
  if (port) send();
  else setTimeout(() => { if (port) send(); }, 300);
}

function render(content) {
  $('content').innerHTML = renderMarkdown(content);
  window.scrollTo(0, 0);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// popup 再次点击「侧边栏」查看别的结果时，storage 变化 → 实时切换
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.cm_sidepanel) {
    applyTarget(changes.cm_sidepanel.newValue);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  connect();
  browser.storage.local.get('cm_sidepanel', (r) => applyTarget(r.cm_sidepanel));
});
