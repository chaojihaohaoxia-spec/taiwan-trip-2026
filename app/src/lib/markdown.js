// =====================================================================
// lib/markdown.js：简单 Markdown（贴士正文 tips.body、日记、备注用）。
//
// 只支持这几样（docs/数据结构.md B4.10 约定的范围）：
//   段落（空行分段；段内换行保留）
//   列表 '- ' / '* ' / '• '，编号列表 '1. ' / '1、'
//   **加粗**
//   [文字](链接)，以及正文里直接写的 https://… 网址（自动变成链接）
//   以 '#' 开头的行显示成加粗小标题（不改变页面的标题层级）
// 其他一切按纯文本显示。
//
// 安全：
//   - 不拼 HTML、不用 innerHTML：渲染结果是 Preact 虚拟节点，文字一律当文本节点，<script> 只会原样显示；
//   - 链接只放行 http(s)、mailto、tel 和站内 '#/…'；javascript:、data: 等一律只显示文字，不生成链接；
//   - 站外链接新标签打开，带 rel="noopener noreferrer"。
//   markdownToHtml() 给复制富文本、测试用，同样全部转义。
//
//   import { Markdown } from '../lib/markdown.js';
//   <Markdown text={tip.body} class="tip__body" />
//
//   <Markdown text={tip.body} phones />   正文里写的电话号码也变成 tel: 链接（lib/contact-links.js 的 phoneSpans 规则）
//
//   parseMarkdown(text, { phones })   → 块列表（AST），想自己渲染时用
//   markdownToText(text)              → 纯文本（搜索、预览摘要、复制）
// =====================================================================

import { h } from 'preact';
import { phoneSpans } from './contact-links.js';
import { openExternal, haptic } from './native.js';

// ---------------------------------------------------------------------
// 链接安全
// ---------------------------------------------------------------------

/**
 * 链接是否安全：安全返回清理后的网址，不安全返回 null。
 * 放行：http://、https://、mailto:、tel:、站内路由 '#/…'。
 */
export function safeHref(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  // 任何空白、控制字符都不放行（'java\tscript:' 这类混淆也一起挡掉）
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(raw)) return null;
  if (raw.startsWith('#/')) return raw;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try {
      const u = new URL(raw);
      return u.hostname ? raw : null;
    } catch {
      return null;
    }
  }
  if (scheme === 'mailto' || scheme === 'tel') return raw;
  return null;
}

/** 站外链接（新标签打开） */
export function isExternalHref(href) {
  return /^https?:/i.test(String(href || ''));
}

// ---------------------------------------------------------------------
// 行内解析
// ---------------------------------------------------------------------

/** 自动识别的裸网址：http(s):// 开头，到空白或中文标点为止 */
const BARE_URL = /https?:\/\/[^\s<>"'“”‘’「」『』（）《》，。；：！？、【】]+/y;
/** 网址末尾不算进去的标点（句号、逗号、引号……） */
const TRAILING_PUNCT = '.,;:!?\'"]}';

function trimUrl(url) {
  let u = url;
  while (u.length) {
    const last = u[u.length - 1];
    if (TRAILING_PUNCT.includes(last)) {
      u = u.slice(0, -1);
      continue;
    }
    // 末尾的右括号：只有网址里左括号不够数时才去掉（维基百科 …_(城市) 这类网址保留）
    if (last === ')' && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length) {
      u = u.slice(0, -1);
      continue;
    }
    break;
  }
  return u;
}

function pushText(out, value) {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === 'text') last.value += value;
  else out.push({ type: 'text', value });
}

/**
 * 行内解析：加粗、链接、裸网址、反斜杠转义。
 * @param {string} text 一行（不含换行）
 * @param {{ links?: boolean }} [o] links: false 时不再识别链接（链接文字里不嵌套链接）
 * @returns {Array<{type:'text',value:string}|{type:'strong',children:Array}|{type:'link',href:string,external:boolean,children:Array}>}
 */
