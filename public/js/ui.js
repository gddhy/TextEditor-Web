/* ============================================================
   ui.js — 通用 UI 组件：Snackbar / 菜单 / 对话框 / 编码选择
   ============================================================ */
(function (global) {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------
     Snackbar
     --------------------------------------------------------- */
  var snackTimer = null;

  function snack(text, opts) {
    opts = opts || {};
    var el = $('#snackbar');
    var txt = $('#snackText');
    var act = $('#snackAction');

    clearTimeout(snackTimer);
    el.className = 'snackbar' + (opts.type ? ' ' + opts.type : '');
    txt.textContent = text;

    if (opts.action && opts.onAction) {
      act.hidden = false;
      act.textContent = opts.action;
      act.onclick = function () { hideSnack(); opts.onAction(); };
    } else {
      act.hidden = true;
      act.onclick = null;
    }

    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('show'); });
    snackTimer = setTimeout(hideSnack, opts.duration || (opts.type === 'error' ? 5200 : 3000));
  }

  function hideSnack() {
    var el = $('#snackbar');
    el.classList.remove('show');
    setTimeout(function () { if (!el.classList.contains('show')) el.hidden = true; }, 240);
  }

  /* ---------------------------------------------------------
     菜单
     --------------------------------------------------------- */
  var openMenu = null;

  function showMenu(menuEl, anchorEl, align) {
    closeMenu();
    menuEl.hidden = false;
    var r = anchorEl.getBoundingClientRect();
    var mw = menuEl.offsetWidth;
    var mh = menuEl.offsetHeight;
    var left = (align === 'left') ? r.left : r.right - mw;
    left = Math.max(8, Math.min(left, innerWidth - mw - 8));
    var top = r.bottom + 6;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
    openMenu = menuEl;
    anchorEl.classList.add('active');
    menuEl._anchor = anchorEl;
    setTimeout(function () {
      document.addEventListener('pointerdown', outsideClose, true);
      document.addEventListener('keydown', escClose, true);
    }, 0);
  }

  function outsideClose(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }
  function escClose(e) {
    if (e.key === 'Escape') { closeMenu(); e.stopPropagation(); }
  }

  function closeMenu() {
    if (!openMenu) return;
    openMenu.hidden = true;
    if (openMenu._anchor) openMenu._anchor.classList.remove('active');
    openMenu = null;
    document.removeEventListener('pointerdown', outsideClose, true);
    document.removeEventListener('keydown', escClose, true);
  }

  function setMenuChecked(menuEl, act, checked) {
    var item = menuEl.querySelector('[data-act="' + act + '"]');
    if (item) item.classList.toggle('checked', !!checked);
  }

  /* ---------------------------------------------------------
     确认对话框
     --------------------------------------------------------- */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var dlg = $('#dlgConfirm');
      $('#confirmTitle').textContent = opts.title || '确认';
      $('#confirmDesc').textContent = opts.message || '';
      var actions = $('#confirmActions');
      actions.innerHTML = '';

      var buttons = opts.buttons || [
        { value: 'cancel', label: '取消', style: 'text' },
        { value: 'ok', label: '确定', style: 'filled' }
      ];
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.className = 'btn ' + (b.style || 'text');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.onclick = function () { dlg.close(); resolve(b.value); };
        actions.appendChild(btn);
      });

      dlg.onclose = function () { resolve(dlg.returnValue || 'cancel'); };
      dlg.returnValue = '';
      dlg.showModal();
      var def = actions.querySelector('.filled') || actions.lastChild;
      if (def) def.focus();
    });
  }

  /* ---------------------------------------------------------
     编码选择对话框
     --------------------------------------------------------- */
  function pickEncoding(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var dlg = $('#dlgEncoding');
      var list = $('#encList');
      var filter = $('#encFilter');
      var bomRow = $('#bomRow');
      var bomChk = $('#encBom');

      $('#dlgEncodingTitle').textContent = opts.title || '选择编码';
      $('#dlgEncodingDesc').textContent = opts.desc || '选择用于读取文件的字符编码。';

      var forWrite = !!opts.forWrite;
      var selected = global.Encoding.normalize(opts.current || 'utf-8');
      var encs = global.Encoding.list.filter(function (e) {
        if (forWrite && e.kind === 'readonly') return false;
        if (!forWrite && e.id === 'utf-8-bom') return false;  // 读取时 BOM 自动识别
        return true;
      });

      bomRow.style.display = forWrite ? '' : 'none';
      bomChk.checked = opts.bom !== undefined ? !!opts.bom : (selected === 'utf-8-bom' || selected.indexOf('utf-16') === 0);

      function paint(q) {
        q = (q || '').toLowerCase().trim();
        list.innerHTML = '';
        var groups = {};
        var order = [];
        encs.forEach(function (e) {
          if (q && e.label.toLowerCase().indexOf(q) < 0 && e.id.indexOf(q) < 0 &&
              (!e.group || e.group.toLowerCase().indexOf(q) < 0)) return;
          if (!groups[e.group]) { groups[e.group] = []; order.push(e.group); }
          groups[e.group].push(e);
        });
        if (!order.length) {
          list.innerHTML = '<div class="chip-group-label">没有匹配的编码</div>';
          return;
        }
        order.forEach(function (g) {
          var lb = document.createElement('div');
          lb.className = 'chip-group-label';
          lb.textContent = g;
          list.appendChild(lb);
          groups[g].forEach(function (e) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip' + (e.id === selected ? ' selected' : '');
            chip.dataset.enc = e.id;
            chip.innerHTML = '<span>' + e.label + '</span>' +
              (e.hint ? '<span class="chip-hint">' + e.hint + '</span>' : '');
            chip.onclick = function () {
              selected = e.id;
              $$('.chip', list).forEach(function (c) { c.classList.toggle('selected', c.dataset.enc === selected); });
              if (forWrite) {
                if (e.id === 'utf-8-bom') bomChk.checked = true;
                else if (e.id.indexOf('utf-16') === 0) bomChk.checked = true;
                else if (e.id === 'utf-8') bomChk.checked = false;
                else bomChk.checked = false;
              }
            };
            chip.ondblclick = function () { finish('ok'); };
            list.appendChild(chip);
          });
        });
      }

      function finish(val) {
        dlg.returnValue = val;
        dlg.close();
      }

      filter.value = '';
      paint('');
      filter.oninput = function () { paint(filter.value); };

      dlg.onclose = function () {
        filter.oninput = null;
        dlg.onclose = null;
        if (dlg.returnValue === 'ok') {
          resolve({ encoding: selected, bom: forWrite ? bomChk.checked : undefined });
        } else {
          resolve(null);
        }
      };

      dlg.returnValue = '';
      dlg.showModal();
      setTimeout(function () { filter.focus(); }, 60);
    });
  }

  /* ---------------------------------------------------------
     分段按钮
     --------------------------------------------------------- */
  function segmented(el, value, onChange) {
    $$('button', el).forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === String(value));
      b.onclick = function () {
        $$('button', el).forEach(function (x) { x.classList.toggle('on', x === b); });
        onChange(b.dataset.v);
      };
    });
  }

  function setSegmented(el, value) {
    $$('button', el).forEach(function (b) { b.classList.toggle('on', b.dataset.v === String(value)); });
  }

  global.UI = {
    $: $, $$: $$,
    snack: snack,
    hideSnack: hideSnack,
    showMenu: showMenu,
    closeMenu: closeMenu,
    setMenuChecked: setMenuChecked,
    confirm: confirm,
    pickEncoding: pickEncoding,
    segmented: segmented,
    setSegmented: setSegmented
  };
})(window);
