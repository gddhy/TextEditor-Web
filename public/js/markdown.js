/* ============================================================
   markdown.js — Markdown 渲染
   优先使用 CDN 上的 marked；不可用时回退到内置轻量解析器。
   代码块使用 monaco.editor.colorize 进行语法高亮。
   ============================================================ */
(function (global) {
  'use strict';

  var useMarked = false;

  function init() {
    if (global.marked && typeof global.marked.parse === 'function') {
      try {
        global.marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });
      } catch (e) {}
      useMarked = true;
    }
    return useMarked;
  }

  /* ---------------------------------------------------------
     内置轻量 Markdown 解析器（marked 不可用时的兜底）
     --------------------------------------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function inline(text) {
    var out = escapeHtml(text);

    // 行内代码（先占位保护）
    var codes = [];
    out = out.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) {
      codes.push('<code>' + code.trim() + '</code>');
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    // 图片
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (m, alt, src, title) {
      return '<img src="' + safeUrl(src) + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>';
    });
    // 链接
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (m, txt, href, title) {
      return '<a href="' + safeUrl(href) + '" target="_blank" rel="noopener noreferrer"' +
        (title ? ' title="' + title + '"' : '') + '>' + txt + '</a>';
    });
    // 自动链接
    out = out.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

    // 强调
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // 换行
    out = out.replace(/ {2,}\n/g, '<br>\n');

    // 还原行内代码
    out = out.replace(/\u0000C(\d+)\u0000/g, function (m, i) { return codes[+i]; });
    return out;
  }

  function safeUrl(u) {
    u = String(u).trim();
    if (/^\s*javascript:/i.test(u) || /^\s*data:text\/html/i.test(u) || /^\s*vbscript:/i.test(u)) return '#';
    return escapeHtml(u);
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function builtinParse(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var i = 0;

    function listBlock(ordered, baseIndent) {
      var items = [];
      while (i < lines.length) {
        var line = lines[i];
        var m = ordered
          ? line.match(/^(\s*)(\d+)[.)]\s+(.*)$/)
          : line.match(/^(\s*)([-*+])\s+(.*)$/);
        if (!m) {
          // 允许列表项内的续行
          if (items.length && /^\s{2,}\S/.test(line)) {
            items[items.length - 1].text += '\n' + line.trim();
            i++; continue;
          }
          if (items.length && line.trim() === '' && i + 1 < lines.length &&
              (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i + 1])) {
            i++; continue;
          }
          break;
        }
        if (m[1].length < baseIndent) break;
        if (m[1].length > baseIndent + 1 && items.length) {
          // 嵌套列表
          var sub = listBlock(/^\s*\d+[.)]\s/.test(line), m[1].length);
          items[items.length - 1].sub = (items[items.length - 1].sub || '') + sub;
          continue;
        }
        items.push({ text: m[3], sub: '' });
        i++;
      }
      var tag = ordered ? 'ol' : 'ul';
      var buf = ['<' + tag + '>'];
      items.forEach(function (it) {
        var task = it.text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          buf.push('<li class="task-list-item"><input type="checkbox" disabled' +
            (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> ' + inline(task[2]) + (it.sub || '') + '</li>');
        } else {
          buf.push('<li>' + inline(it.text) + (it.sub || '') + '</li>');
        }
      });
      buf.push('</' + tag + '>');
      return buf.join('\n');
    }

    while (i < lines.length) {
      var line = lines[i];

      // 空行
      if (!line.trim()) { i++; continue; }

      // 围栏代码块
      var fence = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
      if (fence) {
        var marker = fence[2][0];
        var minLen = fence[2].length;
        var lang = fence[3] || '';
        var body = [];
        i++;
        while (i < lines.length) {
          var end = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
          if (end && end[1][0] === marker && end[1].length >= minLen) { i++; break; }
          body.push(lines[i]); i++;
        }
        html.push('<pre><code class="language-' + escapeHtml(lang) + '" data-lang="' + escapeHtml(lang) + '">' +
          escapeHtml(body.join('\n')) + '</code></pre>');
        continue;
      }

      // 缩进代码块
      if (/^ {4}\S/.test(line) && (html.length === 0 || !/<\/(ul|ol)>$/.test(html[html.length - 1]))) {
        var ind = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) {
          ind.push(lines[i].slice(4)); i++;
        }
        while (ind.length && !ind[ind.length - 1].trim()) ind.pop();
        html.push('<pre><code>' + escapeHtml(ind.join('\n')) + '</code></pre>');
        continue;
      }

      // ATX 标题
      var h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        var lvl = h[1].length;
        var txt = inline(h[2]);
        html.push('<h' + lvl + ' id="' + slug(h[2]) + '">' + txt + '</h' + lvl + '>');
        i++; continue;
      }

      // Setext 标题
      if (i + 1 < lines.length && /^\s*(=+|-{2,})\s*$/.test(lines[i + 1]) && line.trim()) {
        var isH1 = lines[i + 1].trim()[0] === '=';
        html.push('<h' + (isH1 ? 1 : 2) + ' id="' + slug(line) + '">' + inline(line.trim()) + '</h' + (isH1 ? 1 : 2) + '>');
        i += 2; continue;
      }

      // 分割线
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { html.push('<hr>'); i++; continue; }

      // 引用
      if (/^\s*>/.test(line)) {
        var quote = [];
        while (i < lines.length && (/^\s*>/.test(lines[i]) || (quote.length && lines[i].trim()))) {
          quote.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        html.push('<blockquote>' + builtinParse(quote.join('\n')) + '</blockquote>');
        continue;
      }

      // 表格
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var splitRow = function (r) {
          return r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return c.trim(); });
        };
        var headCells = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          if (/^:.*:$/.test(c)) return 'center';
          if (/:$/.test(c)) return 'right';
          if (/^:/.test(c)) return 'left';
          return '';
        });
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          rows.push(splitRow(lines[i])); i++;
        }
        var t = ['<table><thead><tr>'];
        headCells.forEach(function (c, idx) {
          t.push('<th' + (aligns[idx] ? ' style="text-align:' + aligns[idx] + '"' : '') + '>' + inline(c) + '</th>');
        });
        t.push('</tr></thead><tbody>');
        rows.forEach(function (r) {
          t.push('<tr>');
          for (var c = 0; c < headCells.length; c++) {
            t.push('<td' + (aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '') + '>' + inline(r[c] || '') + '</td>');
          }
          t.push('</tr>');
        });
        t.push('</tbody></table>');
        html.push(t.join(''));
        continue;
      }

      // 列表
      if (/^\s*[-*+]\s+/.test(line)) { html.push(listBlock(false, (line.match(/^\s*/) || [''])[0].length)); continue; }
      if (/^\s*\d+[.)]\s+/.test(line)) { html.push(listBlock(true, (line.match(/^\s*/) || [''])[0].length)); continue; }

      // 原始 HTML 块
      if (/^\s*<(div|p|table|ul|ol|section|article|details|summary|blockquote|pre|h[1-6]|br|hr|img|figure)\b/i.test(line)) {
        var raw = [];
        while (i < lines.length && lines[i].trim()) { raw.push(lines[i]); i++; }
        html.push(raw.join('\n'));
        continue;
      }

      // 段落
      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(\s*)(`{3,}|~{3,})/.test(lines[i]) &&
             !/^#{1,6}\s/.test(lines[i]) &&
             !/^\s*>/.test(lines[i]) &&
             !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+[.)]\s+/.test(lines[i]) &&
             !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      if (para.length) html.push('<p>' + inline(para.join('\n')) + '</p>');
      else i++;
    }

    return html.join('\n');
  }

  /* ---------------------------------------------------------
     消毒
     --------------------------------------------------------- */
  function sanitize(html) {
    if (global.DOMPurify && typeof global.DOMPurify.sanitize === 'function') {
      return global.DOMPurify.sanitize(html, {
        ADD_ATTR: ['target', 'data-lang', 'id'],
        FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['style']
      });
    }
    // 兜底清洗
    var doc = new DOMParser().parseFromString('<div id="__root">' + html + '</div>', 'text/html');
    var root = doc.getElementById('__root');
    root.querySelectorAll('script,iframe,object,embed,form,link,meta,style').forEach(function (n) { n.remove(); });
    root.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var n = attr.name.toLowerCase();
        if (n.indexOf('on') === 0) el.removeAttribute(attr.name);
        if ((n === 'href' || n === 'src') && /^\s*(javascript|vbscript|data:text\/html)/i.test(attr.value)) {
          el.setAttribute(attr.name, '#');
        }
      });
    });
    return root.innerHTML;
  }

  /* ---------------------------------------------------------
     渲染入口
     --------------------------------------------------------- */
  function render(src) {
    if (!src || !src.trim()) return '<div class="md-empty">（空文档）</div>';
    var html;
    if (useMarked) {
      try { html = global.marked.parse(src); }
      catch (e) { html = builtinParse(src); }
    } else {
      html = builtinParse(src);
    }
    return sanitize(html);
  }

  /** 对已渲染 DOM 中的代码块做语法高亮 */
  function highlight(container) {
    if (!global.monaco || !global.monaco.editor || !global.monaco.editor.colorize) return Promise.resolve();
    var blocks = Array.prototype.slice.call(container.querySelectorAll('pre > code'));
    var tasks = blocks.map(function (code) {
      if (code.dataset.hl === '1') return Promise.resolve();
      var lang = code.dataset.lang ||
        (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
      if (!lang) { code.dataset.hl = '1'; return Promise.resolve(); }
      var mapped = ({
        js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby', sh: 'shell',
        bash: 'shell', zsh: 'shell', yml: 'yaml', 'c++': 'cpp', 'c#': 'csharp',
        cs: 'csharp', jsx: 'javascript', tsx: 'typescript', golang: 'go',
        vbscript: 'vb', batch: 'bat', cmd: 'bat', ps: 'powershell', ps1: 'powershell',
        text: 'plaintext', txt: 'plaintext', console: 'shell', jsonc: 'json'
      })[lang.toLowerCase()] || lang.toLowerCase();

      var langs = global.monaco.languages.getLanguages().map(function (l) { return l.id; });
      if (langs.indexOf(mapped) < 0) { code.dataset.hl = '1'; return Promise.resolve(); }

      return global.monaco.editor.colorize(code.textContent, mapped, { tabSize: 2 })
        .then(function (out) { code.innerHTML = out; code.dataset.hl = '1'; })
        .catch(function () { code.dataset.hl = '1'; });
    });
    return Promise.all(tasks);
  }

  /** 计算源码行 → 预览元素的映射，用于滚动同步 */
  function buildLineMap(container, src) {
    var lines = src.split('\n');
    var headings = [];
    lines.forEach(function (l, idx) {
      var m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (m) headings.push({ line: idx, text: m[2].trim() });
    });
    var els = Array.prototype.slice.call(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    var map = [];
    for (var i = 0; i < Math.min(headings.length, els.length); i++) {
      map.push({ line: headings[i].line, el: els[i] });
    }
    return map;
  }

  global.Markdown = {
    init: init,
    render: render,
    highlight: highlight,
    buildLineMap: buildLineMap,
    get usingMarked() { return useMarked; }
  };
})(window);
