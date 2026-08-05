/* ============================================================
   app.js — 应用主控制器
   ============================================================ */
(function (global) {
  'use strict';

  var $ = UI.$, $$ = UI.$$;
  var Cfg = global.Config;

  var state = {
    ready: false,
    previewVisible: false,
    previewSyncing: false,
    pendingLaunch: [],
    pendingShortcut: null,
    installPrompt: null,
    previewMode: null,
    lastMd: '',
    lastHtml: '',
    previewTimer: null,
    sessionTimer: null,
    launchBusy: false
  };

  /* =========================================================
     主题
     ========================================================= */
  var mql = matchMedia('(prefers-color-scheme: dark)');

  function resolveTheme() {
    var t = Cfg.get('theme');
    if (t === 'auto') return mql.matches ? 'dark' : 'light';
    return t;
  }

  function applyTheme() {
    var t = resolveTheme();
    document.documentElement.dataset.theme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#141218' : '#6750A4');
    if (state.ready) {
      Ed.applyTheme();
      schedulePreview(true);
    }
  }

  mql.addEventListener('change', function () {
    if (Cfg.get('theme') === 'auto') applyTheme();
  });

  /* =========================================================
     启动
     ========================================================= */
  function setSplash(text, detail) {
    var s = $('#splashStatus'), d = $('#splashSource');
    if (s && text) s.textContent = text;
    if (d) d.textContent = detail || '';
  }

  function boot() {
    applyTheme();

    // 字体变量同步
    document.documentElement.style.setProperty('--editor-font', Cfg.get('fontFamily'));

    // 看门狗：极端网络下若资源镜像持续无响应，loader 可能因请求挂起而不 resolve 也不 reject，
    // 导致永久卡在启动页。45s 内仍未进入编辑器则给出明确的"重新加载"入口，避免无路可走。
    var watchdog = setTimeout(function () {
      var app = document.getElementById('app');
      if (!app || !app.hidden) return; // 已进入编辑器则忽略
      setSplash('加载超时：资源镜像响应缓慢', '请检查网络后点击下方重新加载');
      var lp = document.querySelector('.linear-progress');
      if (lp) lp.style.display = 'none';
      var box = document.getElementById('splashSource');
      if (box && !box.querySelector('button')) {
        box.innerHTML = '';
        var btn = document.createElement('button');
        btn.className = 'btn filled';
        btn.textContent = '重新加载';
        btn.style.marginTop = '12px';
        btn.onclick = function () { location.reload(); };
        box.appendChild(btn);
      }
    }, 45000);
    state.bootWatchdog = watchdog;

    // 尽早注册 LaunchQueue，避免错过启动参数
    Files.setupLaunchQueue(function (items) {
      if (!state.ready) state.pendingLaunch = state.pendingLaunch.concat(items);
      else openItems(items, { source: 'launch' });
    }, function (targetUrl) {
      // PWA 快捷方式（?action=new[&ext=md]）：窗口已存在时 focus-existing 复用窗口，
      // 通过 launchQueue 的 targetURL 投递，不会重新导航，必须在此处即时处理
      handleShortcutUrl(targetUrl);
    });

    Loader.onProgress(setSplash);

    Loader.loadMonaco()
      .then(function (mirror) {
        setSplash('正在初始化界面…', mirror.name);
        startApp();
      })
      .catch(function (err) {
        console.error(err);
        if (state.bootWatchdog) { clearTimeout(state.bootWatchdog); state.bootWatchdog = null; }
        setSplash('加载失败：' + err.message, '请检查网络后刷新页面重试');
        $('.linear-progress').style.display = 'none';
        var box = $('#splashSource');
        box.innerHTML = '';
        var btn = document.createElement('button');
        btn.className = 'btn filled';
        btn.textContent = '重新加载';
        btn.style.marginTop = '12px';
        btn.onclick = function () { location.reload(); };
        box.appendChild(btn);
      });

    // 附加库并行加载（失败不影响主流程）
    Loader.loadMarked().then(function () { Markdown.init(); });
    Loader.loadDOMPurify();
  }

  function startApp() {
    Ed.init($('#editor'));
    state.ready = true;
    if (state.bootWatchdog) { clearTimeout(state.bootWatchdog); state.bootWatchdog = null; }

    $('#app').hidden = false;
    document.body.classList.remove('booting');
    setTimeout(function () {
      $('#splash').classList.add('hide');
      setTimeout(function () { var s = $('#splash'); if (s) s.remove(); }, 420);
    }, 120);

    bindUI();
    bindEditorEvents();
    bindShortcuts();
    Files.setupDragDrop(document.body, function (items) { openItems(items, { source: 'drop' }); });

    updateCdnStatus();

    // 处理启动文件 / 会话恢复 / URL 参数
    bootstrapInitialDoc();

    registerServiceWorker();
    setupInstallPrompt();
    setupWindowControlsOverlay();
    startSessionAutosave();
    startWatch();

    // 空闲时预热文本对比：diff 计算依赖 Monaco 的 web worker，worker 首次使用才创建并
    // 现场从 CDN 下载脚本 —— 这正是"第一次进对比要等很久 / 概率没结果"的根因
    schedulePrewarmDiff();
  }

  /* =========================================================
     首次启动 / 会话恢复
     ========================================================= */
  // 解析 ?action=new[&ext=md] 查询，创建对应文档。返回 true 表示已处理
  function runShortcutFromSearch(search) {
    if (!global.URLSearchParams) return false;
    var sp = new URLSearchParams(search);
    if (sp.get('action') !== 'new') return false;
    var ext = (sp.get('ext') || '').toLowerCase();
    var doc;
    if (ext === 'md') {
      var n = 1;
      var used = Ed.docs.map(function (d) { return d.name; });
      while (used.indexOf('未命名-' + n + '.md') >= 0) n++;
      doc = Ed.createDoc({ name: '未命名-' + n + '.md', content: '' });
      doc.previewOn = true;
    } else {
      doc = newDoc();
    }
    Ed.activate(doc.id);
    if (doc.previewOn) updatePreviewVisibility(doc);
    return true;
  }

  // 处理 launchQueue 投递的快捷方式 targetURL（warm 复用窗口时调用）
  function handleShortcutUrl(url) {
    if (!url) return;
    var qi = url.indexOf('?');
    var search = qi >= 0 ? url.slice(qi) : '';
    if (!search) return;
    // 冷启动已被 bootstrap 通过 location.search 处理过（同一查询）则跳过，避免重复新建
    if (state.ready && search === global.location.search) return;
    if (!state.ready) { state.pendingShortcut = url; return; }
    runShortcutFromSearch(search);
  }

  function bootstrapInitialDoc() {
    // 0) PWA 快捷方式 / 手动链接：?action=new[&ext=md]
    //    - 冷启动（窗口不存在，被导航到快捷方式 URL）→ 来自 location.search
    //    - 热启动（窗口已存在，focus-existing 复用窗口）→ 来自 launchQueue 的 targetURL，
    //      其回调在状态就绪后调用 handleShortcutUrl 直接创建文档
    if (global.location.search && runShortcutFromSearch(global.location.search)) {
      // 清理 URL，避免刷新时重复新建
      if (global.history && global.history.replaceState) {
        global.history.replaceState(null, '', global.location.pathname);
      }
      return;
    }
    // 0b) 冷启动时 launchQueue 已把 targetURL 收进 pendingShortcut
    if (state.pendingShortcut) {
      var su = state.pendingShortcut;
      state.pendingShortcut = null;
      var qi = su.indexOf('?');
      if (qi >= 0 && runShortcutFromSearch(su.slice(qi))) {
        return;
      }
    }
    // 1) PWA 文件关联启动（focus-existing 下由 LaunchQueue 推入）
    if (state.pendingLaunch.length) {
      var items = state.pendingLaunch;
      state.pendingLaunch = [];
      openItems(items, { source: 'launch' });
      return;
    }
    // 2) 异常关闭后的内容恢复（IndexedDB）
    if (Cfg.get('session')) {
      Files.loadDocs().then(function (arr) {
        if (arr && arr.length) { restoreFromSnaps(arr); return; }
        openWelcomeOrBlank();
      });
      return;
    }
    // 3) 无会话：首次给欢迎页，之后给空白文档
    openWelcomeOrBlank();
  }

  function openWelcomeOrBlank() {
    if (!localStorage.getItem('texteditor.welcomed')) {
      localStorage.setItem('texteditor.welcomed', '1');
      var doc = Ed.createDoc({ content: welcomeText(), name: '欢迎.md', welcome: true });
      Ed.activate(doc.id);
      Ed.markSaved(doc);
      UI.snack('欢迎使用 文本编辑器，可在菜单「欢迎页 / 帮助」随时查看', { duration: 4500 });
    } else {
      newDoc();
    }
  }

  function restoreFromSnaps(arr) {
    arr.sort(function (a, b) { return (a.savedAt || 0) - (b.savedAt || 0); });
    var activeDoc = null;
    arr.forEach(function (s) {
      var doc = Ed.createDoc({
        name: s.name, content: s.content || '', encoding: s.encoding,
        bom: s.bom, eol: s.eol, language: s.lang,
        handle: s.handle || null, path: s.path || null, welcome: !!s.welcome
      });
      doc.previewOn = !!s.previewOn;
      if (!s.dirty) {
        Ed.markSaved(doc);
      } else {
        // 原本是未保存状态：强制标记为 dirty，提示用户记得保存
        doc.dirty = true;
      }
      if (s.active) activeDoc = doc;
    });
    if (activeDoc) Ed.activate(activeDoc.id);
    else if (Ed.docs.length) Ed.activate(Ed.docs[0].id);
    UI.snack('已恢复上次编辑的 ' + arr.length + ' 个文档', { duration: 3500 });
  }

  function openWelcome() {
    var existing = Ed.docs.filter(function (d) { return d.welcome; })[0];
    if (existing) { Ed.activate(existing.id); return; }
    var doc = Ed.createDoc({ content: welcomeText(), name: '欢迎.md', welcome: true });
    Ed.activate(doc.id);
    Ed.markSaved(doc);
  }

  /* =========================================================
     UI 绑定
     ========================================================= */
  function bindUI() {
    $('#btnMenu').onclick = function () { UI.showMenu($('#mainMenu'), this, 'left'); };
    $('#btnOverflow').onclick = function () { syncOverflowChecks(); UI.showMenu($('#overflowMenu'), this); };
    $('#btnNew').onclick = function () { newDoc(); };
    $('#btnOpen').onclick = function () { doOpen(); };
    $('#btnSave').onclick = function () { doSave(); };
    $('#btnDownload').onclick = function () { doDownload(); };
    $('#btnTheme').onclick = function () { cycleTheme(); };
    $('#btnTabAdd').onclick = function () { newDoc(); };
    $('#btnPreview').onclick = function () { togglePreview(); };
    $('#btnPreviewClose').onclick = function () { togglePreview(false); };
    $('#btnPreviewSync').onclick = function () {
      Cfg.set('previewSync', !Cfg.get('previewSync'));
      this.classList.toggle('active', Cfg.get('previewSync'));
      UI.snack(Cfg.get('previewSync') ? '已开启滚动同步' : '已关闭滚动同步');
    };
    $('#btnPreviewSync').classList.toggle('active', Cfg.get('previewSync'));

    $('#mainMenu').addEventListener('click', function (e) {
      var item = e.target.closest('.menu-item');
      if (!item) return;
      UI.closeMenu();
      handleMenu(item.dataset.act);
    });
    $('#overflowMenu').addEventListener('click', function (e) {
      var item = e.target.closest('.menu-item');
      if (!item) return;
      handleMenu(item.dataset.act);
      syncOverflowChecks();
    });

    // 状态栏
    $('#stEncoding').onclick = function () { chooseEncodingMenu(); };
    $('#stEol').onclick = function () { toggleEol(); };
    $('#stLang').onclick = function () { chooseLanguage(); };
    $('#stCursor').onclick = function () { Ed.runAction('editor.action.gotoLine'); };
    $('#stIndent').onclick = function () { toggleIndent(); };
    $('#stFile').onclick = function () { doSave(); };
    $('#stCdn').onclick = function () { openSettings(); };

    // 标签栏滚轮横向滚动
    $('#tabs').addEventListener('wheel', function (e) {
      if (e.deltaY === 0) return;
      e.preventDefault();
      this.scrollLeft += e.deltaY;
    }, { passive: false });

    setupSplitter();
    setupSettingsDialog();

    // 文本对比视图控制
    $('#diffClose').onclick = closeDiff;
    $('#diffSwap').onclick = swapDiff;
    $('#diffLeftOpen').onclick = function () { diffOpenFile('left'); };
    $('#diffRightOpen').onclick = function () { diffOpenFile('right'); };
    $('#diffLeftPaste').onclick = function () { diffPaste('left'); };
    $('#diffRightPaste').onclick = function () { diffPaste('right'); };
    $('#diffLeftSel').onchange = function () { diffFromTab('left', this.value); };
    $('#diffRightSel').onchange = function () { diffFromTab('right', this.value); };

    // 关闭前提醒
    global.addEventListener('beforeunload', function (e) {
      saveSession();
      if (Ed.docs.some(function (d) { return d.dirty; })) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }

  function bindEditorEvents() {
    Ed.on('list', renderTabs);
    Ed.on('close', function (doc) {
      Files.removeDoc(doc.id);
      if (global.Watch) global.Watch.forget(doc);
    });
    Ed.on('switch', function (doc) {
      renderStatus(doc);
      updatePreviewVisibility(doc);
      schedulePreview(true);
    });
    Ed.on('change', function (doc) {
      renderStatus(doc);
      if (state.previewVisible) schedulePreview();
      scheduleSession();
    });
    Ed.on('cursor', function (info) {
      $('#stCursor').textContent = '行 ' + info.line + '，列 ' + info.column;
      var sel = $('#stSelection');
      if (info.selected > 0) {
        sel.hidden = false;
        sel.textContent = '已选 ' + info.selected + (info.selectedLines > 1 ? ' (' + info.selectedLines + ' 行)' : '');
      } else sel.hidden = true;
    });

    // 编辑器滚动同步预览
    if (Ed.editor) {
      Ed.editor.onDidScrollChange(function () {
        if (!state.previewVisible || !Cfg.get('previewSync') || state.previewSyncing) return;
        syncPreviewScroll();
      });
    }
  }

  /* =========================================================
     标签栏
     ========================================================= */
  function renderTabs() {
    var wrap = $('#tabs');
    var frag = document.createDocumentFragment();

    Ed.docs.forEach(function (doc) {
      var el = document.createElement('div');
      el.className = 'tab' + (doc.id === Ed.activeId ? ' active' : '') + (doc.dirty ? ' dirty' : '');
      el.setAttribute('role', 'tab');
      el.title = (doc.path || doc.name) + (doc.handle ? '' : '（未关联本地文件）');

      var dot = document.createElement('span');
      dot.className = 'tab-icon';
      dot.style.cssText = 'width:8px;height:8px;border-radius:2px;background:' + Langs.iconFor(doc.langId);
      el.appendChild(dot);

      var name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = doc.name;
      el.appendChild(name);

      var close = document.createElement('button');
      close.className = 'tab-close';
      close.title = '关闭';
      close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>';
      close.onclick = function (e) { e.stopPropagation(); requestClose(doc); };
      el.appendChild(close);

      el.onclick = function () { Ed.activate(doc.id); };
      el.onauxclick = function (e) { if (e.button === 1) { e.preventDefault(); requestClose(doc); } };

      frag.appendChild(el);
    });

    wrap.innerHTML = '';
    wrap.appendChild(frag);

    var act = wrap.querySelector('.tab.active');
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    var doc = Ed.active();
    $('#btnSave').classList.toggle('dirty', !!(doc && doc.dirty));
    renderStatus(doc);
  }

  /* =========================================================
     状态栏
     ========================================================= */
  function renderStatus(doc) {
    if (!doc) {
      $('#stFileText').textContent = '无打开文件';
      $('#stFile').classList.remove('dirty');
      updateSaveVisibility(null);
      return;
    }
    $('#stFileText').textContent = doc.path || doc.name;
    $('#stFile').classList.toggle('dirty', doc.dirty);
    $('#stFile').title = (doc.handle ? '已关联本地文件，Ctrl+S 直接覆写\n' : '未关联本地文件，保存时将提示另存\n') +
      (doc.path || doc.name);

    var enc = Encoding.info(doc.encoding);
    $('#stEncoding').textContent = enc.label + (doc.bom && enc.id !== 'utf-8-bom' ? ' BOM' : '');
    $('#stEol').textContent = doc.eol;
    $('#stLang').textContent = Langs.label(doc.langId);

    var opts = doc.model.getOptions();
    $('#stIndent').textContent = (opts.insertSpaces ? '空格' : '制表符') + ': ' + opts.tabSize;

    $('#btnSave').classList.toggle('dirty', doc.dirty);
    document.title = (doc.dirty ? '● ' : '') + doc.name + ' — 文本编辑器';
    updateSaveVisibility(doc);
  }

  /* 当前文件无法写回原位置时隐藏「保存」按钮（无文件句柄 = 只能另存/下载） */
  function updateSaveVisibility(doc) {
    var hasHandle = !!(doc && doc.handle);
    var btn = $('#btnSave');
    if (btn) btn.hidden = !hasHandle;
    var mi = $('#mainMenu [data-act="save"]');
    if (mi) mi.hidden = !hasHandle;
  }

  function updateCdnStatus() {
    var el = $('#stCdn');
    var name = Loader.state.monacoMirrorName;
    var failed = Loader.state.tried.filter(function (t) { return !t.ok; }).length;
    el.textContent = name ? (name + (failed ? ' (切换' + failed + '次)' : '')) : 'CDN';
    el.className = 'status-item' + (failed ? ' warn' : '');
    el.title = '资源镜像：' + (Loader.state.monacoBase || '未知') +
      (failed ? '\n已跳过 ' + failed + ' 个不可用源' : '') + '\n点击查看设置';
  }

  /* =========================================================
     文档操作
     ========================================================= */
  function newDoc() {
    var doc = Ed.createDoc({});
    Ed.activate(doc.id);
    return doc;
  }

  function requestClose(doc) {
    if (!doc.dirty) return Ed.closeDoc(doc.id);
    UI.confirm({
      title: '未保存的更改',
      message: '「' + doc.name + '」有尚未保存的更改，是否保存？',
      buttons: [
        { value: 'cancel', label: '取消', style: 'text' },
        { value: 'discard', label: '不保存', style: 'text' },
        { value: 'save', label: '保存', style: 'filled' }
      ]
    }).then(function (v) {
      if (v === 'discard') Ed.closeDoc(doc.id);
      else if (v === 'save') {
        Ed.activate(doc.id);
        doSave().then(function (ok) { if (ok) Ed.closeDoc(doc.id); });
      }
    });
  }

  /* ---------- 打开 ---------- */
  function doOpen(forcedEncoding) {
    return Files.openFiles(true).then(function (items) {
      if (!items || !items.length) return;
      return openItems(items, { encoding: forcedEncoding });
    }).catch(function (err) {
      UI.snack('打开失败：' + err.message, { type: 'error' });
    });
  }

  function openItems(items, opts) {
    opts = opts || {};
    var chain = Promise.resolve();
    var opened = [];
    if (opts.source === 'launch') state.launchBusy = true;

    items.forEach(function (item) {
      chain = chain.then(function () {
        return openOne(item, opts).then(function (doc) { if (doc) opened.push(doc); });
      });
    });

    return chain.then(function () {
      if (opts.source === 'launch') state.launchBusy = false;
      if (opened.length) {
        Ed.activate(opened[opened.length - 1].id);
        if (opened.length > 1) UI.snack('已打开 ' + opened.length + ' 个文件', { type: 'success' });
      }
      return opened;
    });
  }

  function openOne(item, opts) {
    var file = item.file;
    if (!file) return Promise.resolve(null);

    // 已打开则聚焦
    var exist = Ed.docs.filter(function (d) {
      return d.handle && item.handle && d.handle.name === item.handle.name && d.name === file.name;
    })[0];
    if (exist && !opts.encoding && !opts.reload) {
      return isSameEntry(exist.handle, item.handle).then(function (same) {
        if (same) { Ed.activate(exist.id); return null; }
        return doRead();
      });
    }
    return doRead();

    function doRead() {
      if (file.size > 64 * 1024 * 1024) {
        UI.snack('文件过大（' + fmtSize(file.size) + '），已跳过', { type: 'error' });
        return Promise.resolve(null);
      }
      return Files.readBytes(file).then(function (bytes) {
        var enc, det = null;
        if (opts.encoding) {
          enc = Encoding.normalize(opts.encoding);
        } else if (Cfg.get('autoDetect')) {
          det = Encoding.detect(bytes);
          enc = det.encoding;
        } else {
          var bom = Encoding.detectBOM(bytes);
          enc = bom ? bom.encoding : Cfg.get('defaultEncoding');
        }

        // 始终判断是否为二进制（与是否开启「自动编码检测」无关）：
        // 选了文件后先在网页内判断能否当作文本加载，不能则征询用户是否仍以文本打开。
        var binary = (det && det.binary) || Encoding.isBinary(bytes);
        if (binary) {
          return UI.confirm({
            title: '可能是二进制文件',
            message: '「' + file.name + '」看起来不是纯文本文件，强行以文本方式打开可能显示乱码，且保存后会损坏文件。仍要打开吗？',
            buttons: [
              { value: 'cancel', label: '取消', style: 'text' },
              { value: 'ok', label: '仍然打开', style: 'filled' }
            ]
          }).then(function (v) {
            if (v !== 'ok') return null;
            return finish(bytes, enc, det, binary);
          });
        }
        return finish(bytes, enc, det, binary);
      }).catch(function (err) {
        UI.snack('读取「' + file.name + '」失败：' + err.message, { type: 'error' });
        return null;
      });
    }

    function finish(bytes, enc, det, isBinary) {
      var text = Encoding.decode(bytes, enc);
      var hasBOM = det ? det.hasBOM : !!Encoding.detectBOM(bytes);

      var doc = Ed.createDoc({
        name: file.name,
        path: item.path || file.name,
        content: text,
        handle: item.handle || null,
        encoding: enc,
        bom: hasBOM,
        eol: Encoding.detectEol(text) || Cfg.get('defaultEol'),
        size: file.size,
        binary: !!isBinary,
        detectInfo: det
      });
      Ed.markSaved(doc);

      if (item.handle) {
        Files.rememberHandle(file.name + ':' + file.size, item.handle, { name: file.name, enc: enc });
        markFsBaseline(doc, file);
      }
      // 提前构建编码表，避免首次保存卡顿
      Encoding.warmup(enc);

      if (det && det.confidence === 'low' && !opts.encoding) {
        UI.snack('「' + file.name + '」编码不确定，已按 ' + Encoding.info(enc).label + ' 打开', {
          action: '更改编码',
          onAction: function () { reopenWithEncoding(); },
          duration: 6000
        });
      }
      return doc;
    }
  }

  function isSameEntry(a, b) {
    if (!a || !b) return Promise.resolve(false);
    if (typeof a.isSameEntry === 'function') return a.isSameEntry(b).catch(function () { return false; });
    return Promise.resolve(false);
  }

  /* ---------- 以指定编码重新打开 ---------- */
  function reopenWithEncoding() {
    var doc = Ed.active();
    if (!doc) return;
    if (!doc.handle) {
      UI.snack('该文件未关联本地文件，无法重新读取', { type: 'error' });
      return;
    }
    UI.pickEncoding({
      title: '以指定编码重新打开',
      desc: '将用新的编码重新读取「' + doc.name + '」，未保存的更改会丢失。',
      current: doc.encoding
    }).then(function (res) {
      if (!res) return;
      Files.verifyPermission(doc.handle, false).then(function (ok) {
        if (!ok) throw new Error('没有读取权限');
        return doc.handle.getFile();
      }).then(function (file) {
        return Files.readBytes(file);
      }).then(function (bytes) {
        var text = Encoding.decode(bytes, res.encoding);
        doc.model.setValue(text);
        doc.encoding = res.encoding;
        doc.bom = !!Encoding.detectBOM(bytes);
        doc.eol = Encoding.detectEol(text) || doc.eol;
        Ed.markSaved(doc);
        markFsBaseline(doc);
        renderStatus(doc);
        Encoding.warmup(res.encoding);
        UI.snack('已用 ' + Encoding.info(res.encoding).label + ' 重新打开', { type: 'success' });
      }).catch(function (err) {
        UI.snack('重新打开失败：' + err.message, { type: 'error' });
      });
    });
  }

  /* ---------- 保存 ---------- */
  function buildBytes(doc, encId, bom) {
    var text = Ed.textForSave(doc);
    return Encoding.encode(text, encId, { bom: bom });
  }

  function doSave(forceDialog) {
    var doc = Ed.active();
    if (!doc) return Promise.resolve(false);

    if (!doc.handle || forceDialog) return doSaveAs();

    var enc;
    try { enc = buildBytes(doc, doc.encoding, doc.bom); }
    catch (err) { UI.snack(err.message, { type: 'error' }); return Promise.resolve(false); }

    return warnLoss(enc, doc).then(function (go) {
      if (!go) return false;
      return Files.writeToHandle(doc.handle, enc.bytes).then(function () {
        Ed.markSaved(doc);
        markFsBaseline(doc);
        renderStatus(doc);
        UI.snack('已保存到 ' + doc.name + '（' + Encoding.info(doc.encoding).label + '，' + fmtSize(enc.bytes.length) + '）', { type: 'success' });
        scheduleSession();
        return true;
      }).catch(function (err) {
        if (err && err.name === 'NotAllowedError') {
          UI.snack('写入权限被拒绝，请改用「另存为」', {
            type: 'error', action: '另存为', onAction: doSaveAs
          });
        } else {
          UI.snack('保存失败：' + err.message, { type: 'error', action: '另存为', onAction: doSaveAs });
        }
        return false;
      });
    });
  }

  function doSaveAs(encOverride, bomOverride) {
    var doc = Ed.active();
    if (!doc) return Promise.resolve(false);

    var encId = encOverride || doc.encoding;
    var bom = bomOverride !== undefined ? bomOverride : doc.bom;
    var enc;
    try { enc = buildBytes(doc, encId, bom); }
    catch (err) { UI.snack(err.message, { type: 'error' }); return Promise.resolve(false); }

    return warnLoss(enc, doc).then(function (go) {
      if (!go) return false;
      return Files.saveAs(doc.name, enc.bytes).then(function (handle) {
        if (handle) {
          doc.handle = handle;
          doc.encoding = encId;
          doc.bom = bom;
          Ed.renameDoc(doc, handle.name);
          doc.path = handle.name;
          Ed.markSaved(doc);
          markFsBaseline(doc);
          renderStatus(doc);
          Files.rememberHandle(handle.name, handle, { name: handle.name, enc: encId });
          UI.snack('已另存为 ' + handle.name, { type: 'success' });
          scheduleSession();
          return true;
        }
        // 无 File System Access API：已触发下载
        if (!Files.hasFS) {
          doc.encoding = encId; doc.bom = bom;
          Ed.markSaved(doc);
          renderStatus(doc);
          UI.snack('已下载 ' + doc.name, { type: 'success' });
          scheduleSession();
          return true;
        }
        return false;
      }).catch(function (err) {
        UI.snack('另存失败：' + err.message, { type: 'error' });
        return false;
      });
    });
  }

  function doSaveWithEncoding() {
    var doc = Ed.active();
    if (!doc) return;
    UI.pickEncoding({
      title: '以指定编码保存',
      desc: '选择写入文件时使用的字符编码。',
      current: doc.encoding,
      bom: doc.bom,
      forWrite: true
    }).then(function (res) {
      if (!res) return;
      var enc;
      try { enc = buildBytes(doc, res.encoding, res.bom); }
      catch (err) { UI.snack(err.message, { type: 'error' }); return; }

      warnLoss(enc, doc).then(function (go) {
        if (!go) return;
        doc.encoding = res.encoding;
        doc.bom = res.bom;
        renderStatus(doc);
        if (doc.handle) {
          Files.writeToHandle(doc.handle, enc.bytes).then(function () {
            Ed.markSaved(doc);
            markFsBaseline(doc);
            renderStatus(doc);
            UI.snack('已用 ' + Encoding.info(res.encoding).label + ' 保存', { type: 'success' });
            scheduleSession();
          }).catch(function (err) {
            UI.snack('保存失败：' + err.message, { type: 'error', action: '另存为', onAction: function () { doSaveAs(res.encoding, res.bom); } });
          });
        } else {
          doSaveAs(res.encoding, res.bom);
        }
      });
    });
  }

  function doDownload(encOverride, bomOverride) {
    var doc = Ed.active();
    if (!doc) return;
    var encId = encOverride || doc.encoding;
    var bom = bomOverride !== undefined ? bomOverride : doc.bom;
    var enc;
    try { enc = buildBytes(doc, encId, bom); }
    catch (err) { UI.snack(err.message, { type: 'error' }); return; }

    warnLoss(enc, doc).then(function (go) {
      if (!go) return;
      Files.download(doc.name, enc.bytes);
      UI.snack('已开始下载 ' + doc.name + '（' + fmtSize(enc.bytes.length) + '）', { type: 'success' });
    });
  }

  function doSaveAll() {
    var dirty = Ed.docs.filter(function (d) { return d.dirty; });
    if (!dirty.length) { UI.snack('没有需要保存的文件'); return; }
    var cur = Ed.activeId;
    var chain = Promise.resolve();
    var okCount = 0;
    dirty.forEach(function (d) {
      chain = chain.then(function () {
        Ed.activate(d.id);
        return doSave().then(function (ok) { if (ok) okCount++; });
      });
    });
    chain.then(function () {
      if (cur) Ed.activate(cur);
      UI.snack('已保存 ' + okCount + '/' + dirty.length + ' 个文件', { type: okCount === dirty.length ? 'success' : 'error' });
    });
  }

  /** 编码丢失字符提醒 */
  function warnLoss(enc, doc) {
    if (!enc.lost) return Promise.resolve(true);
    var sample = enc.lostChars.join(' ');
    return UI.confirm({
      title: '部分字符无法编码',
      message: '有 ' + enc.lost + ' 个字符无法用 ' + Encoding.info(doc.encoding).label +
        ' 表示，将被替换为「?」。例如：' + sample + '\n\n建议改用 UTF-8 保存以避免丢失。',
      buttons: [
        { value: 'cancel', label: '取消', style: 'text' },
        { value: 'utf8', label: '改用 UTF-8', style: 'tonal' },
        { value: 'ok', label: '继续保存', style: 'filled' }
      ]
    }).then(function (v) {
      if (v === 'utf8') {
        doc.encoding = 'utf-8';
        doc.bom = false;
        renderStatus(doc);
        setTimeout(function () { doSave(); }, 60);
        return false;
      }
      return v === 'ok';
    });
  }

  /* =========================================================
     编码 / 语言 / 行尾
     ========================================================= */
  function chooseEncodingMenu() {
    var doc = Ed.active();
    if (!doc) return;
    UI.confirm({
      title: '文件编码',
      message: '当前编码：' + Encoding.info(doc.encoding).label +
        (doc.bom ? '（含 BOM）' : '') + '\n\n请选择要执行的操作。',
      buttons: [
        { value: 'cancel', label: '取消', style: 'text' },
        { value: 'reopen', label: '按编码重新打开', style: 'tonal' },
        { value: 'save', label: '按编码保存', style: 'filled' }
      ]
    }).then(function (v) {
      if (v === 'reopen') reopenWithEncoding();
      else if (v === 'save') doSaveWithEncoding();
    });
  }

  function toggleEol() {
    var doc = Ed.active();
    if (!doc) return;
    Ed.setEol(doc, doc.eol === 'LF' ? 'CRLF' : 'LF');
    renderStatus(doc);
    UI.snack('行尾序列已切换为 ' + doc.eol);
  }

  function toggleIndent() {
    var doc = Ed.active();
    if (!doc) return;
    var o = doc.model.getOptions();
    var sizes = [2, 4, 8];
    var next = sizes[(sizes.indexOf(o.tabSize) + 1) % sizes.length] || 2;
    doc.model.updateOptions({ tabSize: next });
    renderStatus(doc);
    UI.snack('缩进已设为 ' + next + ' 空格');
  }

  function chooseLanguage() {
    if (!global.monaco) return;
    Ed.runAction('editor.action.changeLanguageMode');
    setTimeout(function () {
      var doc = Ed.active();
      if (doc) { doc.langId = doc.model.getLanguageId(); renderStatus(doc); updatePreviewVisibility(doc); }
    }, 400);
  }

  /* =========================================================
     Markdown 预览
     ========================================================= */
  /* 当前文档可预览的类型：'markdown' | 'html' | null */
  function previewMode(doc) {
    if (!doc) return null;
    if (Langs.isMarkdown(doc.name, doc.langId)) return 'markdown';
    var e = Langs.extOf(doc.name);
    if (doc.langId === 'html' ||
        e === 'html' || e === 'htm' || e === 'xhtml' || e === 'vue' ||
        e === 'svg' || e === 'hbs' || e === 'ejs' || e === 'jsp' ||
        e === 'asp' || e === 'aspx' || e === 'erb' || e === 'art' ||
        doc.langId === 'handlebars' || doc.langId === 'razor' ||
        doc.langId === 'twig' || doc.langId === 'pug') {
      return 'html';
    }
    return null;
  }

  function updatePreviewVisibility(doc) {
    var mode = previewMode(doc);
    state.previewMode = mode;
    $('#btnPreview').hidden = !mode;
    if (!mode) {
      // 没有任何可预览的内容：按钮隐藏，若预览仍开着则强制关闭并清空
      if (state.previewVisible) togglePreview(false);
      return;
    }
    if (doc.previewOn && !state.previewVisible) togglePreview(true);
    else if (!doc.previewOn && state.previewVisible) togglePreview(false);
    $('#btnPreview').classList.toggle('on', state.previewVisible);
  }

  function togglePreview(force) {
    var doc = Ed.active();
    var mode = previewMode(doc) || state.previewMode || 'markdown';
    var want = force !== undefined ? force : !state.previewVisible;
    // 没有可预览的文档时忽略「打开」请求
    if (want && !previewMode(doc)) { $('#btnPreview').classList.remove('on'); return; }

    state.previewVisible = want;
    state.previewMode = mode;
    $('#btnPreview').classList.toggle('on', want);
    if (doc) doc.previewOn = want;

    var article = $('#preview');
    var frame = $('#previewFrame');

    if (want) {
      // 打开：按类型选择预览表面（Markdown 用文章，HTML 用沙箱 iframe）
      $('#panePreview').hidden = false;
      $('#splitter').hidden = false;
      applySplit(Cfg.get('previewRatio'));
      if (mode === 'html') {
        article.hidden = true; frame.hidden = false;
        $('#previewTitle').textContent = 'HTML 预览';
      } else {
        article.hidden = false; frame.hidden = true;
        $('#previewTitle').textContent = 'Markdown 预览';
      }
      schedulePreview(true);
    } else {
      // 关闭：隐藏面板后必须重置左侧编辑器内联 flex（否则残留 0.5 导致右侧空白占位）；
      // 同时清空两侧内容，避免再次打开时闪现上个文件。
      $('#panePreview').hidden = true;
      $('#splitter').hidden = true;
      $('#paneEditor').style.flex = '1 1 0%';
      $('#panePreview').style.flex = '';
      state.lastMd = '';
      state.lastHtml = '';
      article.innerHTML = '';
      article.scrollTop = 0;
      if (frame) { frame.srcdoc = 'about:blank'; frame.hidden = true; }
    }
    // 容器宽度已同步变化，立刻 + 下一帧各 layout 一次，确保编辑器正确铺满
    if (Ed.editor) Ed.editor.layout();
    requestAnimationFrame(function () { if (Ed.editor) Ed.editor.layout(); });
    setTimeout(function () { if (Ed.editor) Ed.editor.layout(); }, 80);
  }

  function schedulePreview(immediate) {
    if (!state.previewVisible) return;
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(renderPreview, immediate ? 0 : 220);
  }

  function renderPreview() {
    var doc = Ed.active();
    if (!doc || !state.previewVisible) return;
    var mode = previewMode(doc) || state.previewMode;
    if (!mode) return;
    var src = doc.model.getValue();

    if (mode === 'markdown') {
      var host = $('#preview');
      var html = Markdown.render(src);
      if (html === state.lastMd) return;
      state.lastMd = html;

      var prevTop = host.scrollTop;
      host.innerHTML = html;
      host.scrollTop = prevTop;

      Markdown.highlight(host);

      // 外链安全
      $$('a[href]', host).forEach(function (a) {
        if (/^#/.test(a.getAttribute('href'))) {
          a.onclick = function (e) {
            e.preventDefault();
            var t = host.querySelector(a.getAttribute('href'));
            if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
          };
        } else {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
      });
    } else if (mode === 'html') {
      // HTML 预览：先消毒再放进沙箱 iframe（无脚本执行，避免 XSS）
      var frame = $('#previewFrame');
      var clean = sanitizeHtml(src);
      if (clean === state.lastHtml) return;
      state.lastHtml = clean;
      frame.srcdoc = clean;
    }
  }

  /** HTML 预览消毒：DOMPurify 负责 body 的 XSS 清洗；内嵌 <style> 由 DOMPurify 3.x 默认剥离，
      这里抽出后单独做 CSS 安全清洗再回注，从而实现「内嵌 CSS 也能正常渲染」。 */
  function sanitizeHtml(html) {
    var styles = extractStyles(html);          // 内嵌样式（已清洗）
    var clean = sanitizeBody(html);            // 去除脚本/危险标签后的正文
    if (styles.length) {
      var injected = '<style>\n' + styles.join('\n') + '\n</style>';
      if (/<\/head>/i.test(clean)) clean = clean.replace(/<\/head>/i, injected + '</head>');
      else clean = injected + clean;
    }
    return clean;
  }

  function sanitizeBody(html) {
    if (global.DOMPurify && typeof global.DOMPurify.sanitize === 'function') {
      return global.DOMPurify.sanitize(html, {
        WHOLE_DOC: true,
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta'],
        FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onmouseout']
      });
    }
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,link,meta').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });
    return doc.documentElement.outerHTML;
  }

  /** 抽出所有 <style> 块并清洗 CSS（去除 @import / url() 外链 / expression / behavior 等危险结构） */
  function extractStyles(html) {
    var out = [];
    var re = /<style[^>]*>([\s\S]*?)<\/style>/gi, m;
    while ((m = re.exec(html))) out.push(sanitizeCss(m[1]));
    return out;
  }

  function sanitizeCss(css) {
    return css
      .replace(/@import[^;]+;?/gi, '')
      .replace(/url\(\s*['"]?\s*(?:javascript|data|vbscript):[^)]*\)/gi, 'url()')
      .replace(/expression\s*\(/gi, 'void(')
      .replace(/behavior\s*:/gi, 'xbehavior:')
      .replace(/-moz-binding/gi, 'x-moz-binding')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '');
  }

  function syncPreviewScroll() {
    var ed = Ed.editor;
    var host = $('#preview');
    if (!ed || !host) return;
    var top = ed.getScrollTop();
    var height = ed.getScrollHeight() - ed.getLayoutInfo().height;
    if (height <= 0) return;
    var ratio = Math.max(0, Math.min(1, top / height));
    state.previewSyncing = true;
    host.scrollTop = ratio * (host.scrollHeight - host.clientHeight);
    requestAnimationFrame(function () { state.previewSyncing = false; });
  }

  /* =========================================================
     本地文件外部变动监听

     只有拿得到 FileSystemFileHandle 的文档才能监听（File System Access API
     打开、PWA 文件关联启动、另存为之后）。<input type=file> 回退打开的文件
     只有一份 File 快照，浏览器不提供任何变动通知，无法监听。
     ========================================================= */
  function watchEnabled() {
    return !!(global.Watch && global.Watch.supported && Cfg.get('watchFiles'));
  }

  function startWatch() {
    if (!global.Watch) return;
    if (!watchEnabled()) { global.Watch.stop(); return; }
    global.Watch.start({
      interval: Cfg.get('watchInterval') || 3000,
      docs: function () { return Ed.docs; },
      onChanged: onFileChanged,
      onMissing: onFileMissing
    });
  }

  /* 打开 / 保存 / 重载后登记基线，避免把自己的写入当成外部改动 */
  function markFsBaseline(doc, file) {
    if (global.Watch && doc && doc.handle) global.Watch.baseline(doc, file);
  }

  function onFileChanged(doc, file) {
    var label = '「' + doc.name + '」';

    // 文档没有未保存的改动：直接重载最安全
    if (!doc.dirty) {
      if (Cfg.get('watchAutoReload')) {
        return reloadFromDisk(doc, file).then(function (ok) {
          if (ok) UI.snack(label + '已被外部修改，已自动重新加载', { type: 'success' });
        });
      }
      return new Promise(function (resolve) {
        var done = false;
        function finish() { if (!done) { done = true; resolve(); } }
        UI.snack(label + '已被其它程序修改', {
          action: '重新加载',
          duration: 8000,
          onAction: function () { reloadFromDisk(doc, file).then(finish, finish); }
        });
        setTimeout(finish, 8200);
      });
    }

    // 双方都改了 —— 冲突，必须让用户决定
    return UI.confirm({
      title: '文件已被外部修改',
      message: label + '在磁盘上已被其它程序修改，而你在编辑器里也有未保存的更改。\n' +
               '「重新加载」会丢弃你的更改，「保存我的」会覆盖磁盘上的新内容。',
      buttons: [
        { value: 'ignore', label: '忽略', style: 'text' },
        { value: 'diff', label: '查看差异', style: 'text' },
        { value: 'reload', label: '重新加载', style: 'danger' },
        { value: 'save', label: '保存我的', style: 'filled' }
      ]
    }).then(function (v) {
      if (v === 'reload') return reloadFromDisk(doc, file);
      if (v === 'save') { Ed.activate(doc.id); return doSave(false); }
      if (v === 'diff') return showDiskDiff(doc, file);
      return null;
    });
  }

  function onFileMissing(doc) {
    Ed.markDirty(doc);
    doc.handle = null;                       // 句柄已失效，别再反复报警
    if (global.Watch) global.Watch.forget(doc);
    if (Ed.active() === doc) renderStatus(doc);
    renderTabs();
    UI.snack('「' + doc.name + '」在磁盘上已不存在（被删除或移动），内容仍保留在编辑器中', {
      type: 'error',
      duration: 9000,
      action: '另存为',
      onAction: function () { Ed.activate(doc.id); doSaveAs(); }
    });
    return Promise.resolve();
  }

  /* 用文档当前的编码重新读盘。走 pushEditOperations 而不是 setValue，
     这样误操作还能 Ctrl+Z 撤回。 */
  function reloadFromDisk(doc, file) {
    var p = file ? Promise.resolve(file) : (global.Watch ? global.Watch.stat(doc) : Promise.resolve(null));
    return p.then(function (f) {
      if (!f) throw new Error('无法读取文件（可能已失去权限）');
      return Files.readBytes(f).then(function (bytes) {
        var text = Encoding.decode(bytes, doc.encoding);
        var isActive = Ed.active() === doc;
        var view = (isActive && Ed.editor) ? Ed.editor.saveViewState() : null;

        doc.model.pushStackElement();
        doc.model.pushEditOperations(
          [],
          [{ range: doc.model.getFullModelRange(), text: text }],
          function () { return null; }
        );
        doc.model.pushStackElement();

        if (view && Ed.editor) Ed.editor.restoreViewState(view);
        doc.bom = !!Encoding.detectBOM(bytes);
        doc.eol = Encoding.detectEol(text) || doc.eol;
        doc.size = f.size;
        Ed.markSaved(doc);
        markFsBaseline(doc, f);
        if (isActive) { renderStatus(doc); if (doc.previewOn) renderPreview(); }
        scheduleSession();
        return true;
      });
    }).catch(function (err) {
      UI.snack('重新加载失败：' + err.message, { type: 'error' });
      return false;
    });
  }

  /* 菜单「从磁盘重新加载」 */
  function reloadActiveFromDisk() {
    var doc = Ed.active();
    if (!doc) return;
    if (!doc.handle) { UI.snack('该文档未关联本地文件，无法重新加载', { type: 'error' }); return; }
    var go = doc.dirty
      ? UI.confirm({
          title: '放弃未保存的更改？',
          message: '「' + doc.name + '」有未保存的更改，从磁盘重新加载会覆盖这些内容。',
          buttons: [
            { value: 'cancel', label: '取消', style: 'text' },
            { value: 'ok', label: '重新加载', style: 'danger' }
          ]
        }).then(function (v) { return v === 'ok'; })
      : Promise.resolve(true);

    go.then(function (ok) {
      if (!ok) return;
      // 需要权限时可以在这里弹框：菜单点击本身就是用户手势
      Files.verifyPermission(doc.handle, false).then(function (granted) {
        if (!granted) throw new Error('没有读取权限');
        return doc.handle.getFile();
      }).then(function (f) {
        return reloadFromDisk(doc, f);
      }).then(function (done) {
        if (done) UI.snack('已从磁盘重新加载 ' + doc.name, { type: 'success' });
      }).catch(function (err) {
        UI.snack('重新加载失败：' + err.message, { type: 'error' });
      });
    });
  }

  /* 冲突时「查看差异」：左＝磁盘版本，右＝编辑器版本 */
  function showDiskDiff(doc, file) {
    return Files.readBytes(file).then(function (bytes) {
      var diskText = Encoding.decode(bytes, doc.encoding);
      openDiff(true);   // 跳过默认填充，下面自己填，少算一次 diff
      batchDiffUpdate(function () {
        setDiffSide('left', diskText, doc.langId);
        setDiffSide('right', doc.model.getValue(), doc.langId);
      });
      $('#diffLeftSel').value = '';
      $('#diffRightSel').value = doc.id;
      UI.snack('左：磁盘上的版本　右：编辑器中的版本（关闭后可用 Ctrl+S 覆盖磁盘）', { duration: 7000 });
    }).catch(function (err) {
      UI.snack('读取磁盘版本失败：' + err.message, { type: 'error' });
    });
  }

  /* =========================================================
     文本对比（Diff）
     ========================================================= */
  var diffEditor = null;
  var diffModels = { left: null, right: null };
  var diffViewOpen = false;

  function monacoThemeName() {
    return resolveTheme() === 'dark' ? 'material-dark' : 'material-light';
  }

  function refreshDiffSelects() {
    ['left', 'right'].forEach(function (side) {
      var sel = $('#diff' + side.charAt(0).toUpperCase() + side.slice(1) + 'Sel'); // diffLeftSel / diffRightSel
      if (!sel) return;
      var cur = sel.value;
      sel.innerHTML = '';
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— 空白 —';
      sel.appendChild(blank);
      Ed.docs.forEach(function (d) {
        var o = document.createElement('option');
        o.value = d.id; o.textContent = d.name;
        sel.appendChild(o);
      });
      if (cur && Ed.getDoc(cur)) sel.value = cur;
    });
  }

  function ensureDiffModels() {
    if (!diffModels.left) {
      diffModels.left = global.monaco.editor.createModel('', 'plaintext');
      diffModels.right = global.monaco.editor.createModel('', 'plaintext');
    }
  }

  function setDiffSide(side, text, lang) {
    var model = side === 'left' ? diffModels.left : diffModels.right;
    var l = lang || 'plaintext';
    if (model.getLanguageId() !== l) global.monaco.editor.setModelLanguage(model, l);
    model.setValue(text || '');
  }

  function createDiffEditorIfNeeded() {
    if (diffEditor || !global.monaco) return diffEditor;
    diffEditor = global.monaco.editor.createDiffEditor($('#diffEditor'), {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      fontSize: Cfg.get('fontSize'),
      fontFamily: Cfg.get('fontFamily'),
      theme: monacoThemeName(),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: false,
      diffWordWrap: Cfg.get('wordWrap') ? 'on' : 'off',
      originalEditable: false,
      // Monaco 默认 maxComputationTime=5000：超时会**静默放弃**并当成"无差异"渲染，
      // 正是"打开后什么结果都不出"的元凶之一。置 0 = 不设上限，配合下方遮罩给用户反馈。
      maxComputationTime: 0,
      // 默认 50(MB) 以上直接不算。置 0 = 不限制，由上面的计算反馈兜底。
      maxFileSize: 0,
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false }
    });
    diffEditor.onDidUpdateDiff(function () {
      endDiffCompute();
      scheduleOverview();
    });
    // 滚动只影响视口、不影响差异分布，用 rAF 节流即可，避免每帧重建整条标记条
    diffEditor.getModifiedEditor().onDidScrollChange(scheduleOverview);
    return diffEditor;
  }

  /* ---- 差异计算中的反馈与超时兜底 ---- */
  var diffComputeTimer = null;

  function beginDiffCompute() {
    if (!diffViewOpen) return;           // 预热阶段静默进行，不打扰用户
    var el = $('#diffLoading');
    if (el) {
      el.innerHTML = '<div class="diff-loading-box"><span class="diff-spin"></span><span>正在计算差异…</span></div>';
      el.hidden = false;
    }
    if (diffComputeTimer) clearTimeout(diffComputeTimer);
    diffComputeTimer = setTimeout(onDiffComputeTimeout, 12000);
  }

  function endDiffCompute() {
    if (diffComputeTimer) { clearTimeout(diffComputeTimer); diffComputeTimer = null; }
    var el = $('#diffLoading');
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }

  // 12s 还没算出来，基本是 worker 脚本没下下来（CDN 抽风），给一个能自救的重试入口
  function onDiffComputeTimeout() {
    diffComputeTimer = null;
    var el = $('#diffLoading');
    if (!el || el.hidden) return;
    el.innerHTML = '<div class="diff-loading-box">' +
      '<span>差异计算较慢：对比 worker 可能仍在下载</span>' +
      '<button class="diff-btn" id="diffRetryBtn">重试</button>' +
      '<button class="diff-btn" id="diffDismissBtn">继续等待</button>' +
      '</div>';
    var r = $('#diffRetryBtn'); if (r) r.onclick = retryDiffCompute;
    var d = $('#diffDismissBtn'); if (d) d.onclick = function () { el.hidden = true; el.innerHTML = ''; };
  }

  function retryDiffCompute() {
    if (!diffEditor) return;
    beginDiffCompute();
    diffEditor.setModel(null);
    // 重试前再预热一次 worker 脚本：多数情况是首个 CDN 请求卡住，重新拉一遍就好了
    var warm = (global.Loader && Loader.prewarmWorker) ? Loader.prewarmWorker() : Promise.resolve(false);
    warm.then(function () {
      if (diffEditor) diffEditor.setModel({ original: diffModels.left, modified: diffModels.right });
    }, function () {
      if (diffEditor) diffEditor.setModel({ original: diffModels.left, modified: diffModels.right });
    });
  }

  function syncDiffModel() {
    if (!diffEditor) { updateDiffOverview(); return; }
    beginDiffCompute();
    diffEditor.setModel({ original: diffModels.left, modified: diffModels.right });
    scheduleOverview();
  }

  /**
   * 批量改两侧内容。
   * 关键优化：模型一旦挂在 diff 编辑器上，每次 setValue 都会**立刻触发一次全量 diff 计算**。
   * 原来 openDiff 里「setModel → 改左 → 改右 → 再 setModel」会连算 4 次；
   * 大文件 + 冷 worker 时，前几次废计算会把真正需要的那次结果一直往后拖。
   * 这里先摘掉模型再改内容，改完只挂一次、只算一次。
   */
  function batchDiffUpdate(fn) {
    if (diffEditor) diffEditor.setModel(null);
    try { fn(); } finally { syncDiffModel(); }
  }

  // skipDefaults=true：调用方紧接着会自己填两侧内容，跳过默认填充少算一次 diff
  function openDiff(skipDefaults) {
    if (!global.monaco) return;
    refreshDiffSelects();
    $('#diffView').hidden = false;
    diffViewOpen = true;

    ensureDiffModels();
    createDiffEditorIfNeeded();
    clearWarmPlaceholder();

    // 默认填充：左侧=当前活动文档，右侧=另一个已打开文档（如有），否则保持原样
    if (skipDefaults !== true) {
      batchDiffUpdate(function () {
        var act = Ed.active();
        if (!act) return;
        setDiffSide('left', act.model.getValue(), act.langId);
        var other = Ed.docs.filter(function (d) { return d.id !== act.id; })[0];
        if (other) setDiffSide('right', other.model.getValue(), other.langId);
      });
    }

    // 容器刚从 hidden 切出来时尺寸为 0，显式 layout 一次，避免首帧空白
    var relayout = function () { if (diffEditor) { try { diffEditor.layout(); } catch (e) {} } };
    if (global.requestAnimationFrame) global.requestAnimationFrame(relayout); else setTimeout(relayout, 0);
  }

  function closeDiff() {
    if (!diffViewOpen) return;
    diffViewOpen = false;
    endDiffCompute();
    $('#diffView').hidden = true;
    if (diffEditor) diffEditor.setModel(null);
    if (Ed.editor) Ed.editor.layout();
  }

  /**
   * 预热对比能力：Monaco 的差异计算跑在 web worker 里，而 worker 是首次用到才创建的
   * （创建时才去 CDN 下 workerMain.js）。所以"第一次打开对比要等很久 / 概率不出结果"
   * 本质是 worker 冷启动 + CDN 抖动，而不是 diff 算法本身慢。
   * 启动空闲期就把 worker 脚本拉好、并跑一次微型 diff 让 worker 真正跑起来，
   * 用户点开时就是热的。
   */
  var WARM_LEFT = '\u0001warm\n';
  var WARM_RIGHT = '\u0001warmed\n';

  /** 若模型里还残留预热占位文本就清掉（用户抢在 worker 回调前点开对比时会遇到） */
  function clearWarmPlaceholder() {
    if (!diffModels.left || !diffModels.right) return;
    if (diffModels.left.getValue() !== WARM_LEFT) return;
    try {
      if (diffEditor) diffEditor.setModel(null);
      diffModels.left.setValue('');
      diffModels.right.setValue('');
    } catch (e) {}
  }

  function prewarmDiff() {
    if (!global.monaco || diffEditor || diffViewOpen) return;
    try {
      ensureDiffModels();
      createDiffEditorIfNeeded();
      if (!diffEditor) return;

      var cleaned = false;
      var cleanup = function () {
        if (cleaned) return;
        cleaned = true;
        try { sub.dispose(); } catch (e) {}
        if (diffViewOpen) return;           // 用户已经打开对比了，openDiff 会自己清理
        clearWarmPlaceholder();
      };

      var sub = diffEditor.onDidUpdateDiff(cleanup);
      diffModels.left.setValue(WARM_LEFT);
      diffModels.right.setValue(WARM_RIGHT);
      diffEditor.setModel({ original: diffModels.left, modified: diffModels.right });
      setTimeout(cleanup, 20000);           // worker 始终不回也要把占位内容清掉
    } catch (e) { /* 预热失败不影响主流程 */ }
  }

  function schedulePrewarmDiff() {
    var run = function () {
      var warm = (global.Loader && Loader.prewarmWorker) ? Loader.prewarmWorker() : Promise.resolve(false);
      warm.then(prewarmDiff, prewarmDiff);
    };
    if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 1500);
  }

  function diffOpenFile(side) {
    Files.openFiles(true).then(function (items) {
      if (!items || !items.length) return;
      return readItemText(items[0]).then(function (data) {
        batchDiffUpdate(function () { setDiffSide(side, data.text, data.lang); });
      });
    }).catch(function (err) { UI.snack('打开失败：' + err.message, { type: 'error' }); });
  }

  function diffPaste(side) {
    var t = global.prompt('粘贴要对比的文本（' + (side === 'left' ? '左侧' : '右侧') + '）：');
    if (t === null) return;
    batchDiffUpdate(function () { setDiffSide(side, t, 'plaintext'); });
  }

  function diffFromTab(side, id) {
    var doc = Ed.getDoc(id);
    if (!doc) return;
    batchDiffUpdate(function () { setDiffSide(side, doc.model.getValue(), doc.langId); });
  }

  function swapDiff() {
    var l = diffModels.left.getValue(), r = diffModels.right.getValue();
    var ll = diffModels.left.getLanguageId(), rl = diffModels.right.getLanguageId();
    batchDiffUpdate(function () {
      setDiffSide('left', r, rl);
      setDiffSide('right', l, ll);
    });
  }

  /* ---- 最右侧差异标记条 ---- */
  var overviewRaf = 0;
  var overviewSig = null;
  var overviewBound = false;

  /** rAF 节流：滚动/连续变更时合并成一帧，避免每个事件都重建整条标记 DOM */
  function scheduleOverview() {
    if (overviewRaf) return;
    var run = function () { overviewRaf = 0; updateDiffOverview(); };
    overviewRaf = global.requestAnimationFrame ? global.requestAnimationFrame(run) : setTimeout(run, 16);
  }

  /** 最右侧差异位置滚动条：根据 Monaco diff 计算出的行变更，按比例绘制标记，点击可跳转 */
  function updateDiffOverview() {
    var ov = $('#diffOverview');
    if (!ov) return;
    if (!diffViewOpen || !diffEditor) { ov.innerHTML = ''; overviewSig = null; return; }
    var m = diffEditor.getModel();
    if (!m) { ov.innerHTML = ''; overviewSig = null; return; }

    // 事件委托：只绑一次，不再给每个标记单独挂 onclick
    if (!overviewBound) {
      overviewBound = true;
      ov.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('.diff-mark') : null;
        if (!el || !diffEditor) return;
        var ln = +el.getAttribute('data-line');
        try { diffEditor.getModifiedEditor().revealLineInCenter(ln); } catch (err) {}
      });
    }

    var total = m.modified.getLineCount() || 1;
    var changes = diffEditor.getLineChanges() || [];

    // 标记只取决于「总行数 + 变更集」，与滚动位置无关。
    // 签名没变就直接跳过 DOM 重建（滚动时能省掉绝大部分无谓重排）。
    var sig = total + '|' + changes.length + '|' + changes.map(function (c) {
      return c.originalStartLineNumber + ',' + c.originalEndLineNumber + ',' +
        c.modifiedStartLineNumber + ',' + c.modifiedEndLineNumber;
    }).join(';');
    if (sig === overviewSig) return;
    overviewSig = sig;

    var html = '';
    changes.forEach(function (ch) {
      var a = Math.min(ch.modifiedStartLineNumber, ch.modifiedEndLineNumber);
      var b = Math.max(ch.modifiedStartLineNumber, ch.modifiedEndLineNumber);
      var top = ((a - 1) / total) * 100;
      var h = Math.max(0.8, ((b - a + 1) / total) * 100);
      var type = 'change';
      if (ch.originalStartLineNumber === ch.originalEndLineNumber) type = 'add';       // 右侧新增
      else if (ch.modifiedStartLineNumber === ch.modifiedEndLineNumber) type = 'del';     // 右侧删除
      html += '<div class="diff-mark ' + type + '" style="top:' + top.toFixed(2) +
        '%;height:' + h.toFixed(2) + '%" data-line="' + a + '" title="跳转到第 ' + a + ' 行"></div>';
    });
    ov.innerHTML = html;
  }

  /** 复用打开逻辑：读取文件字节 → 检测编码 → 解码 → 识别语言 */
  function readItemText(item) {
    var file = item.file;
    if (!file) return Promise.resolve({ text: '', lang: 'plaintext' });
    return Files.readBytes(file).then(function (bytes) {
      var enc;
      if (Cfg.get('autoDetect')) {
        var det = Encoding.detect(bytes); enc = det.encoding;
      } else {
        var bom = Encoding.detectBOM(bytes);
        enc = bom ? bom.encoding : Cfg.get('defaultEncoding');
      }
      var text = Encoding.decode(bytes, enc);
      var lang = global.Langs.detectLanguage(file.name, text.slice(0, 2000));
      return { text: text, lang: lang };
    });
  }

  /* =========================================================
     分栏
     ========================================================= */
  function applySplit(ratio) {
    ratio = Math.max(0.15, Math.min(0.85, ratio || 0.5));
    $('#paneEditor').style.flex = ratio + ' 1 0%';
    $('#panePreview').style.flex = (1 - ratio) + ' 1 0%';
  }

  function setupSplitter() {
    var sp = $('#splitter');
    var area = $('#workarea');
    var dragging = false;

    sp.addEventListener('pointerdown', function (e) {
      dragging = true;
      sp.setPointerCapture(e.pointerId);
      sp.classList.add('dragging');
      document.body.style.cursor = innerWidth <= 720 ? 'row-resize' : 'col-resize';
      e.preventDefault();
    });

    sp.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var r = area.getBoundingClientRect();
      var ratio = innerWidth <= 720
        ? (e.clientY - r.top) / r.height
        : (e.clientX - r.left) / r.width;
      applySplit(ratio);
      if (Ed.editor) Ed.editor.layout();
    });

    var end = function (e) {
      if (!dragging) return;
      dragging = false;
      sp.classList.remove('dragging');
      document.body.style.cursor = '';
      try { sp.releasePointerCapture(e.pointerId); } catch (err) {}
      var r = area.getBoundingClientRect();
      var w = $('#paneEditor').getBoundingClientRect();
      Cfg.set('previewRatio', innerWidth <= 720 ? w.height / r.height : w.width / r.width);
      if (Ed.editor) Ed.editor.layout();
    };
    sp.addEventListener('pointerup', end);
    sp.addEventListener('pointercancel', end);

    sp.addEventListener('dblclick', function () { applySplit(0.5); Cfg.set('previewRatio', 0.5); });
  }

  /* =========================================================
     菜单动作
     ========================================================= */
  function handleMenu(act) {
    var doc = Ed.active();
    switch (act) {
      case 'new': newDoc(); break;
      case 'open': doOpen(); break;
      case 'openWithEncoding':
        UI.pickEncoding({ title: '以指定编码打开', desc: '选择读取文件时使用的字符编码。', current: Cfg.get('defaultEncoding') })
          .then(function (res) { if (res) doOpen(res.encoding); });
        break;
      case 'openFolder':
        Files.openDirectory().then(function (items) {
          if (!items.length) { UI.snack('文件夹中没有可识别的文本文件'); return; }
          openItems(items, {});
        }).catch(function (err) {
          if (err.name !== 'AbortError') UI.snack(err.message, { type: 'error' });
        });
        break;
      case 'reloadDisk': reloadActiveFromDisk(); break;
      case 'save': doSave(); break;
      case 'saveAs': doSaveAs(); break;
      case 'saveWithEncoding': doSaveWithEncoding(); break;
      case 'download': doDownload(); break;
      case 'saveAll': doSaveAll(); break;
      case 'find': Ed.runAction('actions.find'); break;
      case 'replace': Ed.runAction('editor.action.startFindReplaceAction'); break;
      case 'format': formatDoc(); break;
      case 'palette': Ed.runAction('editor.action.quickCommand'); break;
      case 'compare': openDiff(); break;
      case 'settings': openSettings(); break;
      case 'install': doInstall(); break;
      case 'welcome': openWelcome(); break;
      case 'about': showAbout(); break;

      case 'wordWrap': Cfg.set('wordWrap', !Cfg.get('wordWrap')); Ed.applySettings(); break;
      case 'minimap': Cfg.set('minimap', !Cfg.get('minimap')); Ed.applySettings(); break;
      case 'lineNumbers': Cfg.set('lineNumbers', !Cfg.get('lineNumbers')); Ed.applySettings(); break;
      case 'whitespace': Cfg.set('renderWhitespace', !Cfg.get('renderWhitespace')); Ed.applySettings(); break;
      case 'sticky': Cfg.set('stickyScroll', !Cfg.get('stickyScroll')); Ed.applySettings(); break;
      case 'fontInc': Cfg.set('fontSize', Math.min(40, Cfg.get('fontSize') + 1)); Ed.applySettings(); break;
      case 'fontDec': Cfg.set('fontSize', Math.max(8, Cfg.get('fontSize') - 1)); Ed.applySettings(); break;
      case 'fontReset': Cfg.set('fontSize', Cfg.DEFAULTS.fontSize); Ed.applySettings(); break;
      case 'toUpper': Ed.transformSelection(function (t) { return t.toUpperCase(); }); break;
      case 'toLower': Ed.transformSelection(function (t) { return t.toLowerCase(); }); break;
      case 'sortLines': Ed.sortLines(false); break;
      case 'trimTrailing': Ed.trimTrailing(); UI.snack('已去除行尾空格'); break;
      case 'stats': showStats(); break;
    }
  }

  function formatDoc() {
    var doc = Ed.active();
    if (!doc) return;
    // JSON 无内置格式化提供程序时手动处理
    if (doc.langId === 'json') {
      var text = doc.model.getValue();
      try {
        var obj = JSON.parse(text);
        var indent = doc.model.getOptions().insertSpaces ? doc.model.getOptions().tabSize : '\t';
        var out = JSON.stringify(obj, null, indent);
        Ed.editor.executeEdits('format', [{ range: doc.model.getFullModelRange(), text: out }]);
        UI.snack('已格式化 JSON', { type: 'success' });
        return;
      } catch (e) {
        UI.snack('JSON 语法错误：' + e.message, { type: 'error' });
        return;
      }
    }
    Ed.runAction('editor.action.formatDocument').then(function () {
      UI.snack('已格式化');
    }).catch(function () {
      UI.snack('当前语言没有可用的格式化程序', { type: 'error' });
    });
  }

  function showStats() {
    var doc = Ed.active();
    if (!doc) return;
    var s = Ed.stats(doc);
    UI.confirm({
      title: '文档统计',
      message: '行数：' + s.lines + '\n' +
               '字符数：' + s.chars + '（不含空白 ' + s.charsNoSpace + '）\n' +
               '词数：' + s.words + '\n' +
               '中文字符：' + s.cjk + '\n' +
               'UTF-8 字节数：' + fmtSize(s.bytes),
      buttons: [{ value: 'ok', label: '知道了', style: 'filled' }]
    });
  }

  function syncOverflowChecks() {
    var m = $('#overflowMenu');
    UI.setMenuChecked(m, 'wordWrap', Cfg.get('wordWrap'));
    UI.setMenuChecked(m, 'minimap', Cfg.get('minimap'));
    UI.setMenuChecked(m, 'lineNumbers', Cfg.get('lineNumbers'));
    UI.setMenuChecked(m, 'whitespace', Cfg.get('renderWhitespace'));
    UI.setMenuChecked(m, 'sticky', Cfg.get('stickyScroll'));
  }

  function cycleTheme() {
    var order = ['light', 'dark', 'auto'];
    var cur = Cfg.get('theme');
    var next = order[(order.indexOf(cur) + 1) % order.length];
    Cfg.set('theme', next);
    applyTheme();
    UI.snack('主题：' + ({ light: '亮色', dark: '暗色', auto: '跟随系统' })[next]);
  }

  /* =========================================================
     设置
     ========================================================= */
  function setupSettingsDialog() {
    var dlg = $('#dlgSettings');

    UI.segmented($('#setTheme'), Cfg.get('theme'), function (v) { Cfg.set('theme', v); applyTheme(); });
    UI.segmented($('#setTabSize'), Cfg.get('tabSize'), function (v) { Cfg.set('tabSize', +v); Ed.applySettings(); renderStatus(Ed.active()); });
    UI.segmented($('#setDefaultEol'), Cfg.get('defaultEol'), function (v) { Cfg.set('defaultEol', v); });

    var fs = $('#setFontSize');
    fs.value = Cfg.get('fontSize');
    $('#setFontSizeVal').textContent = Cfg.get('fontSize');
    fs.oninput = function () {
      $('#setFontSizeVal').textContent = this.value;
      Cfg.set('fontSize', +this.value);
      Ed.applySettings();
    };

    var ff = $('#setFontFamily');
    ff.value = Cfg.get('fontFamily');
    ff.onchange = function () {
      Cfg.set('fontFamily', this.value);
      document.documentElement.style.setProperty('--editor-font', this.value);
      Ed.applySettings();
    };

    var toggles = {
      setInsertSpaces: 'insertSpaces', setWordWrap: 'wordWrap', setMinimap: 'minimap',
      setLineNumbers: 'lineNumbers', setHighlightLine: 'highlightLine',
      setTrimOnSave: 'trimOnSave', setFinalNewline: 'finalNewline',
      setAutoDetect: 'autoDetect', setSession: 'session',
      setWatchFiles: 'watchFiles', setWatchAutoReload: 'watchAutoReload'
    };
    Object.keys(toggles).forEach(function (id) {
      var el = document.getElementById(id);
      el.checked = !!Cfg.get(toggles[id]);
      el.onchange = function () {
        Cfg.set(toggles[id], this.checked);
        Ed.applySettings();
        if (id === 'setWatchFiles') startWatch();
      };
    });

    var sel = $('#setDefaultEncoding');
    Encoding.list.filter(function (e) { return e.kind !== 'readonly'; }).forEach(function (e) {
      var o = document.createElement('option');
      o.value = e.id; o.textContent = e.label + (e.hint ? '（' + e.hint + '）' : '');
      sel.appendChild(o);
    });
    sel.value = Cfg.get('defaultEncoding');
    sel.onchange = function () { Cfg.set('defaultEncoding', this.value); };

    $('#setResetBtn').onclick = function () {
      UI.confirm({
        title: '恢复默认设置',
        message: '所有个性化设置将被重置，已打开的文档不受影响。',
        buttons: [{ value: 'cancel', label: '取消', style: 'text' }, { value: 'ok', label: '重置', style: 'danger' }]
      }).then(function (v) {
        if (v !== 'ok') return;
        Cfg.reset();
        applyTheme();
        Ed.applySettings();
        dlg.close();
        UI.snack('已恢复默认设置', { type: 'success' });
      });
    };
  }

  function openSettings() {
    // 同步当前值
    UI.setSegmented($('#setTheme'), Cfg.get('theme'));
    UI.setSegmented($('#setTabSize'), Cfg.get('tabSize'));
    UI.setSegmented($('#setDefaultEol'), Cfg.get('defaultEol'));
    $('#setFontSize').value = Cfg.get('fontSize');
    $('#setFontSizeVal').textContent = Cfg.get('fontSize');
    $('#setFontFamily').value = Cfg.get('fontFamily');
    $('#setDefaultEncoding').value = Cfg.get('defaultEncoding');
    ['setInsertSpaces:insertSpaces', 'setWordWrap:wordWrap', 'setMinimap:minimap',
     'setLineNumbers:lineNumbers', 'setHighlightLine:highlightLine', 'setTrimOnSave:trimOnSave',
     'setFinalNewline:finalNewline', 'setAutoDetect:autoDetect', 'setSession:session',
     'setWatchFiles:watchFiles', 'setWatchAutoReload:watchAutoReload']
      .forEach(function (pair) {
        var p = pair.split(':');
        document.getElementById(p[0]).checked = !!Cfg.get(p[1]);
      });

    var wHint = $('#setWatchHint');
    if (wHint) {
      wHint.textContent = (global.Watch && global.Watch.supported)
        ? (global.Watch.hasObserver
            ? '本浏览器支持即时通知'
            : '每 ' + Math.round((Cfg.get('watchInterval') || 3000) / 1000) + ' 秒检查一次；仅对「打开文件」关联的本地文件有效')
        : '当前浏览器不支持，需要 Chrome / Edge 等支持文件系统访问的浏览器';
    }

    $('#setCdnCurrent').textContent = Loader.state.monacoBase || '（未加载）';

    var list = $('#setCdnList');
    list.innerHTML = '';
    Cfg.MONACO_MIRRORS.forEach(function (m) {
      var tried = Loader.state.tried.filter(function (t) { return t.base === m.base; })[0];
      var div = document.createElement('div');
      div.className = 'cdn-item' +
        (m.base === Loader.state.monacoBase ? ' active' : '') +
        (tried && !tried.ok ? ' failed' : '');
      div.innerHTML = '<span class="dot"></span><span>' + m.name + '</span>';
      div.title = m.base + (tried && tried.error ? '\n失败原因：' + tried.error : '');
      list.appendChild(div);
    });

    $('#dlgSettings').showModal();
  }

  function showAbout() {
    var list = $('#aboutList');
    var s = Ed.active() ? Ed.stats(Ed.active()) : null;
    var rows = [
      ['Monaco Editor', Cfg.MONACO_VERSION],
      ['当前镜像', Loader.state.monacoMirrorName || '—'],
      ['Markdown 引擎', Markdown.usingMarked ? 'marked (CDN)' : '内置解析器'],
      ['HTML 消毒', global.DOMPurify ? 'DOMPurify' : '内置清洗'],
      ['文件系统 API', Files.hasFS ? '支持（可覆写原文件）' : '不支持（仅下载）'],
      ['文件关联', ('launchQueue' in global) ? '支持' : '不支持'],
      ['运行模式', matchMedia('(display-mode: standalone)').matches ? '独立窗口 (PWA)' : '浏览器标签页'],
      ['已打开文档', Ed.docs.length + ' 个']
    ];
    list.innerHTML = rows.map(function (r) {
      return '<li><b>' + r[0] + '</b><span>' + r[1] + '</span></li>';
    }).join('');
    $('#dlgAbout').showModal();
  }

  /* =========================================================
     快捷键
     ========================================================= */
  function bindShortcuts() {
    global.addEventListener('keydown', function (e) {
      if (diffViewOpen && e.key === 'Escape') { e.preventDefault(); closeDiff(); return; }
      var ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) {
        if (e.key === 'F1') { e.preventDefault(); Ed.runAction('editor.action.quickCommand'); }
        return;
      }
      var k = e.key.toLowerCase();

      if (k === 's' && !e.shiftKey) { e.preventDefault(); doSave(); }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); doSaveAs(); }
      else if (k === 'o' && !e.shiftKey) { e.preventDefault(); doOpen(); }
      else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newDoc(); }
      else if (k === 'd' && e.shiftKey) { e.preventDefault(); doDownload(); }
      else if (k === 'v' && e.shiftKey) { e.preventDefault(); if (!$('#btnPreview').hidden) togglePreview(); }
      else if (k === 'c' && e.shiftKey) { e.preventDefault(); openDiff(); }
      else if (k === 'w' && !e.shiftKey) {
        var doc = Ed.active();
        if (doc) { e.preventDefault(); requestClose(doc); }
      }
      else if (k === 'tab') {
        e.preventDefault();
        var idx = Ed.docs.findIndex(function (d) { return d.id === Ed.activeId; });
        if (Ed.docs.length > 1) {
          var next = e.shiftKey ? (idx - 1 + Ed.docs.length) % Ed.docs.length : (idx + 1) % Ed.docs.length;
          Ed.activate(Ed.docs[next].id);
        }
      }
      else if (/^[1-9]$/.test(k) && e.altKey) {
        var i = +k - 1;
        if (Ed.docs[i]) { e.preventDefault(); Ed.activate(Ed.docs[i].id); }
      }
    }, true);
  }

  /* =========================================================
     会话持久化
     ========================================================= */
  function startSessionAutosave() {
    setInterval(saveSession, 20000);
  }

  function scheduleSession() {
    clearTimeout(state.sessionTimer);
    state.sessionTimer = setTimeout(saveSession, 3000);
  }

  function saveSession() {
    if (!Cfg.get('session') || !state.ready) return;
    try {
      var snaps = Ed.docs.slice(0, 12).map(function (d) {
        var text = d.model.getValue();
        if (text.length > 400000) return null;   // 过大不入库
        return {
          id: d.id, name: d.name, path: d.path || null,
          handle: d.handle || null, content: text,
          encoding: d.encoding, bom: d.bom, eol: d.eol,
          lang: d.langId, dirty: d.dirty, previewOn: !!d.previewOn,
          welcome: !!d.welcome, active: d.id === Ed.activeId, savedAt: Date.now()
        };
      }).filter(Boolean);
      Files.putDocs(snaps);
    } catch (e) { /* 配额超限等，忽略 */ }
  }

  /* =========================================================
     PWA
     ========================================================= */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', function () {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            UI.snack('有新版本可用', {
              action: '立即更新',
              duration: 8000,
              onAction: function () { sw.postMessage({ type: 'SKIP_WAITING' }); location.reload(); }
            });
          }
        });
      });
      // 新 SW 接管后会自动发 SW_UPDATED 消息（sw.js activate 阶段）——
      // 对当前会话首次收到、且其版本号与上次不同的，做一次强制 reload。
      // 这是兜底：万一 updatefound/snackbar 流程没走到（比如 PWA 已开很久没人关闭），
      // 仍能保证下一次 SW 升级后所有 client 自动加载新 CSS/JS。
      var SW_RELOADED_FLAG = 'webeditor_sw_reloaded_v';
      if (navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener('message', function (e) {
          var d = e && e.data;
          if (!d || d.type !== 'SW_UPDATED') return;
          try {
            var v = d.version || 'unknown';
            var flag = SW_RELOADED_FLAG + v;
            if (global.sessionStorage && sessionStorage.getItem(flag)) return;
            // 已打开文件（含 PWA 拉起的文件）或正在打开文件时，强制刷新会把这些内容冲掉，
            // 改为提示用户手动刷新——这正是「概率装好 PWA 后双击文件却进了空页面」的根因：
            // 新版本上线后的首次文件拉起会触发 SW 升级，旧逻辑随即 location.reload()，
            // 而 launchQueue 只在本次启动投递一次，重载后文件就再也打不开了。
            var busy = state.launchBusy || state.pendingLaunch.length > 0 || (Ed.docs && Ed.docs.length > 0);
            if (busy) {
              UI.snack('有新版本可用，刷新以应用更新', {
                action: '立即刷新', duration: 8000,
                onAction: function () { location.reload(); }
              });
              return;
            }
            if (global.sessionStorage) sessionStorage.setItem(flag, '1');
            location.reload();
          } catch (err) { /* noop */ }
        });
      }
    }).catch(function (err) { console.warn('SW 注册失败', err); });
  }

  function setupInstallPrompt() {
    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installPrompt = e;
      var item = $('#mainMenu [data-act="install"]');
      if (item) item.hidden = false;
    });
    global.addEventListener('appinstalled', function () {
      state.installPrompt = null;
      UI.snack('已安装为应用，之后可直接用它打开文本文件', { type: 'success', duration: 5000 });
    });
  }

  /* Window Controls Overlay：PWA 安装后系统窗口控件（最小化/最大化/关闭）会
     叠在右上角。getTitlebarAreaRect() 返回的是标题栏可用区域（左侧可绘制内容），
     其宽度不是系统控件宽度；真正的右让位宽度 = window.innerWidth - rect.right。 */
  function setupWindowControlsOverlay() {
    if (!('windowControlsOverlay' in navigator)) return;
    var root = document.documentElement;
    var appbar = document.querySelector('.appbar');
    function update() {
      var wco = navigator.windowControlsOverlay;
      if (!wco || !wco.visible) {
        root.classList.remove('wco');
        if (appbar) appbar.classList.remove('wco-tall');
        // 同步把变量归零，让依赖 --wco-right 的元素（.diff-bar::after 等）退回原位
        root.style.setProperty('--wco-right', '0px');
        return;
      }
      root.classList.add('wco');
      // 部分 Chromium 版本会把标题栏高度也加大，可按需微调
      if (appbar && wco.getTitlebarAreaRect) {
        var h = wco.getTitlebarAreaRect().height;
        if (h && h >= 36) appbar.classList.add('wco-tall');
      }
      // 把实时测量到的系统控件宽度写到 CSS 变量，供 .diff-bar::after 等子组件使用。
      // getTitlebarAreaRect() 的 width 是左侧可用区域宽度，系统控件宽度需用
      // window.innerWidth - rect.right 计算；这样 --wco-right 才和 CSS 中的让位公式一致。
      var w = 0;
      try {
        var r = (wco.getTitlebarAreaRect && wco.getTitlebarAreaRect()) || null;
        if (r && typeof r.right === 'number' && typeof r.width === 'number') {
          w = Math.max(0, Math.ceil(window.innerWidth - r.right));
        }
      } catch (e) { /* 忽略 */ }
      if (!isFinite(w) || w < 0) w = 0;
      root.style.setProperty('--wco-right', w + 'px');
    }
    navigator.windowControlsOverlay.addEventListener('geometrychange', update);
    update();
  }

  function doInstall() {
    if (!state.installPrompt) {
      UI.confirm({
        title: '安装为应用',
        message: matchMedia('(display-mode: standalone)').matches
          ? '应用已经以独立窗口方式运行。'
          : '如果浏览器地址栏出现「安装」图标，点击即可安装。\n\n' +
            '安装后可以在系统中把 .txt / .md / .json 等文本文件的默认打开方式设为本应用，' +
            '双击文件会在本应用同一窗口的新标签页打开。\n\n' +
            '提示：文件关联需要通过 HTTPS 或 localhost 访问才能生效。',
        buttons: [{ value: 'ok', label: '知道了', style: 'filled' }]
      });
      return;
    }
    state.installPrompt.prompt();
    state.installPrompt.userChoice.then(function (r) {
      if (r.outcome === 'accepted') state.installPrompt = null;
    });
  }

  /* =========================================================
     工具
     ========================================================= */
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function welcomeText() {
    return [
      '# 欢迎使用 文本编辑器',
      '',
      '一个基于 **Monaco Editor** 的纯前端文本编辑器，界面遵循 Material Design 3。',
      '',
      '## 快速上手',
      '',
      '| 操作 | 快捷键 |',
      '| --- | --- |',
      '| 新建文件 | `Ctrl + N` |',
      '| 打开文件 | `Ctrl + O` |',
      '| 保存（覆写原文件） | `Ctrl + S` |',
      '| 另存为 | `Ctrl + Shift + S` |',
      '| 下载当前文件 | `Ctrl + Shift + D` |',
      '| Markdown 预览 | `Ctrl + Shift + V` |',
      '| 查找 / 替换 | `Ctrl + F` / `Ctrl + H` |',
      '| 命令面板 | `F1` |',
      '| 切换标签页 | `Ctrl + Tab` |',
      '',
      '## 功能特性',
      '',
      '- 支持 `json` `txt` `md` `java` `js` `html` `css` `vbs` `xml` 等数十种文本格式，自动语法高亮',
      '- **按指定编码打开 / 保存**：UTF-8、GBK、GB18030、Big5、Shift_JIS、UTF-16 等 20 余种编码',
      '- **覆写保存到原文件**：基于 File System Access API，`Ctrl + S` 直接写回磁盘',
      '- **另存为 / 直接下载**：不支持文件系统 API 的浏览器自动回退到下载',
      '- Markdown 实时预览，代码块同样高亮，支持滚动同步',
      '- **HTML 实时预览**：`.html` `.htm` `.xhtml` `.vue` 等直接在沙箱 iframe 中渲染（内嵌 CSS 也会生效）',
      '- **文本对比**：菜单「文本对比」（或 `Ctrl+Shift+C`），左右两栏并排比较高亮差异，最右侧滚动条标记差异位置，点击可跳转',
      '- **外部改动监听**：用「打开文件」打开的本地文件若被其它程序修改，会提示重新加载；若你也有未保存的更改，会弹出冲突处理（可先「查看差异」再决定）。可在设置中关闭',
      '- 亮色 / 暗色 / 跟随系统三种主题',
      '- 可安装为 PWA，在系统中关联文本文件，双击会在**同一窗口的新标签页**打开',
      '- 资源走国内镜像 CDN，多源自动切换',
      '',
      '## 代码高亮示例',
      '',
      '```javascript',
      'const editor = monaco.editor.create(container, {',
      '  language: "javascript",',
      '  theme: "material-dark"',
      '});',
      '```',
      '',
      '```python',
      'def greet(name: str) -> str:',
      '    return f"你好，{name}！"',
      '```',
      '',
      '> 提示：把文件直接拖到窗口里也能打开。',
      ''
    ].join('\n');
  }

  /* =========================================================
     出发
     ========================================================= */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = {
    open: doOpen,
    save: doSave,
    saveAs: doSaveAs,
    download: doDownload,
    newDoc: newDoc,
    open: openItems,
    togglePreview: togglePreview,
    settings: openSettings,
    openDiff: openDiff,
    reloadFromDisk: reloadActiveFromDisk,
    startWatch: startWatch
  };
})(window);
