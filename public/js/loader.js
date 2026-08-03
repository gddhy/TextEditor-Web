/* ============================================================
   loader.js — 多镜像 CDN 资源加载器
   策略：并发探测取最快可用源 → 失败自动串行降级 → 全部失败上报
   ============================================================ */
(function (global) {
  'use strict';

  var state = {
    monacoBase: null,
    monacoMirrorName: null,
    tried: [],          // { base, name, ok, error }
    markedUrl: null,
    purifyUrl: null,
    workerWarmed: false, // Monaco editor worker 脚本是否已预热进缓存
    workerWarmedBy: null,// 'monaco-getWorker'（新版自解析）| 'legacy-fetch'（旧版固定路径）
    workerUrl: null
  };

  var progressCb = function () {};

  function report(text, detail) {
    try { progressCb(text, detail || ''); } catch (e) {}
  }

  /* ---------- 基础工具 ---------- */

  function loadScript(url, timeout) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        s.remove();
        reject(new Error('超时: ' + url));
      }, timeout || 20000);

      s.src = url;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        if (done) return;
        done = true; clearTimeout(timer); resolve(url);
      };
      s.onerror = function () {
        if (done) return;
        done = true; clearTimeout(timer); s.remove();
        reject(new Error('加载失败: ' + url));
      };
      document.head.appendChild(s);
    });
  }

  /** 并发探测多个 URL，返回最先成功响应的那个 */
  function probeFastest(urls, timeout) {
    if (typeof fetch !== 'function' || location.protocol === 'file:') {
      return Promise.reject(new Error('no-fetch'));
    }
    var controllers = [];
    var settled = false;

    return new Promise(function (resolve, reject) {
      var pending = urls.length;
      if (!pending) return reject(new Error('无候选源'));

      var timer = setTimeout(function () {
        if (!settled) { settled = true; abortAll(); reject(new Error('探测超时')); }
      }, timeout || 8000);

      function abortAll() {
        controllers.forEach(function (c) { try { c.abort(); } catch (e) {} });
      }

      urls.forEach(function (url) {
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        if (ctrl) controllers.push(ctrl);
        fetch(url, {
          method: 'GET',
          mode: 'cors',
          cache: 'force-cache',
          credentials: 'omit',
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (res) {
          if (settled) return;
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var ct = (res.headers.get('content-type') || '').toLowerCase();
          if (ct && ct.indexOf('json') >= 0 && ct.indexOf('javascript') < 0) {
            throw new Error('内容类型异常: ' + ct);
          }
          settled = true;
          clearTimeout(timer);
          // 让最快的那个完成读取以进入 HTTP 缓存，其余中止
          controllers.forEach(function (c) { if (c !== ctrl) { try { c.abort(); } catch (e) {} } });
          // ⚠️ 关键修复：命中后立刻 resolve，绝不再 await res.text()。
          // 某些 CDN 会先返回响应头、再让响应体流停滞，res.text() 会永久挂起，
          // 导致整条启动 Promise 既不 resolve 也不 reject → 永远卡在"正在探测/加载编辑器"首页。
          // loader.js 的真正加载由 loadMonacoFrom→loadScript 完成并缓存，probe 只需确认可达即可。
          resolve(url);
          // 后台尽力读完响应体以预热 HTTP 缓存，但不阻塞主流程、失败静默忽略
          try { res.text().catch(function () {}); } catch (e) {}
        }).catch(function () {
          if (settled) return;
          if (--pending === 0) { settled = true; clearTimeout(timer); reject(new Error('全部探测失败')); }
        });
      });
    });
  }

  /** 串行尝试一组 URL，返回第一个加载成功的 */
  function loadFirst(urls, timeout) {
    var i = 0;
    var errors = [];
    function next() {
      if (i >= urls.length) return Promise.reject(new Error('全部源不可用: ' + errors.join(' | ')));
      var url = urls[i++];
      return loadScript(url, timeout || 12000).catch(function (err) {
        errors.push(err.message);
        return next();
      });
    }
    return next();
  }

  /* ---------- AMD 环境清理（切换镜像时必须） ---------- */
  function cleanupAMD() {
    try {
      delete global.require;
      delete global.define;
      delete global.requirejs;
      delete global.__amdDefineHooks;
    } catch (e) {
      global.require = undefined;
      global.define = undefined;
    }
    // 移除已注入的 monaco 相关 script/style，避免脏状态
    Array.prototype.slice.call(document.querySelectorAll('script[data-monaco-loader]'))
      .forEach(function (n) { n.remove(); });
  }

  /* ---------- Monaco 加载 ---------- */

  function setupMonacoEnvironment(base) {
    var parent = base.replace(/\/vs\/?$/, '/');
    global.MonacoEnvironment = {
      baseUrl: parent,
      getWorkerUrl: function () {
        var code =
          'self.MonacoEnvironment = { baseUrl: ' + JSON.stringify(parent) + ' };\n' +
          'importScripts(' + JSON.stringify(base + '/base/worker/workerMain.js') + ');';
        try {
          return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        } catch (e) {
          return base + '/base/worker/workerMain.js';
        }
      }
    };
  }

  /** 用某一个镜像完整加载 monaco */
  function loadMonacoFrom(mirror, useNls) {
    return new Promise(function (resolve, reject) {
      cleanupAMD();
      var loaderUrl = mirror.base + '/loader.js';

      loadScript(loaderUrl, 15000).then(function () {
        if (typeof global.require !== 'function' || typeof global.require.config !== 'function') {
          return reject(new Error('loader.js 未提供 AMD require'));
        }

        setupMonacoEnvironment(mirror.base);

        var cfg = { paths: { vs: mirror.base } };
        if (useNls) cfg['vs/nls'] = { availableLanguages: { '*': 'zh-cn' } };
        global.require.config(cfg);

        var finished = false;
        var timer = setTimeout(function () {
          if (finished) return;
          finished = true;
          reject(new Error('editor.main 加载超时'));
        }, 30000);

        global.require.onError = function (err) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          reject(new Error('AMD 错误: ' + (err && err.message ? err.message : String(err))));
        };

        global.require(['vs/editor/editor.main'], function () {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          if (!global.monaco || !global.monaco.editor) {
            return reject(new Error('monaco 全局对象缺失'));
          }
          resolve(mirror);
        }, function (err) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          reject(new Error('模块加载失败: ' + (err && err.message ? err.message : String(err))));
        });
      }).catch(reject);
    });
  }

  /**
   * 加载 Monaco：先并发探测最快源，再串行降级
   */
  function loadMonaco(onProgress) {
    if (onProgress) progressCb = onProgress;
    var mirrors = global.Config.orderedMirrors();

    report('正在探测可用镜像源…');

    // 第一步：并发探测（只探 loader.js，取最快）
    var probeUrls = mirrors.slice(0, 6).map(function (m) { return m.base + '/loader.js'; });

    return probeFastest(probeUrls, 7000).then(function (fastUrl) {
      var base = fastUrl.replace(/\/loader\.js$/, '');
      var hit = mirrors.filter(function (m) { return m.base === base; })[0];
      if (hit) {
        // 把探测最快的源排到最前
        var idx = mirrors.indexOf(hit);
        if (idx > 0) mirrors.unshift(mirrors.splice(idx, 1)[0]);
      }
      return mirrors;
    }).catch(function () {
      report('探测未命中，改为逐个尝试…');
      return mirrors;
    }).then(function (list) {
      // 第二步：串行加载，失败自动切换下一个
      var i = 0;
      function attempt() {
        if (i >= list.length) {
          return Promise.reject(new Error('所有镜像源均不可用，请检查网络连接'));
        }
        var m = list[i++];
        report('正在从镜像加载编辑器…', m.name);

        return loadMonacoFrom(m, true)
          .catch(function (err) {
            // 中文语言包可能缺失，同源不带 nls 再试一次
            if (/nls|zh-cn/i.test(err.message)) {
              report('语言包不可用，使用英文界面重试…', m.name);
              return loadMonacoFrom(m, false);
            }
            throw err;
          })
          .then(function (mirror) {
            state.monacoBase = mirror.base;
            state.monacoMirrorName = mirror.name;
            state.tried.push({ base: mirror.base, name: mirror.name, ok: true });
            global.Config.set('preferredMirror', mirror.base);
            report('编辑器加载完成', mirror.name);
            return mirror;
          })
          .catch(function (err) {
            state.tried.push({ base: m.base, name: m.name, ok: false, error: err.message });
            console.warn('[镜像失败]', m.name, err.message);
            report('镜像不可用，切换下一个…', m.name);
            return attempt();
          });
      }
      return attempt();
    });
  }

  /* ---------- Monaco worker 预热 ---------- */

  /**
   * 提前把 Monaco 的 editor worker 脚本拉进 HTTP / Service Worker 缓存。
   *
   * 背景：Monaco 的**差异计算跑在 web worker 里**，而这个 worker 是「首次需要时才创建」的。
   * 用户第一次点开「文本对比」才现场去 CDN 下载几百 KB 的 worker 脚本：CDN 慢就长时间空白，
   * CDN 抽风失败则 worker 起不来、diff 永远算不出来（表现为"概率不出对比结果"）。
   *
   * ⚠️ 路径不能写死：
   *   - 旧版（≤0.52 左右）min 产物是 `<base>/base/worker/workerMain.js`；
   *   - 新版（0.53+）min 产物已改成**扁平 + 内容哈希**，worker 变成 `<base>/workers.<hash>.js`，
   *     旧路径直接 404 —— 写死会让预热每次都白跑一个失败请求。
   * 新版 Monaco 会自己往 `MonacoEnvironment` 上装一个知道正确哈希名的 `getWorker`，
   * 所以这种情况交给 Monaco 自己解析：借它创建一个一次性 worker 把脚本拉进缓存后立刻终止，
   * 既不用猜文件名，也天然跟随版本升级。
   */
  function prewarmWorker() {
    if (state.workerWarmed) return Promise.resolve(true);
    if (location.protocol === 'file:') return Promise.resolve(false);

    var env = global.MonacoEnvironment;

    // 新版路径：让 Monaco 自己解析 worker 地址
    if (env && typeof env.getWorker === 'function' && typeof global.Worker === 'function') {
      return new Promise(function (resolve) {
        var w = null, done = false;
        var finish = function (ok) {
          if (done) return;
          done = true;
          clearTimeout(t);
          if (w) { try { w.terminate(); } catch (e) {} }
          state.workerWarmed = !!ok;
          state.workerWarmedBy = ok ? 'monaco-getWorker' : null;
          resolve(!!ok);
        };
        var t = setTimeout(function () { finish(false); }, 20000);
        try {
          w = env.getWorker('prewarm', 'TextEditorWorker');
          if (!w) return finish(false);
          // worker 一有响应就说明脚本已下载并执行，缓存已就绪
          w.addEventListener('message', function () { finish(true); });
          w.addEventListener('error', function () { finish(false); });
        } catch (e) { finish(false); }
      });
    }

    // 旧版路径：按老布局直接预取
    if (!state.monacoBase || typeof fetch !== 'function') return Promise.resolve(false);
    var url = state.monacoBase + '/base/worker/workerMain.js';
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    // 预热是尽力而为，20s 还没拉完就放弃，别一直占着连接
    var timer = setTimeout(function () { if (ctrl) { try { ctrl.abort(); } catch (e) {} } }, 20000);

    return fetch(url, {
      mode: 'cors',
      cache: 'force-cache',
      credentials: 'omit',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
      // 必须读完响应体才会真正落进 HTTP 缓存
      return res.text();
    }).then(function () {
      clearTimeout(timer);
      state.workerWarmed = true;
      state.workerWarmedBy = 'legacy-fetch';
      state.workerUrl = url;
      return true;
    }).catch(function () {
      clearTimeout(timer);
      return false;
    });
  }

  /* ---------- 可选增强库 ---------- */

  function loadMarked() {
    if (global.marked) return Promise.resolve(true);
    return loadFirst(global.Config.MARKED_MIRRORS, 8000).then(function (url) {
      state.markedUrl = url;
      return true;
    }).catch(function () { return false; });
  }

  function loadDOMPurify() {
    if (global.DOMPurify) return Promise.resolve(true);
    return loadFirst(global.Config.DOMPURIFY_MIRRORS, 8000).then(function (url) {
      state.purifyUrl = url;
      return true;
    }).catch(function () { return false; });
  }

  global.Loader = {
    state: state,
    loadScript: loadScript,
    loadFirst: loadFirst,
    loadMonaco: loadMonaco,
    prewarmWorker: prewarmWorker,
    loadMarked: loadMarked,
    loadDOMPurify: loadDOMPurify,
    onProgress: function (fn) { progressCb = fn; }
  };
})(window);
