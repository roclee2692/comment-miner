/**
 * CommentMiner Content Script
 * 在 B站/YouTube 视频页面运行，提取视频信息
 * 
 * 跨浏览器兼容：使用 browser namespace（Firefox）或 chrome namespace（Chrome/Edge）
 */

const browser = (typeof globalThis.browser !== 'undefined') ? globalThis.browser : globalThis.chrome;

/**
 * 从当前页面提取视频信息
 * @returns {Object} { platform, videoId, title, url }
 */
function extractVideoInfo() {
  const url = location.href;
  const platform = detectPlatform(url);
  
  if (!platform) {
    return null;
  }

  const videoId = extractVideoId(url, platform);
  const title = extractTitle(platform);

  return {
    platform,
    videoId,
    title,
    url,
    timestamp: Date.now()
  };
}

function detectPlatform(url) {
  if (url.includes('bilibili.com')) return 'bilibili';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  return null;
}

function extractVideoId(url, platform) {
  if (platform === 'bilibili') {
    // BV 号
    const bvMatch = url.match(/(BV[A-Za-z0-9]{10,12})/);
    if (bvMatch) return bvMatch[1];
    
    // av 号
    const avMatch = url.match(/av(\d+)/i);
    if (avMatch) return 'av' + avMatch[1];
    
    // bangumi (番剧)
    const epMatch = url.match(/ep(\d+)/i);
    if (epMatch) return 'ep' + epMatch[1];
    
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

function extractTitle(platform) {
  // 优先尝试页面标题元素
  if (platform === 'bilibili') {
    // 新版 B站
    const titleEl = document.querySelector('h1.video-title, .video-title, h1[title]');
    if (titleEl) {
      return (titleEl.textContent || titleEl.getAttribute('title') || '').trim();
    }
    // 番剧页面
    const bangumiTitle = document.querySelector('.media-title, .bangumi-title');
    if (bangumiTitle) {
      return bangumiTitle.textContent.trim();
    }
  }
  
  if (platform === 'youtube') {
    const titleEl = document.querySelector('h1.ytd-watch-metadata, yt-formatted-string.ytd-watch-metadata');
    if (titleEl) {
      return titleEl.textContent.trim();
    }
  }
  
  // fallback: 从 document.title 提取
  let title = document.title || '';
  
  if (platform === 'bilibili') {
    // 去掉 "_哔哩哔哩_bilibili" 后缀
    title = title.replace(/_哔哩哔哩.*$/, '').trim();
  }
  
  if (platform === 'youtube') {
    // 去掉 " - YouTube" 后缀
    title = title.replace(/\s*-\s*YouTube$/, '').trim();
  }
  
  return title;
}

// 监听来自 popup/background 的消息
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getVideoInfo') {
    const info = extractVideoInfo();
    sendResponse(info);
    return true; // 保持消息通道开放（异步响应时需要）
  }
  
  if (message.action === 'ping') {
    sendResponse({ ok: true });
    return true;
  }
});

// 页面加载完成后通知 background（用于检测当前页面是否为视频页）
function notifyReady() {
  const info = extractVideoInfo();
  if (info && info.videoId) {
    browser.runtime.sendMessage({
      action: 'videoPageDetected',
      videoInfo: info
    }).catch(() => {
      // background 可能尚未就绪，忽略错误
    });
  }
}

// YouTube 是 SPA，需要监听 URL 变化
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(notifyReady, 1000); // 延迟等待页面渲染
  }
}, 2000);

// 初始通知
if (document.readyState === 'complete') {
  notifyReady();
} else {
  window.addEventListener('load', notifyReady);
}
