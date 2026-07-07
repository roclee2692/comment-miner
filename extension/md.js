/**
 * 极简 Markdown → HTML 渲染器（无任何外部依赖 / 无 CDN）。
 *
 * 旧版查看页依赖 jsdelivr 的 marked.min.js，CDN 加载失败时整页空白（数据其实没丢，
 * 只是没渲染出来）。这里改为本地渲染，popup 内嵌预览、侧边栏、整页查看共用同一函数。
 *
 * 支持：标题、粗体/斜体、行内代码、代码块、引用、有序/无序列表、分割线、链接、段落。
 */
function renderMarkdown(md) {
  if (!md) return '<p style="color:#64748b">（内容为空）</p>';

  // Stage1 生成的 gems 里有时夹带字面量 "\n"（两个字符），统一成真正换行，显示更干净。
  md = String(md).replace(/\\n/g, '\n').replace(/\r\n/g, '\n');

  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) =>
    esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const safeLink = (href) => {
    const raw = href
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (/^(https?:|mailto:|#|\/)/i.test(raw)) return escAttr(raw);
    return '#';
  };

  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
        return `<a href="${safeLink(href)}" target="_blank" rel="noopener">${label}</a>`;
      });

  const lines = md.split('\n');
  let html = '';
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeBuf = [];

  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };

  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inCode) {
        html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
        codeBuf = [];
        inCode = false;
      } else {
        closeLists();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const line = raw.trim();
    if (!line) { closeLists(); continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeLists();
      const lvl = m[1].length;
      html += `<h${lvl}>${inline(m[2])}</h${lvl}>`;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeLists();
      html += '<hr>';
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) {
      closeLists();
      html += `<blockquote>${inline(m[1])}</blockquote>`;
      continue;
    }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inline(m[1])}</li>`;
      continue;
    }
    closeLists();
    html += `<p>${inline(line)}</p>`;
  }

  if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
  closeLists();
  return html;
}

// 供 service worker / 模块环境复用（popup 与 sidepanel 用全局函数即可）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderMarkdown };
}
