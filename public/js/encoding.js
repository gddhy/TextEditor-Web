/* ============================================================
   encoding.js — 字符编码检测 / 解码 / 编码
   浏览器原生 TextEncoder 仅支持 UTF-8，这里通过反查 TextDecoder
   动态构建「字符 → 字节」映射表，从而支持以 GBK / Big5 / Shift_JIS
   等编码保存文件。
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------
     编码清单
     kind: 'utf8' | 'utf16' | 'sbcs'(单字节) | 'dbcs'(双字节) | 'gb18030' | 'readonly'
     --------------------------------------------------------- */
  var ENCODINGS = [
    { id: 'utf-8',         label: 'UTF-8',            group: 'Unicode', kind: 'utf8',    hint: '通用' },
    { id: 'utf-8-bom',     label: 'UTF-8 BOM',        group: 'Unicode', kind: 'utf8',    hint: '带签名', bom: true, base: 'utf-8' },
    { id: 'utf-16le',      label: 'UTF-16 LE',        group: 'Unicode', kind: 'utf16',   hint: '小端' },
    { id: 'utf-16be',      label: 'UTF-16 BE',        group: 'Unicode', kind: 'utf16',   hint: '大端' },

    { id: 'gbk',           label: 'GBK',              group: '中文',    kind: 'dbcs',    hint: '简体' },
    { id: 'gb18030',       label: 'GB18030',          group: '中文',    kind: 'gb18030', hint: '国标' },
    { id: 'big5',          label: 'Big5',             group: '中文',    kind: 'dbcs',    hint: '繁体' },

    { id: 'shift_jis',     label: 'Shift_JIS',        group: '日文',    kind: 'dbcs' },
    { id: 'euc-jp',        label: 'EUC-JP',           group: '日文',    kind: 'dbcs' },
    { id: 'iso-2022-jp',   label: 'ISO-2022-JP',      group: '日文',    kind: 'readonly', hint: '仅读取' },

    { id: 'euc-kr',        label: 'EUC-KR',           group: '韩文',    kind: 'dbcs' },

    { id: 'windows-1252',  label: 'Windows-1252',     group: '西欧',    kind: 'sbcs' },
    { id: 'iso-8859-1',    label: 'ISO-8859-1',       group: '西欧',    kind: 'sbcs',    hint: 'Latin-1' },
    { id: 'iso-8859-15',   label: 'ISO-8859-15',      group: '西欧',    kind: 'sbcs' },
    { id: 'macintosh',     label: 'Macintosh',        group: '西欧',    kind: 'sbcs' },

    { id: 'windows-1250',  label: 'Windows-1250',     group: '其他',    kind: 'sbcs',    hint: '中欧' },
    { id: 'windows-1251',  label: 'Windows-1251',     group: '其他',    kind: 'sbcs',    hint: '西里尔' },
    { id: 'windows-1253',  label: 'Windows-1253',     group: '其他',    kind: 'sbcs',    hint: '希腊' },
    { id: 'windows-1254',  label: 'Windows-1254',     group: '其他',    kind: 'sbcs',    hint: '土耳其' },
    { id: 'windows-1256',  label: 'Windows-1256',     group: '其他',    kind: 'sbcs',    hint: '阿拉伯' },
    { id: 'windows-1257',  label: 'Windows-1257',     group: '其他',    kind: 'sbcs',    hint: '波罗的' },
    { id: 'koi8-r',        label: 'KOI8-R',           group: '其他',    kind: 'sbcs',    hint: '俄文' },
    { id: 'iso-8859-2',    label: 'ISO-8859-2',       group: '其他',    kind: 'sbcs' },
    { id: 'iso-8859-5',    label: 'ISO-8859-5',       group: '其他',    kind: 'sbcs' },
    { id: 'iso-8859-7',    label: 'ISO-8859-7',       group: '其他',    kind: 'sbcs' }
  ];

  var byId = {};
  ENCODINGS.forEach(function (e) { byId[e.id] = e; });

  function info(id) { return byId[normalize(id)] || byId['utf-8']; }

  function normalize(id) {
    if (!id) return 'utf-8';
    id = String(id).toLowerCase().trim();
    var alias = {
      'utf8': 'utf-8', 'utf-8bom': 'utf-8-bom', 'utf8bom': 'utf-8-bom',
      'utf16le': 'utf-16le', 'utf16be': 'utf-16be', 'unicode': 'utf-16le',
      'gb2312': 'gbk', 'gb_2312': 'gbk', 'cp936': 'gbk', 'ms936': 'gbk', 'chinese': 'gbk',
      'big5-hkscs': 'big5', 'cp950': 'big5',
      'sjis': 'shift_jis', 'ms_kanji': 'shift_jis', 'cp932': 'shift_jis',
      'latin1': 'iso-8859-1', 'ascii': 'utf-8', 'us-ascii': 'utf-8',
      'cp1252': 'windows-1252', 'ansi': 'windows-1252'
    };
    return alias[id] || id;
  }

  /** 用于 TextDecoder 的真实 label */
  function decoderLabel(id) {
    var e = info(id);
    return e.base || e.id;
  }

  /* ---------------------------------------------------------
     BOM
     --------------------------------------------------------- */
  var BOMS = [
    { enc: 'utf-8-bom', bytes: [0xEF, 0xBB, 0xBF] },
    { enc: 'utf-16le',  bytes: [0xFF, 0xFE], not: [0xFF, 0xFE, 0x00, 0x00] },
    { enc: 'utf-16be',  bytes: [0xFE, 0xFF] },
    { enc: 'gb18030',   bytes: [0x84, 0x31, 0x95, 0x33] }
  ];

  function detectBOM(bytes) {
    for (var i = 0; i < BOMS.length; i++) {
      var b = BOMS[i], ok = true;
      if (bytes.length < b.bytes.length) continue;
      for (var j = 0; j < b.bytes.length; j++) {
        if (bytes[j] !== b.bytes[j]) { ok = false; break; }
      }
      if (!ok) continue;
      if (b.not && bytes.length >= b.not.length) {
        var isNot = true;
        for (var k = 0; k < b.not.length; k++) if (bytes[k] !== b.not[k]) { isNot = false; break; }
        if (isNot) continue;
      }
      return { encoding: b.enc, length: b.bytes.length };
    }
    return null;
  }

  function bomBytes(encId) {
    var id = normalize(encId);
    if (id === 'utf-8-bom') return [0xEF, 0xBB, 0xBF];
    if (id === 'utf-16le') return [0xFF, 0xFE];
    if (id === 'utf-16be') return [0xFE, 0xFF];
    return [];
  }

  /* ---------------------------------------------------------
     自动检测
     --------------------------------------------------------- */
  function isBinary(bytes) {
    var n = Math.min(bytes.length, 8000), nul = 0, ctrl = 0;
    for (var i = 0; i < n; i++) {
      var b = bytes[i];
      if (b === 0) nul++;
      else if (b < 9 || (b > 13 && b < 32)) ctrl++;
    }
    if (n === 0) return false;
    // UTF-16 文本会有大量 NUL，需先排除
    if (nul / n > 0.3) return false;
    return nul > 0 || ctrl / n > 0.08;
  }

  function tryStrictDecode(bytes, label) {
    try {
      new TextDecoder(label, { fatal: true }).decode(bytes);
      return true;
    } catch (e) { return false; }
  }

  function looksLikeUTF16(bytes) {
    var n = Math.min(bytes.length - (bytes.length % 2), 4096);
    if (n < 8) return null;
    var evenNul = 0, oddNul = 0;
    for (var i = 0; i < n; i += 2) {
      if (bytes[i] === 0) evenNul++;
      if (bytes[i + 1] === 0) oddNul++;
    }
    var pairs = n / 2;
    if (oddNul / pairs > 0.4 && evenNul / pairs < 0.1) return 'utf-16le';
    if (evenNul / pairs > 0.4 && oddNul / pairs < 0.1) return 'utf-16be';
    return null;
  }

  /** 对候选编码解码后的文本打分：CJK / 常用字符占比越高越可信 */
  function scoreText(text) {
    if (!text) return -1;
    var score = 0, n = Math.min(text.length, 4000);
    for (var i = 0; i < n; i++) {
      var c = text.charCodeAt(i);
      if (c === 0xFFFD) { score -= 30; continue; }
      if (c < 0x80) { score += 1; continue; }
      if (c >= 0x4E00 && c <= 0x9FFF) { score += 12; continue; }   // CJK 统一表意
      if (c >= 0x3000 && c <= 0x303F) { score += 8; continue; }    // CJK 标点
      if (c >= 0xFF00 && c <= 0xFFEF) { score += 6; continue; }    // 全角
      if (c >= 0x3040 && c <= 0x30FF) { score += 10; continue; }   // 假名
      if (c >= 0xAC00 && c <= 0xD7AF) { score += 10; continue; }   // 谚文
      if (c >= 0x0400 && c <= 0x04FF) { score += 6; continue; }    // 西里尔
      if (c >= 0x00A0 && c <= 0x024F) { score += 2; continue; }    // 拉丁扩展
      if (c >= 0xE000 && c <= 0xF8FF) { score -= 12; continue; }   // 私用区，通常是误判
      score -= 4;
    }
    return score / Math.max(n, 1);
  }

  /**
   * 检测字节流编码
   * @returns {{encoding:string, confidence:string, hasBOM:boolean, bomLength:number, binary:boolean}}
   */
  function detect(bytes, hintLang) {
    var bom = detectBOM(bytes);
    if (bom) {
      return { encoding: bom.encoding, confidence: 'bom', hasBOM: true, bomLength: bom.length, binary: false };
    }
    if (bytes.length === 0) {
      return { encoding: 'utf-8', confidence: 'empty', hasBOM: false, bomLength: 0, binary: false };
    }

    var u16 = looksLikeUTF16(bytes);
    if (u16) return { encoding: u16, confidence: 'high', hasBOM: false, bomLength: 0, binary: false };

    var binary = isBinary(bytes);

    // 纯 ASCII
    var ascii = true;
    var lim = Math.min(bytes.length, 65536);
    for (var i = 0; i < lim; i++) { if (bytes[i] > 0x7F) { ascii = false; break; } }
    if (ascii && lim === bytes.length) {
      return { encoding: 'utf-8', confidence: 'high', hasBOM: false, bomLength: 0, binary: binary };
    }

    var sample = bytes.length > 262144 ? bytes.subarray(0, 262144) : bytes;

    // UTF-8 严格校验（尾部可能被截断，稍作宽容）
    if (tryStrictDecode(sample.subarray(0, Math.max(0, sample.length - 4)), 'utf-8')) {
      return { encoding: 'utf-8', confidence: 'high', hasBOM: false, bomLength: 0, binary: binary };
    }

    // 多编码打分
    var lang = (hintLang || navigator.language || 'zh-CN').toLowerCase();
    var candidates = ['gbk', 'big5', 'shift_jis', 'euc-kr', 'euc-jp', 'windows-1252'];
    if (lang.indexOf('ja') === 0) candidates = ['shift_jis', 'euc-jp', 'gbk', 'big5', 'euc-kr', 'windows-1252'];
    else if (lang.indexOf('ko') === 0) candidates = ['euc-kr', 'gbk', 'shift_jis', 'big5', 'windows-1252'];
    else if (lang.indexOf('zh-tw') === 0 || lang.indexOf('zh-hk') === 0) candidates = ['big5', 'gbk', 'shift_jis', 'euc-kr', 'windows-1252'];

    var best = null;
    candidates.forEach(function (id) {
      var text;
      try { text = new TextDecoder(decoderLabel(id), { fatal: false }).decode(sample); }
      catch (e) { return; }
      var s = scoreText(text);
      if (!best || s > best.score) best = { encoding: id, score: s };
    });

    return {
      encoding: best ? best.encoding : 'utf-8',
      confidence: best && best.score > 3 ? 'medium' : 'low',
      hasBOM: false, bomLength: 0, binary: binary
    };
  }

  /* ---------------------------------------------------------
     解码
     --------------------------------------------------------- */
  function decode(bytes, encId) {
    var id = normalize(encId);
    var e = info(id);
    var body = bytes;

    // 去掉 BOM
    var bom = detectBOM(bytes);
    if (bom) {
      var same = (bom.encoding === id) ||
                 (bom.encoding === 'utf-8-bom' && id === 'utf-8') ||
                 (id === 'utf-8-bom' && bom.encoding === 'utf-8-bom');
      if (same || bom.encoding === id) body = bytes.subarray(bom.length);
      else if (bom.encoding === 'utf-8-bom' && (id === 'utf-8' || id === 'utf-8-bom')) body = bytes.subarray(3);
    }

    if (id === 'utf-16le' || id === 'utf-16be') {
      return decodeUTF16(body, id === 'utf-16be');
    }
    try {
      return new TextDecoder(decoderLabel(id), { fatal: false }).decode(body);
    } catch (err) {
      return new TextDecoder('utf-8', { fatal: false }).decode(body);
    }
  }

  function decodeUTF16(bytes, bigEndian) {
    var len = bytes.length >> 1;
    var out = [];
    var chunk = [];
    for (var i = 0; i < len; i++) {
      var a = bytes[i * 2], b = bytes[i * 2 + 1];
      chunk.push(bigEndian ? ((a << 8) | b) : ((b << 8) | a));
      if (chunk.length >= 8192) { out.push(String.fromCharCode.apply(null, chunk)); chunk = []; }
    }
    if (chunk.length) out.push(String.fromCharCode.apply(null, chunk));
    return out.join('');
  }

  /* ---------------------------------------------------------
     编码表构建（反查 TextDecoder）
     --------------------------------------------------------- */
  var tableCache = {};       // encId -> Map(char -> [bytes])
  var gb18030Ext = null;     // Map(codePoint -> [4 bytes])

  function buildSingleByteTable(id) {
    var dec = new TextDecoder(decoderLabel(id), { fatal: false });
    var map = new Map();
    var buf = new Uint8Array(1);
    for (var b = 0; b <= 0xFF; b++) {
      buf[0] = b;
      var s = dec.decode(buf);
      if (s.length === 1 && s !== '\uFFFD' && !map.has(s)) map.set(s, [b]);
    }
    for (var a = 0; a < 0x80; a++) {
      var ch = String.fromCharCode(a);
      if (!map.has(ch)) map.set(ch, [a]);
    }
    return map;
  }

  function buildDoubleByteTable(id) {
    var label = decoderLabel(id);
    var dec = new TextDecoder(label, { fatal: false });
    var map = new Map();
    var one = new Uint8Array(1);
    var two = new Uint8Array(2);
    var b, s;

    // ASCII 与单字节区
    for (b = 0; b <= 0xFF; b++) {
      one[0] = b;
      s = dec.decode(one);
      if (s.length === 1 && s !== '\uFFFD' && !map.has(s)) map.set(s, [b]);
    }
    for (var a = 0; a < 0x80; a++) {
      var ch = String.fromCharCode(a);
      if (!map.has(ch)) map.set(ch, [a]);
    }

    // 双字节区
    var loStart = (id === 'shift_jis') ? 0x40 : 0x40;
    for (var hi = 0x81; hi <= 0xFE; hi++) {
      two[0] = hi;
      for (var lo = loStart; lo <= 0xFE; lo++) {
        two[1] = lo;
        s = dec.decode(two);
        if (s.length === 1) {
          var c = s.charCodeAt(0);
          if (c !== 0xFFFD && c >= 0x80 && !map.has(s)) map.set(s, [hi, lo]);
        } else if (s.length === 2 && s.charCodeAt(0) >= 0xD800 && s.charCodeAt(0) <= 0xDBFF) {
          if (!map.has(s)) map.set(s, [hi, lo]);   // 代理对（Big5-HKSCS 等）
        }
      }
    }
    // EUC 系列高位区从 0xA1 起，上面循环已覆盖
    return map;
  }

  /** GB18030 四字节区（BMP 部分）反查表 */
  function buildGB18030Ext() {
    if (gb18030Ext) return gb18030Ext;
    var dec = new TextDecoder('gb18030', { fatal: false });
    var map = new Map();
    var buf = new Uint8Array(4);
    for (var b1 = 0x81; b1 <= 0x84; b1++) {
      buf[0] = b1;
      for (var b2 = 0x30; b2 <= 0x39; b2++) {
        buf[1] = b2;
        for (var b3 = 0x81; b3 <= 0xFE; b3++) {
          buf[2] = b3;
          for (var b4 = 0x30; b4 <= 0x39; b4++) {
            buf[3] = b4;
            var s = dec.decode(buf);
            if (s.length === 1) {
              var c = s.charCodeAt(0);
              if (c !== 0xFFFD && !map.has(c)) map.set(c, [b1, b2, b3, b4]);
            }
          }
        }
      }
    }
    gb18030Ext = map;
    return map;
  }

  function getTable(id) {
    id = normalize(id);
    if (tableCache[id]) return tableCache[id];
    var e = info(id);
    var t0 = performance.now();
    var map;
    if (e.kind === 'sbcs') map = buildSingleByteTable(id);
    else map = buildDoubleByteTable(id);
    tableCache[id] = map;
    console.debug('[encoding] 构建 ' + id + ' 编码表: ' + map.size + ' 项, ' + Math.round(performance.now() - t0) + 'ms');
    return map;
  }

  /* ---------------------------------------------------------
     编码（文本 → 字节）
     --------------------------------------------------------- */
  /**
   * @returns {{bytes:Uint8Array, lost:number, lostChars:string[]}}
   */
  function encode(text, encId, opts) {
    opts = opts || {};
    var id = normalize(encId);
    var e = info(id);
    var withBOM = opts.bom !== undefined ? opts.bom : !!e.bom;
    var head = withBOM ? bomBytes(id === 'utf-8' ? 'utf-8-bom' : id) : (e.bom ? bomBytes(id) : []);
    if (id === 'utf-16le' || id === 'utf-16be') head = opts.bom === false ? [] : bomBytes(id);

    var body, lost = 0, lostChars = [];

    if (e.kind === 'utf8') {
      body = new TextEncoder().encode(text);
    } else if (e.kind === 'utf16') {
      body = encodeUTF16(text, id === 'utf-16be');
    } else if (e.kind === 'readonly') {
      throw new Error(e.label + ' 编码暂不支持保存，请改用其他编码');
    } else {
      var table = getTable(id);
      var ext = (e.kind === 'gb18030') ? null : null;
      var out = new Uint8Array(text.length * 4 + 8);
      var p = 0;
      var seen = Object.create(null);

      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        var code = text.codePointAt(i);
        var isSurrogate = code > 0xFFFF;
        if (isSurrogate) { ch = text.substr(i, 2); i++; }

        var bytes = table.get(ch);

        if (!bytes && e.kind === 'gb18030') {
          if (!gb18030Ext) buildGB18030Ext();
          var eb = gb18030Ext.get(code);
          if (eb) bytes = eb;
        }

        if (!bytes) {
          // 常见等价替换
          var alt = FALLBACK_MAP[ch];
          if (alt) {
            for (var q = 0; q < alt.length; q++) {
              var ab = table.get(alt[q]);
              if (ab) { for (var w = 0; w < ab.length; w++) out[p++] = ab[w]; }
            }
            continue;
          }
          lost++;
          if (!seen[ch] && lostChars.length < 12) { seen[ch] = 1; lostChars.push(ch); }
          out[p++] = 0x3F; // '?'
          continue;
        }
        for (var j = 0; j < bytes.length; j++) out[p++] = bytes[j];
      }
      body = out.subarray(0, p);
    }

    if (!head.length) {
      return { bytes: body instanceof Uint8Array ? body.slice() : new Uint8Array(body), lost: lost, lostChars: lostChars };
    }
    var res = new Uint8Array(head.length + body.length);
    res.set(head, 0);
    res.set(body, head.length);
    return { bytes: res, lost: lost, lostChars: lostChars };
  }

  /** 无法映射时的等价替换（尽量保留可读性） */
  var FALLBACK_MAP = {
    '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
    '\u2013': '-', '\u2014': '--', '\u2026': '...', '\u00A0': ' ',
    '\u200B': '', '\uFEFF': '', '\u2022': '*', '\u2192': '->', '\u2190': '<-'
  };

  function encodeUTF16(text, bigEndian) {
    var units = [];
    for (var i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
    var out = new Uint8Array(units.length * 2);
    for (var j = 0; j < units.length; j++) {
      var u = units[j];
      if (bigEndian) { out[j * 2] = (u >> 8) & 0xFF; out[j * 2 + 1] = u & 0xFF; }
      else { out[j * 2] = u & 0xFF; out[j * 2 + 1] = (u >> 8) & 0xFF; }
    }
    return out;
  }

  /** 判断某编码是否支持写入 */
  function canEncode(id) {
    return info(id).kind !== 'readonly';
  }

  /** 预热编码表（避免保存时卡顿） */
  function warmup(id) {
    return new Promise(function (resolve) {
      var e = info(normalize(id));
      if (e.kind === 'utf8' || e.kind === 'utf16' || e.kind === 'readonly') return resolve(false);
      setTimeout(function () { try { getTable(id); } catch (err) {} resolve(true); }, 0);
    });
  }

  /* ---------------------------------------------------------
     行尾序列
     --------------------------------------------------------- */
  function detectEol(text) {
    var crlf = 0, lf = 0, i = 0;
    var lim = Math.min(text.length, 100000);
    for (; i < lim; i++) {
      if (text.charCodeAt(i) === 10) {
        if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++; else lf++;
      }
    }
    if (crlf === 0 && lf === 0) return null;
    return crlf > lf ? 'CRLF' : 'LF';
  }

  global.Encoding = {
    list: ENCODINGS,
    info: info,
    normalize: normalize,
    detect: detect,
    detectBOM: detectBOM,
    detectEol: detectEol,
    decode: decode,
    encode: encode,
    canEncode: canEncode,
    warmup: warmup,
    isBinary: isBinary
  };
})(window);
