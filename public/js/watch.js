/* ============================================================
   watch.js — 本地文件外部变动监听

   浏览器没有通用的「文件变动事件」，能做到的只有两条路：
     1) FileSystemObserver —— Chrome 129 起的实验特性（非标准、需 origin trial
        或开启 flag），可用时能即时收到通知；
     2) 轮询 handle.getFile() 比对 lastModified / size —— 通用可靠的兜底方案。

   本模块两者结合：能用 Observer 就用它「催一下」，实际判定一律以 getFile()
   的真实结果为准。只有通过 File System Access API / LaunchQueue 打开、拿得到
   FileSystemFileHandle 的文档才能被监听；<input type=file> 回退打开的文件只有
   一份 File 快照，无法感知后续变动。
   ============================================================ */
(function (global) {
  'use strict';

  var hasObserver = typeof global.FileSystemObserver === 'function';
  var supported = typeof global.FileSystemFileHandle === 'function';

  var MIN_INTERVAL = 1000;
  var QUIET_AFTER_PROMPT = 3000;   // 提示过后的静默期，避免连续改动刷屏
  var MISS_CONFIRM = 2;            // 连续 N 次读不到才判定文件消失（防原子保存误报）

  var timer = null;
  var observer = null;
  var running = false;
  var ticking = false;
  var interval = 3000;

  var docsProvider = null;
  var handlers = { onChanged: null, onMissing: null };

  /* ---------------------------------------------------------
     签名
     --------------------------------------------------------- */
  function sigOf(file) {
    return { mtime: file.lastModified, size: file.size };
  }

  function sameSig(a, b) {
    return !!a && !!b && a.mtime === b.mtime && a.size === b.size;
  }

  /* ---------------------------------------------------------
     读取磁盘状态
     · 权限只查不要（requestPermission 需要用户手势，后台轮询里弹不出来）
     · 未授权返回 null，静默跳过
     --------------------------------------------------------- */
  function stat(doc) {
    if (!doc || !doc.handle) return Promise.resolve(null);
    var h = doc.handle;
    var permP = (typeof h.queryPermission === 'function')
      ? h.queryPermission({ mode: 'read' }).catch(function () { return 'granted'; })
      : Promise.resolve('granted');   // OPFS 等句柄没有权限模型
    return permP.then(function (p) {
      if (p !== 'granted') return null;
      return h.getFile();
    });
  }

  /* ---------------------------------------------------------
     记录基线
     打开 / 保存 / 重新加载之后调用，避免把自己的写入当成外部改动
     --------------------------------------------------------- */
  function baseline(doc, file) {
    if (!doc) return Promise.resolve(null);
    if (!doc.handle) { doc.fsSig = null; return Promise.resolve(null); }

    function apply(f) {
      if (!f) return null;
      doc.fsSig = sigOf(f);
      doc.fsMissCount = 0;
      doc.fsQuietUntil = 0;
      observe(doc);
      return doc.fsSig;
    }

    if (file) return Promise.resolve(apply(file));
    return stat(doc).then(apply).catch(function () { return null; });
  }

  /* ---------------------------------------------------------
     单个文档检查
     --------------------------------------------------------- */
  function checkDoc(doc) {
    if (!doc || !doc.handle) return Promise.resolve(null);
    if (doc.fsBusy || doc.fsPrompting) return Promise.resolve(null);
    if (doc.fsQuietUntil && Date.now() < doc.fsQuietUntil) return Promise.resolve(null);

    doc.fsBusy = true;
    return stat(doc).then(function (file) {
      doc.fsBusy = false;
      if (!file) return null;                 // 无权限或已无句柄
      doc.fsMissCount = 0;

      var now = sigOf(file);
      if (!doc.fsSig) { doc.fsSig = now; return null; }   // 首次拿到，仅登记
      if (sameSig(doc.fsSig, now)) return null;

      return notify('onChanged', doc, file, now);
    }).catch(function (err) {
      doc.fsBusy = false;
      var name = err && err.name;
      if (name !== 'NotFoundError' && name !== 'NotReadableError') return null;

      // 很多编辑器保存时会「写临时文件 → 删原文件 → 改名」，
      // 中间会有一瞬间读不到，连续确认两次再报。
      doc.fsMissCount = (doc.fsMissCount || 0) + 1;
      if (doc.fsMissCount < MISS_CONFIRM) return null;

      return notify('onMissing', doc, null, null);
    });
  }

  /* 调用外部处理器；期间挂起该文档的检查，结束后吞掉这次变动并进入静默期 */
  function notify(kind, doc, file, sig) {
    var fn = handlers[kind];
    if (!fn) return null;
    doc.fsPrompting = true;
    var p;
    try { p = fn(doc, file); } catch (e) { p = null; }
    return Promise.resolve(p).catch(function () {}).then(function () {
      doc.fsPrompting = false;
      doc.fsQuietUntil = Date.now() + QUIET_AFTER_PROMPT;
      // 处理器若没自己更新基线（例如用户选了「忽略」），这里接受当前状态，
      // 保证同一次改动只提示一次。
      if (sig && doc.fsSig && !sameSig(doc.fsSig, sig)) doc.fsSig = sig;
    });
  }

  /* ---------------------------------------------------------
     轮询
     --------------------------------------------------------- */
  function listDocs() {
    var arr = docsProvider ? docsProvider() : null;
    if (!arr || !arr.length) return [];
    return arr.filter(function (d) { return d && d.handle; });
  }

  function tick() {
    if (!running || ticking) return Promise.resolve();
    if (global.document && global.document.hidden) return Promise.resolve();  // 后台不轮询

    var list = listDocs();
    if (!list.length) return Promise.resolve();

    ticking = true;
    var chain = Promise.resolve();
    list.forEach(function (d) {
      chain = chain.then(function () { return checkDoc(d); });
    });
    return chain.then(function () { ticking = false; }, function () { ticking = false; });
  }

  /* ---------------------------------------------------------
     FileSystemObserver（可用时用作「即时催促」）
     --------------------------------------------------------- */
  function ensureObserver() {
    if (!hasObserver || observer) return observer;
    try {
      observer = new global.FileSystemObserver(function () {
        if (running) tick();
      });
    } catch (e) { observer = null; hasObserver = false; }
    return observer;
  }

  function observe(doc) {
    if (!hasObserver || !doc || !doc.handle || doc.fsObserved) return;
    var ob = ensureObserver();
    if (!ob) return;
    try {
      var r = ob.observe(doc.handle);
      if (r && r.then) r.then(function () { doc.fsObserved = true; }, function () {});
      else doc.fsObserved = true;
    } catch (e) { /* 观察失败不影响轮询 */ }
  }

  /* ---------------------------------------------------------
     生命周期
     --------------------------------------------------------- */
  function start(opts) {
    opts = opts || {};
    if (opts.docs) docsProvider = opts.docs;
    if (opts.onChanged) handlers.onChanged = opts.onChanged;
    if (opts.onMissing) handlers.onMissing = opts.onMissing;
    if (opts.interval) interval = Math.max(MIN_INTERVAL, opts.interval);

    clearInterval(timer);
    running = true;
    timer = setInterval(tick, interval);
    listDocs().forEach(observe);
    setTimeout(tick, 400);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = null;
    if (observer) {
      try { observer.disconnect(); } catch (e) {}
      observer = null;
      listDocs().forEach(function (d) { d.fsObserved = false; });
    }
  }

  function forget(doc) {
    if (!doc) return;
    doc.fsSig = null;
    doc.fsMissCount = 0;
    doc.fsQuietUntil = 0;
    doc.fsPrompting = false;
    doc.fsObserved = false;
  }

  /* 切回前台 / 窗口获得焦点时立刻复查一次 —— 这是最常见的场景：
     用户切到别的程序改了文件，再切回来。 */
  var wakeTimer = null;
  function wake() {
    if (!running) return;
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(tick, 150);
  }
  if (global.document) {
    global.document.addEventListener('visibilitychange', function () {
      if (!global.document.hidden) wake();
    });
  }
  global.addEventListener('focus', wake);

  global.Watch = {
    supported: supported,
    hasObserver: hasObserver,
    start: start,
    stop: stop,
    isRunning: function () { return running; },
    baseline: baseline,
    forget: forget,
    stat: stat,
    check: checkDoc,
    checkAll: tick
  };
})(window);
