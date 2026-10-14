// lib/clipboard.js 和 lib/notify.js：拼行（真换行）、复制（clipboard API / execCommand 兼容）、成功和失败提示

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNewlines, joinLines, copyText } from '../../src/lib/clipboard.js';
import { notify, onNotify, lastNotice, hasNotifyListeners, NOTICE_TONES, normalizeTone } from '../../src/lib/notify.js';

test('换行统一：\\r\\n、\\r、行分隔符都变成 \\n；去行尾空白、首尾空行；不碰字面的反斜杠 n', () => {
  assert.equal(normalizeNewlines('a\r\nb\rc\u2028d'), 'a\nb\nc\nd');
  assert.equal(normalizeNewlines('a  \t\nb\u00a0\n'), 'a\nb');
  assert.equal(normalizeNewlines('\n\n正文\n\n'), '正文');
  assert.equal(normalizeNewlines('路径 C:\\new'), '路径 C:\\new', '字面的 \\n 原样保留，不会被当成换行');
  assert.equal(normalizeNewlines(null), '');
});

test('拼行：跳过 null/false、展开数组、空字符串是空行、连续空行合并', () => {
  const text = joinLines(['1月10日 周日', '10:20 抵达', null, false && '不会出现', undefined, '', '', ['（雨天）酒店吃', '（备选）按摩'], '', 0]);
  assert.equal(text, '1月10日 周日\n10:20 抵达\n\n（雨天）酒店吃\n（备选）按摩\n\n0');
  assert.ok(!text.includes('\\n'), '没有字面的反斜杠 n（旧版的毛病）');
  assert.equal(text.split('\n').length, 7);
  assert.equal(joinLines([]), '');
  assert.equal(joinLines('单行'), '单行');
  assert.equal(joinLines(['', 'a', '']), 'a', '首尾空行去掉');
});

function fakeDocument({ execResult = true } = {}) {
  const log = { appended: [], removed: 0, focused: null, exec: [] };
  const body = {
    appendChild(el) {
      log.appended.push(el);
      el.remove = () => { log.removed += 1; };
    },
  };
  const doc = {
    body,
    activeElement: { focus(opts) { log.focused = opts; } },
    createElement(tag) {
      return {
        tag, style: {}, value: '', attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        focus() {}, select() {}, setSelectionRange(a, b) { this.range = [a, b]; },
      };
    },
    execCommand(cmd) {
      log.exec.push({ cmd, value: log.appended[log.appended.length - 1]?.value });
      return execResult;
    },
    getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }),
  };
  return { doc, log };
}

test('复制：优先 navigator.clipboard，写进去的是真换行；成功发“已复制…”提示（同 key 去重）', async () => {
  const written = [];
  const env = { navigator: { clipboard: { writeText: async (t) => { written.push(t); } } }, document: fakeDocument().doc };
  const seen = [];
  const off = onNotify((n) => seen.push(n));
  const r = await copyText('第一行\r\n第二行  \n', { label: '当天行程', env });
  off();
  assert.deepEqual(r, { ok: true, method: 'clipboard', text: '第一行\n第二行' });
  assert.deepEqual(written, ['第一行\n第二行']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].message, '已复制当天行程');
  assert.equal(seen[0].tone, 'success');
  assert.equal(seen[0].key, 'clipboard');
});

test('复制：clipboard API 被拒时退回 execCommand（iOS 要求的 readonly + contentEditable + 16px）', async () => {
  const { doc, log } = fakeDocument();
  const env = { navigator: { clipboard: { writeText: async () => { throw new DOMException('denied', 'NotAllowedError'); } } }, document: doc };
  const r = await copyText('a\nb', { silent: true, env });
  assert.deepEqual(r, { ok: true, method: 'legacy', text: 'a\nb' });
  assert.equal(log.exec[0].cmd, 'copy');
  assert.equal(log.exec[0].value, 'a\nb', 'textarea 里也是真换行');
  const ta = log.appended[0];
  assert.equal(ta.tag, 'textarea');
  assert.equal(ta.attrs.readonly, '');
  assert.equal(ta.contentEditable, 'true');
  assert.equal(ta.style.fontSize, '16px');
  assert.equal(ta.style.position, 'fixed');
  assert.deepEqual(ta.range, [0, 3]);
  assert.equal(log.removed, 1, '用完就删');
  assert.deepEqual(log.focused, { preventScroll: true }, '焦点还回去、不滚动页面');
  // 没有 clipboard API（很旧的浏览器）：直接走兼容
  const { doc: doc2 } = fakeDocument();
  assert.equal((await copyText('x', { silent: true, env: { navigator: {}, document: doc2 } })).method, 'legacy');
});

test('复制失败：两种方式都不行 → ok: false，发失败提示（教用户长按手动复制）', async () => {
  const { doc } = fakeDocument({ execResult: false });
  const seen = [];
  const off = onNotify((n) => seen.push(n));
  const r = await copyText('x', { env: { navigator: { clipboard: { writeText: async () => { throw new Error('no'); } } }, document: doc } });
  off();
  assert.equal(r.ok, false);
  assert.equal(r.method, null);
  assert.equal(seen[0].tone, 'danger');
  assert.match(seen[0].message, /长按/);
  // 什么都没有（Node 环境）
  assert.equal((await copyText('x', { silent: true, env: {} })).ok, false);
});

test('提示总线：字段和 overlay 的 toast() 一致；订阅、取消订阅、订阅者出错不影响别人、空消息不发', () => {
  assert.deepEqual(NOTICE_TONES, ['neutral', 'success', 'warning', 'danger', 'info']);
  assert.equal(normalizeTone('default'), 'neutral', '旧写法 default = neutral');
  assert.equal(normalizeTone('warning'), 'warning');
  assert.equal(normalizeTone(undefined), 'neutral');
  const got = [];
  const off1 = onNotify(() => { throw new Error('坏订阅者'); });
  const off2 = onNotify((n) => got.push(n));
  assert.ok(hasNotifyListeners());
  const origError = console.error;
  console.error = () => {};
  try {
    const undo = () => {};
    const n = notify('已删除', { action: { label: '撤销', onClick: undo }, duration: 6000 });
    assert.equal(n.tone, 'neutral');
    assert.equal(n.action.onClick, undo);
    assert.equal(n.duration, 6000);
    assert.equal(lastNotice.value, n);
    notify({ message: '出错了', tone: 'danger', key: 'save' });
    notify({ message: '奇怪的语气', tone: 'weird' });
    assert.equal(notify('   '), null, '空消息不发');
    notify({ message: '坏按钮', action: { label: 1, onClick: 'x' } });
  } finally {
    console.error = origError;
  }
  off1();
  off2();
  assert.equal(got.length, 4);
  assert.equal(got[1].key, 'save');
  assert.equal(got[2].tone, 'neutral');
  assert.ok(!('action' in got[3]), '不合法的按钮丢掉');
  assert.ok(got[1].id > got[0].id, 'id 递增');
  notify('没人听');
  assert.equal(got.length, 4, '取消订阅后收不到');
  assert.equal(lastNotice.value.message, '没人听', '没人订阅时留在 lastNotice 里');
});
