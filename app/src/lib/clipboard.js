// =====================================================================
// lib/clipboard.js：复制到剪贴板（带成功提示、换行正确）。
//
//   import { copyText, joinLines, useCopy } from '../lib/clipboard.js';
//
//   // 1. 直接复制：成功发一条“已复制…”提示（lib/notify.js → overlay 的 Toast 显示），返回 { ok, method, text }
//   await copyText(joinLines(['1月10日 周日', '10:20 抵达', '', '19:30 夜市']), { label: '当天行程' });
//
//   // 2. 按钮上就地显示“已复制”（不依赖 Toast）：
//   const { copy, copied } = useCopy();
//   <button onClick={() => copy(text, { label: '地址' })}>{copied ? '已复制' : '复制'}</button>
//
// 换行：一律用真正的换行符 '\n'（旧版把 '\\n' 当字面量写进去，粘贴出来是一串反斜杠 n）。
//   joinLines 会去掉 null/false、去掉每行行尾空格、连续空行合并成一行。
//
// 兼容：优先 navigator.clipboard.writeText（需要安全上下文：https 或 localhost）；
//   失败（旧 iOS、权限被拒、页面在 iframe 里）退回隐藏 textarea + execCommand('copy')，
//   这一步按 iOS 的要求做了 readonly + contentEditable + setSelectionRange，并且字号 16px 防止页面放大。
//   两种都要在点击回调里同步发起（iOS 只认用户手势），不要先 await 别的再复制。
// =====================================================================

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { notify } from './notify.js';

/** 统一换行：\r\n、\r、Unicode 行分隔符 → \n；去掉行尾空白；去掉首尾空行 */
export function normalizeNewlines(text) {
  return String(text ?? '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * 把多行拼成一段要复制的文字。
 *   - 跳过 null / undefined / false（方便写 cond && '某行'）；数组会被展开（一组行）
 *   - 空字符串 '' 表示一个空行；连续多个空行合并成一个
 * @param {Array<string|number|null|undefined|false|Array>} lines
 */
export function joinLines(lines) {
  const flat = [];
  const walk = (arr) => {
    for (const x of arr) {
      if (Array.isArray(x)) walk(x);
      else if (x !== null && x !== undefined && x !== false) flat.push(String(x));
    }
  };
  walk(Array.isArray(lines) ? lines : [lines]);
  const out = [];
  for (const line of normalizeNewlines(flat.join('\n')).split('\n')) {
    if (line === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

function defaultEnv() {
  return {
    navigator: typeof navigator !== 'undefined' ? navigator : undefined,
    document: typeof document !== 'undefined' ? document : undefined,
  };
}

/** 退回方案：隐藏 textarea + execCommand('copy')（iOS Safari 也能用） */
function legacyCopy(text, doc) {
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.setAttribute('tabindex', '-1');
  // iOS 只有 contentEditable 的元素才能被程序选中
  ta.contentEditable = 'true';
  // 通过 CSSOM 设置样式（CSP 不允许 style 属性字符串）；16px 防止 iOS 聚焦时放大页面
  Object.assign(ta.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', padding: '0', border: '0',
    opacity: '0', pointerEvents: 'none', fontSize: '16px', whiteSpace: 'pre',
  });
  const previous = doc.activeElement;
  const selection = typeof doc.getSelection === 'function' ? doc.getSelection() : null;
  const ranges = [];
  if (selection) for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i));
  doc.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = Boolean(doc.execCommand('copy'));
  } catch {
    ok = false;
  } finally {
    ta.remove();
    // 还原焦点和原来的选区（不打断用户正在看的地方）
    if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const r of ranges) selection.addRange(r);
    }
  }
  return ok;
}

/**
 * 复制文字。
 * @param {string} text
 * @param {object} [o]
 * @param {string} [o.label]      提示里说复制了什么：'已复制地址'；不给就是 '已复制'
 * @param {boolean} [o.silent]    不发提示（按钮自己显示“已复制”时用）
 * @param {string} [o.successMessage] 自定义成功提示
 * @param {{ navigator?: any, document?: any }} [o.env] 测试时注入假的浏览器对象
 * @returns {Promise<{ ok: boolean, method: 'clipboard'|'legacy'|null, text: string }>}
 */
export async function copyText(text, { label, silent = false, successMessage, env = defaultEnv() } = {}) {
  const value = normalizeNewlines(text);
  let method = null;
  const clip = env.navigator?.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(value);
      method = 'clipboard';
    } catch {
      method = null;
    }
  }
  if (!method && legacyCopy(value, env.document)) method = 'legacy';
  const ok = method !== null;
  if (!silent) {
    // key 相同：连点几次“复制”只留一条提示
    if (ok) notify({ message: successMessage || `已复制${label || ''}`, tone: 'success', key: 'clipboard' });
    else notify({ message: '复制失败，请长按文字手动复制', tone: 'danger', key: 'clipboard' });
  }
  return { ok, method, text: value };
}

/**
 * 按钮就地反馈“已复制”的 hook。
 * @param {{ resetAfter?: number }} [o] 多久后恢复成“复制”（毫秒，默认 1600）
 * @returns {{ copy: (text: string, opts?: object) => Promise<object>, state: 'idle'|'copied'|'failed', copied: boolean, failed: boolean }}
 */
export function useCopy({ resetAfter = 1600 } = {}) {
  const [state, setState] = useState('idle');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text, opts) => {
    const result = await copyText(text, opts);
    setState(result.ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), resetAfter);
    return result;
  }, [resetAfter]);
  return { copy, state, copied: state === 'copied', failed: state === 'failed' };
}
