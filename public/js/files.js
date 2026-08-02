/* ============================================================
   files.js — 文件读写
   · File System Access API：打开、覆写保存到原文件、另存为
   · LaunchQueue：PWA 文件关联启动
   · 回退方案：<input type=file> 打开 + Blob 下载
   · IndexedDB 保存文件句柄以支持「最近文件」
   ============================================================ */
(function (global) {
  'use strict';

  var hasFS = typeof global.showOpenFilePicker === 'function' &&
              typeof global.showSaveFilePicker === 'function';

  /* ---------------------------------------------------------
     文件类型过滤器
     --------------------------------------------------------- */
  function pickerTypes() {
    return [
      {
        description: '常用文本文档',
        accept: {
          'text/plain': ['.txt', '.text', '.log', '.md', '.markdown', '.ini', '.cfg', '.conf',
                         '.properties', '.csv', '.tsv', '.env', '.gitignore', '.editorconfig']
        }
      },
      {
        description: '代码与脚本',
        accept: {
          'text/plain': ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.java', '.py', '.rb',
                         '.php', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.swift',
                         '.kt', '.lua', '.pl', '.r', '.sql', '.sh', '.bash', '.bat', '.cmd',
                         '.ps1', '.vbs', '.vbe', '.vb', '.asm']
        }
      },
      {
        description: '标记与数据',
        accept: {
          'text/plain': ['.html', '.htm', '.xhtml', '.css', '.scss', '.less', '.xml', '.xsl',
                         '.svg', '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.plist',
                         '.webmanifest']
        }
      }
    ];
  }

  /* ---------------------------------------------------------
     读取
     --------------------------------------------------------- */
  function readBytes(file) {
    if (file.arrayBuffer) {
      return file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------------------------------------------------------
     权限
     --------------------------------------------------------- */
  function verifyPermission(handle, readWrite) {
    if (!handle || !handle.queryPermission) return Promise.resolve(true);
    var opts = readWrite ? { mode: 'readwrite' } : { mode: 'read' };
    return handle.queryPermission(opts).then(function (p) {
      if (p === 'granted') return true;
      return handle.requestPermission(opts).then(function (p2) { return p2 === 'granted'; });
    }).catch(function () { return false; });
  }

  /* ---------------------------------------------------------
     打开
     --------------------------------------------------------- */
  function openFiles(multiple) {
    if (hasFS) {
      return global.showOpenFilePicker({
        multiple: multiple !== false,
        types: pickerTypes(),
        excludeAcceptAllOption: false
      }).then(function (handles) {
        return Promise.all(handles.map(function (h) {
          return h.getFile().then(function (f) { return { handle: h, file: f }; });
        }));
      }).catch(function (err) {
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return [];
        console.warn('showOpenFilePicker 失败，改用 input 回退', err);
        return openViaInput(multiple);
      });
    }
    return openViaInput(multiple);
  }

  function openViaInput(multiple) {
    return new Promise(function (resolve) {
      var input = document.getElementById('filePicker');
      input.multiple = multiple !== false;
      input.value = '';
      var settled = false;

      function done(files) {
        if (settled) return;
        settled = true;
        input.onchange = null;
        resolve(files);
      }

      input.onchange = function () {
        var list = Array.prototype.slice.call(input.files || []);
        done(list.map(function (f) { return { handle: null, file: f }; }));
      };
      // 用户取消时不会触发 change，用 focus 兜底
      var onFocus = function () {
        setTimeout(function () {
          window.removeEventListener('focus', onFocus);
          if (!settled && (!input.files || !input.files.length)) done([]);
        }, 500);
      };
      window.addEventListener('focus', onFocus);
      input.click();
    });
  }

  function openDirectory() {
    if (typeof global.showDirectoryPicker !== 'function') {
      return Promise.reject(new Error('当前浏览器不支持打开文件夹'));
    }
    return global.showDirectoryPicker({ mode: 'readwrite' }).then(function (dir) {
      var out = [];
      function walk(handle, prefix, depth) {
        if (depth > 3 || out.length >= 60) return Promise.resolve();
        var entries = [];
        var iter = handle.values();
        function next() {
          return iter.next().then(function (r) {
            if (r.done) return;
            entries.push(r.value);
            return next();
          });
        }
        return next().then(function () {
          var chain = Promise.resolve();
          entries.forEach(function (e) {
            chain = chain.then(function () {
              if (out.length >= 60) return;
              if (e.kind === 'file') {
                var ext = global.Langs.extOf(e.name);
                if (!ext || global.Langs.EXT_MAP[ext]) {
                  return e.getFile().then(function (f) {
                    if (f.size <= 8 * 1024 * 1024) out.push({ handle: e, file: f, path: prefix + e.name });
                  }).catch(function () {});
                }
              } else if (e.kind === 'directory' && !/^(node_modules|\.git|dist|build|\.next|target|out)$/i.test(e.name)) {
                return walk(e, prefix + e.name + '/', depth + 1);
              }
            });
          });
          return chain;
        });
      }
      return walk(dir, '', 0).then(function () { return out; });
    });
  }

  /* ---------------------------------------------------------
     保存
     --------------------------------------------------------- */
  function writeToHandle(handle, bytes) {
    return verifyPermission(handle, true).then(function (ok) {
      if (!ok) throw new Error('没有写入权限，请重新授权');
      return handle.createWritable({ keepExistingData: false });
    }).then(function (writable) {
      return writable.write(new Blob([bytes])).then(function () {
        return writable.close();
      }).catch(function (err) {
        try { writable.abort(); } catch (e) {}
        throw err;
      });
    });
  }

  function saveAs(suggestedName, bytes) {
    if (hasFS) {
      return global.showSaveFilePicker({
        suggestedName: suggestedName,
        types: safeSaveTypes(suggestedName)
      }).then(function (handle) {
        return writeToHandle(handle, bytes).then(function () { return handle; });
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return null;
        throw err;
      });
    }
    download(suggestedName, bytes);
    return Promise.resolve(null);
  }

  function download(filename, bytes) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'untitled.txt';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 2000);
  }

  /* 计算 showSaveFilePicker 合法的扩展名（去掉 .* 这类非法值，避免报错） */
  function safeSaveTypes(suggestedName) {
    var e = global.Langs.extOf(suggestedName);
    var ext = (e && /^[a-z0-9]{1,16}$/i.test(e)) ? '.' + e : '.txt';
    return [{ description: '文本文件', accept: { 'text/plain': [ext] } }];
  }

  /* ---------------------------------------------------------
     最近文件（IndexedDB 存句柄）
     --------------------------------------------------------- */
  var DB_NAME = 'text-editor';
  var LEGACY_DB_NAME = 'text-studio';
  var MIGRATE_FLAG = 'text-editor.db-migrated.v1';
  var STORE = 'handles';
  var DOC_STORE = 'docs';
  var dbPromise = null;
  var rawDbPromise = null;

  /* 打开（必要时创建）当前数据库 */
  function openDb() {
    if (rawDbPromise) return rawDbPromise;
    rawDbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) return reject(new Error('无 IndexedDB'));
      var req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(DOC_STORE)) d.createObjectStore(DOC_STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    }).catch(function () { return null; });
    return rawDbPromise;
  }

  /* 旧库迁移：text-studio → text-editor
     把 handles / docs 两个 store 的记录搬到新库，搬完删除旧库。
     用 localStorage 标记只执行一次；任何异常都静默跳过，不阻塞启动。 */
  function migrateLegacyDb() {
    return new Promise(function (resolve) {
      var settled = false;
      function finish() { if (!settled) { settled = true; resolve(); } }
      setTimeout(finish, 3000); // 兜底：迁移卡住也不影响启动

      try {
        if (!global.indexedDB) return finish();
        try {
          if (localStorage.getItem(MIGRATE_FLAG)) return finish();
          localStorage.setItem(MIGRATE_FLAG, '1');
        } catch (e) { /* 存储不可用则每次尝试，put 是幂等的 */ }

        var req = indexedDB.open(LEGACY_DB_NAME); // 不指定版本，避免触发升级
        req.onerror = finish;
        req.onblocked = finish;
        req.onupgradeneeded = function () { /* 旧库不存在，会建出空库，稍后删掉 */ };
        req.onsuccess = function () {
          var old = req.result;
          var names = Array.prototype.slice.call(old.objectStoreNames);
          var stores = [STORE, DOC_STORE].filter(function (s) { return names.indexOf(s) >= 0; });
          if (!stores.length) { old.close(); dropLegacy(); return finish(); }

          var data = {};
          try {
            var tx = old.transaction(stores, 'readonly');
            stores.forEach(function (s) {
              var r = tx.objectStore(s).getAll();
              r.onsuccess = function () { data[s] = r.result || []; };
            });
            tx.onerror = function () { old.close(); finish(); };
            tx.oncomplete = function () {
              old.close();
              var writable = stores.filter(function (s) { return (data[s] || []).length; });
              if (!writable.length) { dropLegacy(); return finish(); }
              openDb().then(function (d) {
                if (!d) return finish();
                try {
                  var wtx = d.transaction(writable, 'readwrite');
                  writable.forEach(function (s) {
                    var os = wtx.objectStore(s);
                    data[s].forEach(function (rec) { try { os.put(rec); } catch (e) {} });
                  });
                  wtx.onerror = finish;
                  wtx.oncomplete = function () { dropLegacy(); finish(); };
                } catch (e) { finish(); }
              });
            };
          } catch (e) { old.close(); finish(); }
        };
      } catch (e) { finish(); }
    });
  }

  function dropLegacy() {
    try { indexedDB.deleteDatabase(LEGACY_DB_NAME); } catch (e) {}
  }

  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = migrateLegacyDb().then(openDb).catch(function () { return null; });
    return dbPromise;
  }

  function rememberHandle(id, handle, meta) {
    if (!handle) return Promise.resolve();
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put({ id: id, handle: handle, meta: meta || {}, ts: Date.now() });
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function listRecent(limit) {
    return db().then(function (d) {
      if (!d) return [];
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(STORE, 'readonly');
          var req = tx.objectStore(STORE).getAll();
          req.onsuccess = function () {
            var arr = (req.result || []).sort(function (a, b) { return b.ts - a.ts; });
            resolve(arr.slice(0, limit || 12));
          };
          req.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    });
  }

  /* ---------------------------------------------------------
     文档快照（IndexedDB 持久化，避免异常关闭丢内容）
     存储内容 + 文件句柄，启动后可恢复未保存内容。
     句柄为 FileSystemFileHandle，可被结构化克隆，可存入 IndexedDB。
     --------------------------------------------------------- */
  function putDoc(snap) {
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(DOC_STORE, 'readwrite');
          tx.objectStore(DOC_STORE).put(snap);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function putDocs(snaps) {
    if (!snaps || !snaps.length) return Promise.resolve();
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(DOC_STORE, 'readwrite');
          snaps.forEach(function (s) { tx.objectStore(DOC_STORE).put(s); });
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function loadDocs() {
    return db().then(function (d) {
      if (!d) return [];
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(DOC_STORE, 'readonly');
          var req = tx.objectStore(DOC_STORE).getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { resolve([]); };
        } catch (e) { resolve([]); }
      });
    });
  }

  function removeDoc(id) {
    if (id == null) return Promise.resolve();
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(DOC_STORE, 'readwrite');
          tx.objectStore(DOC_STORE).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function clearDocs() {
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (resolve) {
        try {
          var tx = d.transaction(DOC_STORE, 'readwrite');
          tx.objectStore(DOC_STORE).clear();
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  /* ---------------------------------------------------------
     LaunchQueue（PWA 文件关联）
     --------------------------------------------------------- */
  function setupLaunchQueue(onFiles) {
    if (!('launchQueue' in global) || !('files' in LaunchParams.prototype)) {
      return false;
    }
    global.launchQueue.setConsumer(function (params) {
      if (!params || !params.files || !params.files.length) return;
      var handles = params.files;
      Promise.all(handles.map(function (h) {
        return h.getFile().then(function (f) { return { handle: h, file: f }; })
          .catch(function () { return null; });
      })).then(function (items) {
        onFiles(items.filter(Boolean), { source: 'launch' });
      });
    });
    return true;
  }

  /* ---------------------------------------------------------
     拖放
     --------------------------------------------------------- */
  function setupDragDrop(target, onFiles) {
    var depth = 0;

    target.addEventListener('dragenter', function (e) {
      if (!hasFilesInEvent(e)) return;
      e.preventDefault();
      depth++;
      document.body.classList.add('dragging');
    });

    target.addEventListener('dragover', function (e) {
      if (!hasFilesInEvent(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    target.addEventListener('dragleave', function (e) {
      if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); }
    });

    target.addEventListener('drop', function (e) {
      if (!hasFilesInEvent(e)) return;
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');

      var items = Array.prototype.slice.call(e.dataTransfer.items || []);
      var tasks = items.filter(function (it) { return it.kind === 'file'; }).map(function (it) {
        if (typeof it.getAsFileSystemHandle === 'function') {
          return it.getAsFileSystemHandle().then(function (h) {
            if (!h || h.kind !== 'file') return null;
            return h.getFile().then(function (f) { return { handle: h, file: f }; });
          }).catch(function () {
            var f = it.getAsFile();
            return f ? { handle: null, file: f } : null;
          });
        }
        var f = it.getAsFile();
        return Promise.resolve(f ? { handle: null, file: f } : null);
      });

      if (!tasks.length) {
        var fl = Array.prototype.slice.call(e.dataTransfer.files || []);
        if (fl.length) onFiles(fl.map(function (f) { return { handle: null, file: f }; }), { source: 'drop' });
        return;
      }
      Promise.all(tasks).then(function (arr) {
        var files = arr.filter(Boolean);
        if (files.length) onFiles(files, { source: 'drop' });
      });
    });

    function hasFilesInEvent(e) {
      var dt = e.dataTransfer;
      if (!dt) return false;
      if (dt.types) {
        for (var i = 0; i < dt.types.length; i++) if (dt.types[i] === 'Files') return true;
      }
      return false;
    }
  }

  global.Files = {
    hasFS: hasFS,
    readBytes: readBytes,
    openFiles: openFiles,
    openDirectory: openDirectory,
    writeToHandle: writeToHandle,
    saveAs: saveAs,
    download: download,
    verifyPermission: verifyPermission,
    rememberHandle: rememberHandle,
    listRecent: listRecent,
    putDoc: putDoc,
    putDocs: putDocs,
    loadDocs: loadDocs,
    removeDoc: removeDoc,
    clearDocs: clearDocs,
    setupLaunchQueue: setupLaunchQueue,
    setupDragDrop: setupDragDrop
  };
})(window);
