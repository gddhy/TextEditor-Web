/* ============================================================
   langs.js — 文件扩展名 ↔ 语言模式映射
   ============================================================ */
(function (global) {
  'use strict';

  /* 扩展名 → Monaco 语言 ID */
  var EXT_MAP = {
    // 纯文本 / 配置
    txt: 'plaintext', text: 'plaintext', log: 'plaintext', me: 'plaintext',
    ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini', inf: 'ini',
    toml: 'ini', editorconfig: 'ini', gitconfig: 'ini', desktop: 'ini', reg: 'ini',
    csv: 'plaintext', tsv: 'plaintext',

    // 结构化数据
    json: 'json', jsonc: 'json', json5: 'json', map: 'json', webmanifest: 'json',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', svg: 'xml', plist: 'xml',
    rss: 'xml', atom: 'xml', pom: 'xml', csproj: 'xml', vcxproj: 'xml',
    resx: 'xml', config: 'xml', storyboard: 'xml',

    // 标记
    md: 'markdown', markdown: 'markdown', mdown: 'markdown', mkd: 'markdown', mdx: 'markdown',
    rst: 'plaintext', adoc: 'plaintext', tex: 'plaintext',

    // Web
    html: 'html', htm: 'html', xhtml: 'html', vue: 'html', hbs: 'handlebars',
    ejs: 'html', jsp: 'html', asp: 'html', aspx: 'html', erb: 'html', art: 'html',
    css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'css',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',

    // 脚本
    bat: 'bat', cmd: 'bat',
    vbs: 'vb', vbe: 'vb', vb: 'vb', bas: 'vb', frm: 'vb', cls: 'vb',
    ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell', command: 'shell',
    awk: 'shell', sed: 'shell',

    // 编程语言
    java: 'java', jsp2: 'java', gradle: 'java', jav: 'java',
    kt: 'kotlin', kts: 'kotlin',
    scala: 'scala', sc: 'scala',
    py: 'python', pyw: 'python', pyi: 'python', gyp: 'python',
    rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
    php: 'php', php5: 'php', phtml: 'php',
    go: 'go',
    rs: 'rust',
    c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    m: 'objective-c', mm: 'objective-c',
    dart: 'dart',
    lua: 'lua',
    pl: 'perl', pm: 'perl',
    r: 'r',
    sql: 'sql', ddl: 'sql', dml: 'sql',
    graphql: 'graphql', gql: 'graphql',
    proto: 'proto',
    tf: 'hcl', tfvars: 'hcl', hcl: 'hcl',
    dockerfile: 'dockerfile',
    makefile: 'makefile', mk: 'makefile',
    cmake: 'cmake',
    asm: 'asm', s: 'asm', nasm: 'asm',
    pas: 'pascal', pp: 'pascal',
    f: 'plaintext', f90: 'plaintext',
    clj: 'clojure', cljs: 'clojure',
    coffee: 'coffeescript',
    fs: 'fsharp', fsx: 'fsharp',
    jl: 'julia',
    sol: 'sol',
    bicep: 'bicep',
    razor: 'razor', cshtml: 'razor',
    twig: 'twig',
    pug: 'pug', jade: 'pug',
    diff: 'plaintext', patch: 'plaintext',
    nfo: 'plaintext', srt: 'plaintext', ass: 'plaintext', vtt: 'plaintext',
    ahk: 'plaintext', au3: 'plaintext', nsi: 'plaintext', iss: 'ini'
  };

  /* 无扩展名的特殊文件 */
  var NAME_MAP = {
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'gnumakefile': 'makefile',
    'cmakelists.txt': 'cmake',
    'license': 'plaintext',
    'readme': 'markdown',
    'changelog': 'markdown',
    '.gitignore': 'ini',
    '.gitattributes': 'ini',
    '.npmrc': 'ini',
    '.yarnrc': 'ini',
    '.editorconfig': 'ini',
    '.env': 'ini',
    '.babelrc': 'json',
    '.eslintrc': 'json',
    '.prettierrc': 'json',
    'package.json': 'json',
    'tsconfig.json': 'json'
  };

  /* 语言 ID → 中文显示名 */
  var LANG_LABEL = {
    plaintext: '纯文本', json: 'JSON', markdown: 'Markdown', html: 'HTML', css: 'CSS',
    scss: 'SCSS', less: 'Less', javascript: 'JavaScript', typescript: 'TypeScript',
    java: 'Java', xml: 'XML', bat: '批处理', vb: 'VBScript', powershell: 'PowerShell',
    shell: 'Shell', python: 'Python', ruby: 'Ruby', php: 'PHP', go: 'Go', rust: 'Rust',
    c: 'C', cpp: 'C++', csharp: 'C#', swift: 'Swift', 'objective-c': 'Objective-C',
    dart: 'Dart', lua: 'Lua', perl: 'Perl', r: 'R', sql: 'SQL', yaml: 'YAML', ini: 'INI',
    graphql: 'GraphQL', proto: 'Protobuf', hcl: 'HCL', dockerfile: 'Dockerfile',
    makefile: 'Makefile', cmake: 'CMake', asm: '汇编', pascal: 'Pascal',
    clojure: 'Clojure', coffeescript: 'CoffeeScript', fsharp: 'F#', julia: 'Julia',
    kotlin: 'Kotlin', scala: 'Scala', handlebars: 'Handlebars', razor: 'Razor',
    twig: 'Twig', pug: 'Pug', sol: 'Solidity', bicep: 'Bicep'
  };

  /* 语言 → 建议扩展名（另存为时使用） */
  var LANG_EXT = {
    plaintext: '.txt', json: '.json', markdown: '.md', html: '.html', css: '.css',
    javascript: '.js', typescript: '.ts', java: '.java', xml: '.xml', bat: '.bat',
    vb: '.vbs', powershell: '.ps1', shell: '.sh', python: '.py', yaml: '.yaml', ini: '.ini'
  };

  function extOf(name) {
    if (!name) return '';
    var base = String(name).split(/[\\/]/).pop();
    var i = base.lastIndexOf('.');
    if (i <= 0) return '';
    return base.slice(i + 1).toLowerCase();
  }

  function detectLanguage(name, content) {
    var base = String(name || '').split(/[\\/]/).pop().toLowerCase();
    if (NAME_MAP[base]) return NAME_MAP[base];

    var ext = extOf(base);
    if (ext && EXT_MAP[ext]) return EXT_MAP[ext];
    if (!ext && NAME_MAP[base.replace(/\..*$/, '')]) return NAME_MAP[base.replace(/\..*$/, '')];

    // 无扩展名时按内容嗅探
    if (content) {
      var head = content.slice(0, 800).trim();
      if (/^#!.*\b(bash|sh|zsh)\b/.test(head)) return 'shell';
      if (/^#!.*\bpython/.test(head)) return 'python';
      if (/^#!.*\bnode/.test(head)) return 'javascript';
      if (/^#!.*\bperl/.test(head)) return 'perl';
      if (/^\s*<\?xml/.test(head)) return 'xml';
      if (/^\s*<!DOCTYPE\s+html/i.test(head) || /^\s*<html/i.test(head)) return 'html';
      if (/^\s*[{[]/.test(head) && /["}\]]\s*$/.test(content.trim())) {
        try { JSON.parse(content); return 'json'; } catch (e) {}
      }
      if (/^@echo\s+off/im.test(head)) return 'bat';
    }
    return 'plaintext';
  }

  function label(langId) {
    return LANG_LABEL[langId] || (langId ? langId.toUpperCase() : '纯文本');
  }

  function suggestExt(langId) {
    return LANG_EXT[langId] || '.txt';
  }

  function isMarkdown(name, langId) {
    if (langId === 'markdown') return true;
    var e = extOf(name);
    return e === 'md' || e === 'markdown' || e === 'mdown' || e === 'mkd' || e === 'mdx';
  }

  /** 供文件选择器使用的 accept 列表 */
  function acceptTypes() {
    var exts = Object.keys(EXT_MAP).map(function (e) { return '.' + e; });
    return [{
      description: '文本文件',
      accept: { 'text/plain': exts.slice(0, 100) }
    }];
  }

  /** 文件类型小图标（SVG path） */
  function iconFor(langId) {
    var color = {
      json: '#F0B429', markdown: '#42A5F5', html: '#E44D26', css: '#42A5F5',
      javascript: '#F7DF1E', typescript: '#3178C6', java: '#E76F00', xml: '#8BC34A',
      bat: '#4CAF50', vb: '#9C27B0', python: '#3776AB', shell: '#4CAF50',
      powershell: '#2E7DD7', yaml: '#CB171E', ini: '#78909C', sql: '#F29111',
      go: '#00ADD8', rust: '#DEA584', php: '#777BB4', ruby: '#CC342D',
      cpp: '#00599C', c: '#555555', csharp: '#68217A'
    }[langId] || 'currentColor';
    return color;
  }

  global.Langs = {
    EXT_MAP: EXT_MAP,
    detectLanguage: detectLanguage,
    label: label,
    extOf: extOf,
    suggestExt: suggestExt,
    isMarkdown: isMarkdown,
    acceptTypes: acceptTypes,
    iconFor: iconFor
  };
})(window);
