/* ============================================================
   config.js — 全局配置：CDN 镜像源、默认设置、持久化
   ============================================================ */
(function (global) {
  'use strict';

  var MONACO_VERSION = '0.53.0';
  var MARKED_VERSION = '15.0.7';
  var DOMPURIFY_VERSION = '3.2.4';

  /* ---------------------------------------------------------
     Monaco 镜像源（按优先级排列，国内源优先）
     每一项为 `min/vs` 目录的基地址（不含末尾斜杠）
     --------------------------------------------------------- */
  var MONACO_MIRRORS = [
    {
      name: 'npmmirror (阿里云)',
      base: 'https://registry.npmmirror.com/monaco-editor/' + MONACO_VERSION + '/files/min/vs'
    },
    {
      name: 'npmmirror CDN',
      base: 'https://cdn.npmmirror.com/packages/monaco-editor/' + MONACO_VERSION + '/files/min/vs'
    },
    {
      name: 'BootCDN (七牛)',
      base: 'https://cdn.bootcdn.net/ajax/libs/monaco-editor/' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'Staticfile (七牛)',
      base: 'https://cdn.staticfile.net/monaco-editor/' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'Staticfile.org',
      base: 'https://cdn.staticfile.org/monaco-editor/' + MONACO_VERSION + '/min/vs'
    },
    {
      name: '字节跳动 CDN',
      base: 'https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/monaco-editor/' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'jsDelivr 国内',
      base: 'https://jsd.onmicrosoft.cn/npm/monaco-editor@' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'jsDelivr 镜像 (fastly)',
      base: 'https://fastly.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'jsDelivr',
      base: 'https://cdn.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'unpkg 镜像',
      base: 'https://unpkg.zhimg.com/monaco-editor@' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'unpkg',
      base: 'https://unpkg.com/monaco-editor@' + MONACO_VERSION + '/min/vs'
    },
    {
      name: 'cdnjs',
      base: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/' + MONACO_VERSION + '/min/vs'
    }
  ];

  /* Markdown 解析库镜像（可选增强，失败时回退到内置解析器） */
  var MARKED_MIRRORS = [
    'https://registry.npmmirror.com/marked/' + MARKED_VERSION + '/files/marked.min.js',
    'https://cdn.npmmirror.com/packages/marked/' + MARKED_VERSION + '/files/marked.min.js',
    'https://cdn.bootcdn.net/ajax/libs/marked/' + MARKED_VERSION + '/marked.min.js',
    'https://cdn.staticfile.net/marked/' + MARKED_VERSION + '/marked.min.js',
    'https://jsd.onmicrosoft.cn/npm/marked@' + MARKED_VERSION + '/marked.min.js',
    'https://fastly.jsdelivr.net/npm/marked@' + MARKED_VERSION + '/marked.min.js',
    'https://cdn.jsdelivr.net/npm/marked@' + MARKED_VERSION + '/marked.min.js',
    'https://unpkg.com/marked@' + MARKED_VERSION + '/marked.min.js'
  ];

  /* HTML 消毒库镜像（预览安全） */
  var DOMPURIFY_MIRRORS = [
    'https://registry.npmmirror.com/dompurify/' + DOMPURIFY_VERSION + '/files/dist/purify.min.js',
    'https://cdn.npmmirror.com/packages/dompurify/' + DOMPURIFY_VERSION + '/files/dist/purify.min.js',
    'https://cdn.bootcdn.net/ajax/libs/dompurify/' + DOMPURIFY_VERSION + '/purify.min.js',
    'https://cdn.staticfile.net/dompurify/' + DOMPURIFY_VERSION + '/purify.min.js',
    'https://jsd.onmicrosoft.cn/npm/dompurify@' + DOMPURIFY_VERSION + '/dist/purify.min.js',
    'https://fastly.jsdelivr.net/npm/dompurify@' + DOMPURIFY_VERSION + '/dist/purify.min.js',
    'https://cdn.jsdelivr.net/npm/dompurify@' + DOMPURIFY_VERSION + '/dist/purify.min.js'
  ];

  /* ---------------------------------------------------------
     默认设置
     --------------------------------------------------------- */
  var DEFAULTS = {
    theme: 'auto',                 // light | dark | auto
    fontSize: 14,
    fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Sarasa Mono SC", monospace',
    tabSize: 2,
    insertSpaces: true,
    wordWrap: false,
    minimap: true,
    lineNumbers: true,
    highlightLine: true,
    renderWhitespace: false,
    stickyScroll: true,
    trimOnSave: false,
    finalNewline: false,
    defaultEncoding: 'utf-8',
    defaultEol: 'LF',
    autoDetect: true,
    session: true,
    watchFiles: true,              // 监听本地文件被外部程序修改
    watchAutoReload: false,        // 无未保存更改时自动重新加载
    watchInterval: 3000,           // 轮询间隔（ms）
    previewSync: true,
    previewRatio: 0.5,
    preferredMirror: null          // 记住上次成功的镜像 base
  };

  var STORAGE_KEY = 'text-editor.settings.v1';
  var SESSION_KEY = 'text-editor.session.v1';

  /* 旧标识迁移：text-studio.* → text-editor.*
     只在新键不存在时搬运一次，搬完删除旧键，保证升级后设置/会话不丢。 */
  function migrateKey(oldKey, newKey) {
    try {
      if (localStorage.getItem(newKey) === null) {
        var v = localStorage.getItem(oldKey);
        if (v !== null) localStorage.setItem(newKey, v);
      }
      if (localStorage.getItem(oldKey) !== null) localStorage.removeItem(oldKey);
    } catch (e) { /* 忽略：隐私模式或存储不可用 */ }
  }
  migrateKey('text-studio.settings.v1', STORAGE_KEY);
  migrateKey('text-studio.session.v1', SESSION_KEY);
  migrateKey('textstudio.welcomed', 'texteditor.welcomed');

  var settings = Object.assign({}, DEFAULTS);
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) { /* 忽略：隐私模式或存储不可用 */ }

  var listeners = [];
  var saveTimer = null;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
    }, 200);
  }

  var Config = {
    MONACO_VERSION: MONACO_VERSION,
    MONACO_MIRRORS: MONACO_MIRRORS,
    MARKED_MIRRORS: MARKED_MIRRORS,
    DOMPURIFY_MIRRORS: DOMPURIFY_MIRRORS,
    DEFAULTS: DEFAULTS,
    SESSION_KEY: SESSION_KEY,

    get: function (key) {
      return key === undefined ? settings : settings[key];
    },

    set: function (key, value) {
      var patch = typeof key === 'object' ? key : null;
      var changed = [];
      if (patch) {
        for (var k in patch) {
          if (settings[k] !== patch[k]) { settings[k] = patch[k]; changed.push(k); }
        }
      } else if (settings[key] !== value) {
        settings[key] = value;
        changed.push(key);
      }
      if (changed.length) {
        persist();
        listeners.forEach(function (fn) { try { fn(changed, settings); } catch (e) { console.error(e); } });
      }
      return settings;
    },

    reset: function () {
      settings = Object.assign({}, DEFAULTS);
      persist();
      listeners.forEach(function (fn) { try { fn(Object.keys(DEFAULTS), settings); } catch (e) {} });
    },

    onChange: function (fn) { listeners.push(fn); },

    /** 把上次成功的镜像提到列表最前 */
    orderedMirrors: function () {
      var list = MONACO_MIRRORS.slice();
      var pref = settings.preferredMirror;
      if (pref) {
        var i = list.findIndex(function (m) { return m.base === pref; });
        if (i > 0) list.unshift(list.splice(i, 1)[0]);
      }
      return list;
    }
  };

  global.Config = Config;
})(window);