export function parseInline(text, { links = true } = {}) {
  const s = String(text ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    // 反斜杠转义：\* \[ \] \( \) \\ \#
    if (ch === '\\' && i + 1 < s.length && '*[]()\\#_-'.includes(s[i + 1])) {
      pushText(out, s[i + 1]);
      i += 2;
      continue;
    }

    // **加粗**
    if (ch === '*' && s[i + 1] === '*') {
      const close = s.indexOf('**', i + 2);
      if (close > i + 2) {
        out.push({ type: 'strong', children: parseInline(s.slice(i + 2, close), { links }) });
        i = close + 2;
        continue;
      }
    }

    // [文字](链接)
    if (links && ch === '[') {
      const m = matchLink(s, i);
      if (m) {
        const href = safeHref(m.url);
        const children = parseInline(m.label, { links: false });
        if (href) out.push({ type: 'link', href, external: isExternalHref(href), children });
        else for (const c of children) (c.type === 'text' ? pushText(out, c.value) : out.push(c));
        i = m.end;
        continue;
      }
    }

    // 裸网址：前面必须是开头或非字母数字（避免把 'xhttps://' 截出来）
    if (links && (ch === 'h' || ch === 'H') && (i === 0 || !/[A-Za-z0-9]/.test(s[i - 1]))) {
      BARE_URL.lastIndex = i;
      const m = BARE_URL.exec(s);
      if (m) {
        const url = trimUrl(m[0]);
        const href = safeHref(url);
        if (href && url.length > 'https://'.length) {
          out.push({ type: 'link', href, external: true, children: [{ type: 'text', value: url }] });
          i += url.length;
          continue;
        }
      }
    }

    pushText(out, ch);
    i += 1;
  }
  return out;
}

/** 行内节点里的电话号码（只看普通文字，不进加粗、不进已有链接）拆成 tel: 链接 */
function linkPhones(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'strong') {
      out.push({ ...n, children: linkPhones(n.children) });
      continue;
    }
    if (n.type !== 'text') {
      out.push(n);
      continue;
    }
    for (const span of phoneSpans(n.value)) {
      if (span.tel) out.push({ type: 'link', href: span.tel, external: false, children: [{ type: 'text', value: span.text }] });
      else pushText(out, span.text);
    }
  }
  return out;
}

/** 在 s[start] === '[' 处匹配 [label](url)，支持 label 里成对的方括号和 url 里成对的圆括号 */
function matchLink(s, start) {
  let depth = 0;
  let j = start;
  for (; j < s.length; j += 1) {
    if (s[j] === '\\') {
      j += 1;
      continue;
    }
    if (s[j] === '[') depth += 1;
    else if (s[j] === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || s[j + 1] !== '(') return null;
  const label = s.slice(start + 1, j);
  let k = j + 2;
  let paren = 1;
  // 允许 <网址> 写法
  if (s[k] === '<') {
    const close = s.indexOf('>)', k);
    if (close < 0) return null;
    return { label, url: s.slice(k + 1, close), end: close + 2 };
  }
  for (; k < s.length; k += 1) {
    if (s[k] === '(') paren += 1;
    else if (s[k] === ')') {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  if (paren !== 0) return null;
  const url = s.slice(j + 2, k).trim();
  if (!label.trim() && !url) return null;
  return { label: label || url, url, end: k + 1 };
}

// ---------------------------------------------------------------------
// 块解析
// ---------------------------------------------------------------------

const BULLET = /^ {0,3}[-*+•·]\s+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,3})(?:[.)．]\s+|、\s*)(.+)$/;
const HEADING = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/**
 * 解析成块：
 *   { type: 'paragraph', lines: Inline[][] }
 *   { type: 'heading', children: Inline[] }
 *   { type: 'list', ordered: boolean, start: number, items: Inline[][][] }   每项可以有多行（缩进的续行）
 */
