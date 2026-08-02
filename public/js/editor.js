/* ============================================================
   editor.js — Monaco 封装：文档模型、标签管理、主题
   ============================================================ */
(function (global) {
  'use strict';

  var editor = null;
  var docs = [];
  var activeId = null;
  var seq = 0;
  var listeners = { change: [], switch: [], cursor: [], list: [] };

  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error(e); } });
  }
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }

  /* ---------------------------------------------------------
     Material 风格主题
     --------------------------------------------------------- */
  function defineThemes() {
    var monaco = global.monaco;

    monaco.editor.defineTheme('material-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '1D1B20' },
        { token: 'comment', foreground: '6E7781', fontStyle: 'italic' },
        { token: 'keyword', foreground: '6750A4', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: '7D5260', fontStyle: 'bold' },
        { token: 'string', foreground: '0A7B5F' },
        { token: 'string.escape', foreground: 'B3261E' },
        { token: 'number', foreground: 'AA5A00' },
        { token: 'regexp', foreground: '0A7B5F' },
        { token: 'type', foreground: '1565C0' },
        { token: 'type.identifier', foreground: '1565C0' },
        { token: 'class', foreground: '1565C0' },
        { token: 'function', foreground: '6F42C1' },
        { token: 'variable', foreground: '1D1B20' },
        { token: 'variable.predefined', foreground: 'AA5A00' },
        { token: 'constant', foreground: 'AA5A00' },
        { token: 'operator', foreground: '49454F' },
        { token: 'delimiter', foreground: '49454F' },
        { token: 'tag', foreground: 'B3261E' },
        { token: 'attribute.name', foreground: '6F42C1' },
        { token: 'attribute.value', foreground: '0A7B5F' },
        { token: 'metatag', foreground: '7D5260' },
        { token: 'key', foreground: '1565C0' },
        { token: 'value', foreground: '0A7B5F' },
        { token: 'string.key.json', foreground: '1565C0' },
        { token: 'string.value.json', foreground: '0A7B5F' },
        { token: 'annotation', foreground: '7D5260' },
        { token: 'namespace', foreground: '7D5260' }
      ],
      colors: {
        'editor.background': '#FEF7FF',
        'editor.foreground': '#1D1B20',
        'editorLineNumber.foreground': '#AEA9B4',
        'editorLineNumber.activeForeground': '#6750A4',
        'editor.selectionBackground': '#D5C7F5',
        'editor.inactiveSelectionBackground': '#E8DEF8AA',
        'editor.lineHighlightBackground': '#F3EDF7',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#6750A4',
        'editorIndentGuide.background1': '#E6E0E9',
        'editorIndentGuide.activeBackground1': '#CAC4D0',
        'editorWhitespace.foreground': '#D6D0DC',
        'editorWidget.background': '#F3EDF7',
        'editorWidget.border': '#CAC4D0',
        'editorSuggestWidget.background': '#F7F2FA',
        'editorSuggestWidget.selectedBackground': '#E8DEF8',
        'editorHoverWidget.background': '#F7F2FA',
        'editorGutter.background': '#FEF7FF',
        'editorBracketMatch.background': '#EADDFF',
        'editorBracketMatch.border': '#6750A4',
        'scrollbarSlider.background': '#CAC4D066',
        'scrollbarSlider.hoverBackground': '#CAC4D0AA',
        'scrollbarSlider.activeBackground': '#79747E99',
        'minimap.background': '#FEF7FF',
        'editorOverviewRuler.border': '#00000000',
        'editorStickyScroll.background': '#F3EDF7',
        'editor.findMatchBackground': '#FFD8E4',
        'editor.findMatchHighlightBackground': '#FFD8E480'
      }
    });

    monaco.editor.defineTheme('material-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'E6E0E9' },
        { token: 'comment', foreground: '8B8794', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'D0BCFF', fontStyle: 'bold' },
        { token: 'keyword.control', foreground: 'EFB8C8', fontStyle: 'bold' },
        { token: 'string', foreground: '7BD389' },
        { token: 'string.escape', foreground: 'F2B8B5' },
        { token: 'number', foreground: 'E9C46A' },
        { token: 'regexp', foreground: '7BD389' },
        { token: 'type', foreground: '82B1FF' },
        { token: 'type.identifier', foreground: '82B1FF' },
        { token: 'class', foreground: '82B1FF' },
        { token: 'function', foreground: 'C3A6FF' },
        { token: 'variable', foreground: 'E6E0E9' },
        { token: 'variable.predefined', foreground: 'E9C46A' },
        { token: 'constant', foreground: 'E9C46A' },
        { token: 'operator', foreground: 'CAC4D0' },
        { token: 'delimiter', foreground: 'CAC4D0' },
        { token: 'tag', foreground: 'F2B8B5' },
        { token: 'attribute.name', foreground: 'C3A6FF' },
        { token: 'attribute.value', foreground: '7BD389' },
        { token: 'metatag', foreground: 'EFB8C8' },
        { token: 'key', foreground: '82B1FF' },
        { token: 'value', foreground: '7BD389' },
        { token: 'string.key.json', foreground: '82B1FF' },
        { token: 'string.value.json', foreground: '7BD389' },
        { token: 'annotation', foreground: 'EFB8C8' },
        { token: 'namespace', foreground: 'EFB8C8' }
      ],
      colors: {
        'editor.background': '#141218',
        'editor.foreground': '#E6E0E9',
        'editorLineNumber.foreground': '#5E5A66',
        'editorLineNumber.activeForeground': '#D0BCFF',
        'editor.selectionBackground': '#4F378B99',
        'editor.inactiveSelectionBackground': '#4A445866',
        'editor.lineHighlightBackground': '#1D1B20',
        'editor.lineHighlightBorder': '#00000000',
        'editorCursor.foreground': '#D0BCFF',
        'editorIndentGuide.background1': '#2B2930',
        'editorIndentGuide.activeBackground1': '#49454F',
        'editorWhitespace.foreground': '#36343B',
        'editorWidget.background': '#211F26',
        'editorWidget.border': '#49454F',
        'editorSuggestWidget.background': '#1D1B20',
        'editorSuggestWidget.selectedBackground': '#4A4458',
        'editorHoverWidget.background': '#211F26',
        'editorGutter.background': '#141218',
        'editorBracketMatch.background': '#4F378B',
        'editorBracketMatch.border': '#D0BCFF',
        'scrollbarSlider.background': '#49454F66',
        'scrollbarSlider.hoverBackground': '#49454FAA',
        'scrollbarSlider.activeBackground': '#938F9999',
        'minimap.background': '#141218',
        'editorOverviewRuler.border': '#00000000',
        'editorStickyScroll.background': '#1D1B20',
        'editor.findMatchBackground': '#633B48',
        'editor.findMatchHighlightBackground': '#633B4880'
      }
    });
  }

  /* ---------------------------------------------------------
     初始化
     --------------------------------------------------------- */
  function baseOptions() {
    var c = global.Config.get();
    return {
      automaticLayout: true,
      fontSize: c.fontSize,
      fontFamily: c.fontFamily,
      fontLigatures: true,
      lineHeight: 1.6,
      tabSize: c.tabSize,
      insertSpaces: c.insertSpaces,
      detectIndentation: true,
      wordWrap: c.wordWrap ? 'on' : 'off',
      minimap: { enabled: c.minimap, renderCharacters: false, maxColumn: 90 },
      lineNumbers: c.lineNumbers ? 'on' : 'off',
      renderLineHighlight: c.highlightLine ? 'line' : 'none',
      renderWhitespace: c.renderWhitespace ? 'all' : 'selection',
      stickyScroll: { enabled: c.stickyScroll },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      roundedSelection: true,
      scrollBeyondLastLine: true,
      padding: { top: 12, bottom: 40 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true },
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12, useShadows: false },
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'mouseover',
      links: true,
      mouseWheelZoom: true,
      multiCursorModifier: 'ctrlCmd',
      suggestOnTriggerCharacters: true,
      quickSuggestions: { other: true, comments: false, strings: false },
      formatOnPaste: false,
      autoClosingBrackets: 'languageDefined',
      autoIndent: 'full',
      dragAndDrop: true,
      contextmenu: true,
      accessibilitySupport: 'auto',
      fixedOverflowWidgets: true
    };
  }

  function init(container) {
    defineThemes();
    editor = global.monaco.editor.create(container, Object.assign(baseOptions(), {
      theme: currentMonacoTheme(),
      model: null
    }));

    editor.onDidChangeCursorPosition(function () { emit('cursor', cursorInfo()); });
    editor.onDidChangeCursorSelection(function () { emit('cursor', cursorInfo()); });

    return editor;
  }

  function currentMonacoTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'material-dark' : 'material-light';
  }

  function applyTheme() {
    if (global.monaco && global.monaco.editor) {
      global.monaco.editor.setTheme(currentMonacoTheme());
    }
  }

  function applySettings() {
    if (!editor) return;
    var c = global.Config.get();
    editor.updateOptions({
      fontSize: c.fontSize,
      fontFamily: c.fontFamily,
      tabSize: c.tabSize,
      insertSpaces: c.insertSpaces,
      wordWrap: c.wordWrap ? 'on' : 'off',
      minimap: { enabled: c.minimap, renderCharacters: false, maxColumn: 90 },
      lineNumbers: c.lineNumbers ? 'on' : 'off',
      renderLineHighlight: c.highlightLine ? 'line' : 'none',
      renderWhitespace: c.renderWhitespace ? 'all' : 'selection',
      stickyScroll: { enabled: c.stickyScroll }
    });
    docs.forEach(function (d) {
      if (d.model) d.model.updateOptions({ tabSize: c.tabSize, insertSpaces: c.insertSpaces });
    });
  }

  /* ---------------------------------------------------------
     文档
     --------------------------------------------------------- */
  function uniqueUntitled() {
    var n = 1;
    var used = docs.map(function (d) { return d.name; });
    while (used.indexOf('未命名-' + n + '.txt') >= 0) n++;
    return '未命名-' + n + '.txt';
  }

  function createDoc(opts) {
    opts = opts || {};
    var cfg = global.Config.get();
    var name = opts.name || uniqueUntitled();
    var content = opts.content !== undefined ? opts.content : '';
    var langId = opts.language || global.Langs.detectLanguage(name, content);
    var eol = opts.eol || global.Encoding.detectEol(content) || cfg.defaultEol;

    var uri = global.monaco.Uri.parse('inmemory://doc/' + (++seq) + '/' + encodeURIComponent(name));
    var model = global.monaco.editor.createModel(content, langId, uri);
    model.setEOL(eol === 'CRLF' ? global.monaco.editor.EndOfLineSequence.CRLF
                                : global.monaco.editor.EndOfLineSequence.LF);
    model.updateOptions({ tabSize: cfg.tabSize, insertSpaces: cfg.insertSpaces });

    var doc = {
      id: 'doc' + seq,
      name: name,
      path: opts.path || null,
      handle: opts.handle || null,
      model: model,
      langId: langId,
      encoding: global.Encoding.normalize(opts.encoding || cfg.defaultEncoding),
      bom: !!opts.bom,
      eol: eol,
      dirty: false,
      savedVersion: model.getAlternativeVersionId(),
      viewState: null,
      binary: !!opts.binary,
      size: opts.size || 0,
      detectInfo: opts.detectInfo || null,
      previewOn: false,
      welcome: !!opts.welcome
    };

    model.onDidChangeContent(function () {
      var d = doc.model.getAlternativeVersionId() !== doc.savedVersion;
      if (d !== doc.dirty) { doc.dirty = d; emit('list'); }
      emit('change', doc);
    });

    docs.push(doc);
    emit('list');
    return doc;
  }

  function getDoc(id) {
    for (var i = 0; i < docs.length; i++) if (docs[i].id === id) return docs[i];
    return null;
  }

  function active() { return getDoc(activeId); }

  function activate(id) {
    var doc = getDoc(id);
    if (!doc || !editor) return null;

    var prev = active();
    if (prev && prev !== doc) prev.viewState = editor.saveViewState();

    activeId = id;
    editor.setModel(doc.model);
    if (doc.viewState) editor.restoreViewState(doc.viewState);
    editor.focus();
    emit('switch', doc);
    emit('list');
    return doc;
  }

  function closeDoc(id) {
    var idx = docs.findIndex(function (d) { return d.id === id; });
    if (idx < 0) return;
    var doc = docs[idx];
    emit('close', doc);
    docs.splice(idx, 1);
    try { doc.model.dispose(); } catch (e) {}

    if (activeId === id) {
      activeId = null;
      var next = docs[Math.min(idx, docs.length - 1)];
      if (next) activate(next.id);
      else if (editor) editor.setModel(null);
    }
    emit('list');
    emit('switch', active());
  }

  function markSaved(doc) {
    doc.savedVersion = doc.model.getAlternativeVersionId();
    doc.dirty = false;
    emit('list');
  }

  /* 强制标脏：文件在磁盘上消失时用，避免用户以为已保存而直接关掉 */
  function markDirty(doc) {
    if (!doc) return;
    doc.savedVersion = -1;
    doc.dirty = true;
    emit('list');
  }

  function renameDoc(doc, newName) {
    doc.name = newName;
    var lang = global.Langs.detectLanguage(newName, doc.model.getValue().slice(0, 1000));
    if (lang !== doc.langId) {
      doc.langId = lang;
      global.monaco.editor.setModelLanguage(doc.model, lang);
    }
    emit('list');
    emit('switch', doc);
  }

  function setLanguage(doc, langId) {
    doc.langId = langId;
    global.monaco.editor.setModelLanguage(doc.model, langId);
    emit('switch', doc);
  }

  function setEol(doc, eol) {
    doc.eol = eol;
    doc.model.pushEOL(eol === 'CRLF' ? global.monaco.editor.EndOfLineSequence.CRLF
                                     : global.monaco.editor.EndOfLineSequence.LF);
    emit('switch', doc);
  }

  /* ---------------------------------------------------------
     光标 / 统计
     --------------------------------------------------------- */
  function cursorInfo() {
    if (!editor || !editor.getModel()) return { line: 1, column: 1, selected: 0, selectedLines: 0 };
    var pos = editor.getPosition() || { lineNumber: 1, column: 1 };
    var sels = editor.getSelections() || [];
    var model = editor.getModel();
    var selected = 0, selLines = 0;
    sels.forEach(function (s) {
      var t = model.getValueInRange(s);
      selected += t.length;
      if (t.length) selLines += (s.endLineNumber - s.startLineNumber + 1);
    });
    return { line: pos.lineNumber, column: pos.column, selected: selected, selectedLines: selLines };
  }

  function stats(doc) {
    var text = doc.model.getValue();
    var chars = text.length;
    var charsNoSpace = text.replace(/\s/g, '').length;
    var lines = doc.model.getLineCount();
    var words = (text.match(/[A-Za-z0-9_'-]+|[\u4e00-\u9fa5]|[\u3040-\u30ff]/g) || []).length;
    var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var bytes = new TextEncoder().encode(text).length;
    return { chars: chars, charsNoSpace: charsNoSpace, lines: lines, words: words, cjk: cjk, bytes: bytes };
  }

  /* ---------------------------------------------------------
     文本操作
     --------------------------------------------------------- */
  function transformSelection(fn) {
    if (!editor) return;
    var model = editor.getModel();
    if (!model) return;
    var sels = editor.getSelections() || [];
    var edits = [];
    sels.forEach(function (s) {
      var range = s.isEmpty() ? model.getFullModelRange() : s;
      var text = model.getValueInRange(range);
      edits.push({ range: range, text: fn(text), forceMoveMarkers: true });
    });
    editor.executeEdits('transform', edits);
  }

  function sortLines(desc) {
    if (!editor) return;
    var model = editor.getModel();
    var sel = editor.getSelection();
    var range = (!sel || sel.isEmpty()) ? model.getFullModelRange()
      : new global.monaco.Range(sel.startLineNumber, 1, sel.endLineNumber, model.getLineMaxColumn(sel.endLineNumber));
    var lines = model.getValueInRange(range).split('\n');
    lines.sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
    if (desc) lines.reverse();
    editor.executeEdits('sort', [{ range: range, text: lines.join('\n') }]);
  }

  function trimTrailing() {
    if (!editor) return;
    var action = editor.getAction('editor.action.trimTrailingWhitespace');
    if (action) return action.run();
    var model = editor.getModel();
    var text = model.getValue().replace(/[ \t]+$/gm, '');
    editor.executeEdits('trim', [{ range: model.getFullModelRange(), text: text }]);
  }

  function runAction(id) {
    if (!editor) return Promise.resolve();
    var a = editor.getAction(id);
    if (!a) return Promise.resolve();
    return a.run();
  }

  function trigger(source, id, payload) {
    if (editor) editor.trigger(source || 'app', id, payload);
  }

  /* ---------------------------------------------------------
     获取用于保存的文本
     --------------------------------------------------------- */
  function textForSave(doc) {
    var cfg = global.Config.get();
    var text = doc.model.getValue(
      doc.eol === 'CRLF' ? global.monaco.editor.EndOfLinePreference.CRLF
                         : global.monaco.editor.EndOfLinePreference.LF,
      false
    );
    if (cfg.trimOnSave) {
      text = text.replace(/[ \t]+(\r?\n)/g, '$1').replace(/[ \t]+$/, '');
    }
    if (cfg.finalNewline && text.length && !/\n$/.test(text)) {
      text += (doc.eol === 'CRLF' ? '\r\n' : '\n');
    }
    return text;
  }

  global.Ed = {
    init: init,
    on: on,
    get editor() { return editor; },
    get docs() { return docs; },
    get activeId() { return activeId; },
    active: active,
    createDoc: createDoc,
    getDoc: getDoc,
    activate: activate,
    closeDoc: closeDoc,
    markSaved: markSaved,
    markDirty: markDirty,
    renameDoc: renameDoc,
    setLanguage: setLanguage,
    setEol: setEol,
    applyTheme: applyTheme,
    applySettings: applySettings,
    cursorInfo: cursorInfo,
    stats: stats,
    transformSelection: transformSelection,
    sortLines: sortLines,
    trimTrailing: trimTrailing,
    runAction: runAction,
    trigger: trigger,
    textForSave: textForSave
  };
})(window);