export function parseMarkdown(source, { phones = false } = {}) {
  const inline = phones ? (t) => linkPhones(parseInline(t)) : (t) => parseInline(t);
  const lines = String(source ?? '').replace(/\r\n?|\u2028|\u2029/g, '\n').replace(/\t/g, '  ').split('\n');
  const blocks = [];
  let para = null;
  let list = null;

  const closeAll = () => {
    para = null;
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) {
      closeAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeAll();
      blocks.push({ type: 'heading', children: inline(heading[1]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const content = bullet ? bullet[1] : ordered[2];
      if (!list || list.ordered !== isOrdered) {
        para = null;
        list = { type: 'list', ordered: isOrdered, start: isOrdered ? Number(ordered[1]) : 1, items: [] };
        blocks.push(list);
      }
      list.items.push([inline(content)]);
      continue;
    }

    // 列表项下面缩进的续行：并进上一项
    if (list && /^ {2,}\S/.test(rawLine)) {
      list.items[list.items.length - 1].push(inline(line.trim()));
      continue;
    }

    // 普通文字：没有缩进的行跟在列表后面算新段落（中文笔记常常不空行）
    list = null;
    if (!para) {
      para = { type: 'paragraph', lines: [] };
      blocks.push(para);
    }
    para.lines.push(inline(line.trim()));
  }
  return blocks;
}

// ---------------------------------------------------------------------
// 输出：虚拟节点 / HTML 字符串 / 纯文本
// ---------------------------------------------------------------------

/** 行内节点 → 虚拟节点。key 在创建时就带上（Preact 的虚拟节点不能拷贝或展开改写） */
function inlineToVNodes(nodes, prefix = '') {
  return nodes.map((n, i) => {
    const key = `${prefix}${i}`;
    if (n.type === 'text') return n.value;
    if (n.type === 'strong') return h('strong', { key }, inlineToVNodes(n.children, `${key}.`));
    const attrs = { key, href: n.href, class: 'md-link' };
    if (n.external) {
      attrs.target = '_blank';
      attrs.rel = 'noopener noreferrer';
    }
    return h('a', attrs, inlineToVNodes(n.children, `${key}.`));
  });
}

/** 多行（段落、列表项）→ 行之间插 <br> */
function linesToVNodes(lines) {
  const out = [];
  lines.forEach((nodes, i) => {
    if (i) out.push(h('br', { key: `br${i}` }));
    out.push(...inlineToVNodes(nodes, `${i}-`));
  });
  return out;
}

/** Markdown → Preact 虚拟节点数组（不经过 innerHTML） */
export function renderMarkdown(source, { phones = false } = {}) {
  return parseMarkdown(source, { phones }).map((b, i) => {
    if (b.type === 'heading') return h('p', { key: i, class: 'md-heading' }, h('strong', null, inlineToVNodes(b.children)));
    if (b.type === 'list') {
      return h(b.ordered ? 'ol' : 'ul', { key: i, class: 'md-list', start: b.ordered && b.start !== 1 ? b.start : undefined },
        b.items.map((item, j) => h('li', { key: j }, linesToVNodes(item))));
    }
    return h('p', { key: i }, linesToVNodes(b.lines));
  });
}

/**
 * 组件：<Markdown text={…} class="…" as="div" phones />（phones：正文里的电话号码也能点着拨）
 * 外层默认 <div class="md">；样式（段距、列表缩进、链接色）由使用方的 CSS 决定，这里不带样式。
 */
export function Markdown({ text, as = 'div', phones = false, class: cls, className, ...rest }) {
  const klass = ['md', cls, className].filter(Boolean).join(' ');
  return h(as, { ...rest, class: klass }, renderMarkdown(text, { phones }));
}

/**
 * 正文里链接的点击（放在 <Markdown onClick={onMarkdownLink}> 上，事件委托）：站外链接、tel:、mailto: 走 lib/native.js 的
 * openExternal（以后 iOS 外壳接管外链；网页新标签打开站外网址，电话 / 邮件同一个窗口唤起 App）；站内 '#/…' 交给路由。
 */
export function onMarkdownLink(e) {
  const a = e.target?.closest?.('a.md-link');
  if (!a) return;
  const link = a.getAttribute('href') || '';
  if (link.startsWith('#/')) return;
  e.preventDefault();
  haptic('light');
  openExternal(link, { newTab: /^https?:/i.test(link) });
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** HTML 转义 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

function inlineToHtml(nodes) {
  return nodes.map((n) => {
    if (n.type === 'text') return escapeHtml(n.value);
    if (n.type === 'strong') return `<strong>${inlineToHtml(n.children)}</strong>`;
    const ext = n.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(n.href)}"${ext}>${inlineToHtml(n.children)}</a>`;
  }).join('');
}

/** Markdown → HTML 字符串（全部转义；给复制富文本、测试用。页面里请用 <Markdown>） */
export function markdownToHtml(source) {
  return parseMarkdown(source).map((b) => {
    if (b.type === 'heading') return `<p><strong>${inlineToHtml(b.children)}</strong></p>`;
    if (b.type === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      return `<${tag}${start}>${b.items.map((item) => `<li>${item.map(inlineToHtml).join('<br>')}</li>`).join('')}</${tag}>`;
    }
    return `<p>${b.lines.map(inlineToHtml).join('<br>')}</p>`;
  }).join('');
}

function inlineToText(nodes) {
  return nodes.map((n) => (n.type === 'text' ? n.value : inlineToText(n.children))).join('');
}

/**
 * Markdown → 纯文本：去掉 ** 和链接语法，列表前面换成 '• ' 或 '1. '，段落之间空一行。
 * 搜索、摘要、复制给别人看时用。
 */
export function markdownToText(source) {
  return parseMarkdown(source).map((b) => {
    if (b.type === 'heading') return inlineToText(b.children);
    if (b.type === 'list') {
      return b.items.map((item, j) => `${b.ordered ? `${b.start + j}. ` : '• '}${item.map(inlineToText).join('\n  ')}`).join('\n');
    }
    return b.lines.map(inlineToText).join('\n');
  }).join('\n\n');
}
