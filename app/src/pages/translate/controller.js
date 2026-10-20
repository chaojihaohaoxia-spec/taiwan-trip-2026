// =====================================================================
// pages/translate/controller.js：翻译页的状态和规则（和小程序 1.4.5 的 components/trip-translate 同一套；不碰 DOM，Node 里能测）。
//
//   const c = createTranslateController({ client, phrases, timers, onShown })
//   c.state.value     { text, res, busy, manual, msg, msgKind, failed, done, dir, spin, honor, trip }
//   viewOf(c.state.value)  → 界面要的派生：stale（结果已经不是输入框里这一句）、old（顶上写「上一句：…」）、canShow……
//
// 规则（照小程序）：
//   - 边打边翻：句末有标点（看着写完了）停 0.45 秒、没写完停 0.65 秒自动翻；还在打拼音不翻；同一句不重发；新的一发，旧的作废。
//     回车 / 「翻译」马上翻；翻好以后「翻译」变淡（输入框里就是这一句），点输入框接着改，× 清空。
//   - 边打边翻的中间结果不进「最近翻过」：收键盘、复制、给对方看、收藏、离开时才记；停 2.5 秒也记，但只记看着写完了的。
//   - 边打边翻撞到限频：不提示，等名额空出来自动把最后一句补发；手动的 5 秒内能发就转着圈等，再久才提示。
//   - 输入框改了字：旧结果只轻轻变淡（不跳）；新的一句没翻成、或者点了「翻译」还没出来时，顶上才写「上一句：…」，也不能「给对方看」。
//   - 语言栏「中文 ⇄ 越南语」：⇄ 对调（有结果时译文挪进输入框；中文 → 越南语的回译现成就有，不用再翻；
//     对调出来的那条再按一下直接还原）。写的语言和栏里不一样，就按写的翻、栏自己翻过来，每个方向提示一次。
//   - 翻过的同一句（收藏、最近翻过、这次打开翻过的）直接拿出来，不连网（没网也能用）。
// =====================================================================

import { signal } from '@preact/signals';
import { keyOf, withHonor, composing, finished, text as clean, MAX_CHARS, len } from '../../lib/translate/text.js';

export const L = Object.freeze({
  ph: '写一句中文，翻成越南语和英语',
  phIn: '贴越南语或英语，翻成中文',
  go: '翻译', busy: '翻译中', clear: '清空', copy: '复制', copyVi: '复制越南语', copied: '已复制',
  vi: '越南语', en: '英语', zh: '中文', back: '意思是', show: '给对方看', plusEn: '＋英语', speak: '读出来',
  recent: '最近翻过', empty: '翻过的句子会留在这里', emptySub: '没网也能看，点一条就能再给对方看',
  saved: '收藏', savedAll: '全部', savedLess: '收起', tips: '这趟的常用语',
  again: '之前翻过', demo: '演示模式：只认得几句', prev: '上一句',
  del: '删掉这条', star: '收藏', unstar: '取消收藏', swap: '对调方向',
  mic: '可以点键盘上的话筒说话',
  micIn: '对方说越南语：键盘切到越南语再点话筒',
  paste: '粘贴', pasteNone: '剪贴板是空的',
  talk: '对话',
  fixIn: '看着是外文，帮你翻成中文了', fixOut: '看着是中文，帮你翻成越南语了',
  starred: '收藏好了', unstarred: '不收藏了', full: '收藏满了，挤掉了最早的一条',
  honorNone: '加称呼', honorPre: '称呼：',
});

export const TIMING = Object.freeze({ auto: 450, autoMid: 650, commit: 2500, spin: 5000 });

/** 输入框里已经不是这一句了（改了字、换了称呼）：text 是输入框里的字，honor 是选的称呼 */
export function staleOf(text, res, honor) {
  if (!res) return false;
  // 从收藏、最近翻过点开的那条：输入框里就是它的原文，称呼不另算（它当时有没有称呼都写在原文里了）
  if (res.picked && keyOf(text) === keyOf(res.input)) return false;
  return keyOf(withHonor(text, honor)) !== keyOf(res.input);
}

/** 界面要的派生状态 */
export function viewOf(s) {
  const stale = staleOf(s.text, s.res, s.honor);
  const old = Boolean(s.res && stale && (s.failed || (s.busy && s.manual)));
  const dim = Boolean(s.res && (stale || s.busy));
  const n = len(s.text);
  return {
    stale,
    old,
    dim,
    /** 能不能给对方看：中文 → 越南语、有越南语、不是上一句、没在手动翻 */
    canShow: Boolean(s.res && s.res.dir === 'out' && s.res.vi && !stale && !(s.busy && s.manual)),
    /** 「翻译」按钮：没字 / 已经翻好了就变淡 */
    goOff: !clean(s.text) || s.done,
    /** 快写满了：还能写几个字 */
    left: n > MAX_CHARS - 100 ? String(MAX_CHARS - n) : '',
    /** 第一句还在翻（还没有结果卡）：一张等着的空卡 */
    waiting: Boolean(s.busy && !s.res),
  };
}

const INITIAL = { text: '', res: null, busy: false, manual: false, msg: '', msgKind: '', failed: false, done: false, dir: 'out', spin: 0, honor: '', trip: null };

/**
 * @param {{
 *   client: { runner: () => { run: Function, cancel: Function }, warm?: Function },
 *   phrases: ReturnType<import('../../lib/translate/store.js').createPhraseStore>,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 *   isComposing?: () => boolean,
 *   onShown?: (res: object, o: { manual: boolean }) => void,
 * }} deps
 */
export function createTranslateController({ client, phrases, timers, isComposing = () => false, onShown = () => {} }) {
  const T = timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
  const state = signal({ ...INITIAL, honor: phrases.honor() });
  const live = client.runner();
  const hinted = { in: false, out: false };
  let pending = null;       // 边打边翻翻好、还没记进「最近翻过」的结果
  let inflight = '';        // 正在翻的那句（key）
  let manualFor = '';       // 正在翻的那句是手动点的
  let autoT = null;
  let commitT = null;
  let retryT = null;
  let waitFrom = 0;
  const clear = (t) => { if (t) T.clearTimeout(t); return null; };
  const set = (patch) => { state.value = { ...state.value, ...patch }; };
  const get = () => state.value;

  function setTrip(trip) {
    if (get().trip !== trip) set({ trip });
  }

  /** 边打边翻的结果记进「最近翻过」 */
  function commit() {
    commitT = clear(commitT);
    const p = pending;
    pending = null;
    if (!p || !p.input) return null;
    const row = phrases.save(p.input, p);
    const cur = get().res;
    if (row && cur && keyOf(cur.input) === keyOf(row.input)) set({ res: { ...cur, id: row.id } });
    return row;
  }

  /** 正在翻的、等着补发的：全不要了 */
  function drop() {
    autoT = clear(autoT);
    retryT = clear(retryT);
    waitFrom = 0;
    live.cancel();
    inflight = '';
    manualFor = '';
  }

  function input(value, cursor) {
    const textNow = value || '';
    const patch = { text: textNow, done: false };
    const s = get();
    if (s.msg) { patch.msg = ''; patch.msgKind = ''; }
    if (s.failed) patch.failed = false;
    // 清空了：结果也收起（谷歌翻译也是这样），正在翻的作废
    if (!textNow.trim()) {
      Object.assign(patch, { res: null, busy: false, manual: false });
      commit();
      drop();
    }
    set(patch);
    autoT = clear(autoT);
    retryT = clear(retryT);
    waitFrom = 0;
    const delay = finished(textNow) ? TIMING.auto : TIMING.autoMid;
    if (textNow.trim()) autoT = T.setTimeout(() => auto(cursor), delay);
  }

  function auto(cursor) {
    autoT = null;
    const s = get();
    // 输入法还在拼写（compositionstart 到 compositionend 之间）、或者看着还在打拼音：不翻，等字上屏
    if (!clean(s.text) || isComposing() || composing(s.text, cursor, s.dir)) return;
    request(false);
  }

  function blur() {
    commit();
  }

  function go() {
    const s = get();
    if (s.busy && s.manual) return false;
    autoT = clear(autoT);
    retryT = clear(retryT);
    if (!clean(s.text)) {
      set({ msg: '先写一句', msgKind: 'soft' });
      return false;
    }
    request(true);
    return true;
  }

  function clearText() {
    commit();
    drop();
    set({ text: '', msg: '', msgKind: '', res: null, failed: false, busy: false, manual: false, done: false });
  }

  function request(manual) {
    retryT = clear(retryT);
    const s = get();
    const inputText = withHonor(s.text, s.honor);
    const key = keyOf(inputText);
    if (!key) return;
    const res = s.res;
    // 就是刚翻好的这一句：不再发（手动点的记一条、「翻译」变淡）
    if (res && keyOf(res.input) === key) {
      if (manual) {
        commit();
        set({ done: true, failed: false });
      } else if (pending && finished(s.text)) {
        commitT = clear(commitT);
        commitT = T.setTimeout(commit, TIMING.commit);
      }
      return;
    }
    // 正在翻的就是这一句：手动点的，翻好时按手动的来
    if (inflight === key) {
      if (manual) { manualFor = key; set({ manual: true, busy: true }); }
      return;
    }
    // 翻过的同一句：直接拿出来，不连网
    const hit = phrases.peek(inputText);
    if (hit) {
      drop();
      const fromStore = Boolean(hit.id);
      showRow({ ...hit, again: fromStore }, { manual, saved: fromStore });
      return;
    }
    inflight = key;
    manualFor = manual ? key : '';
    set({ busy: true, manual, msg: '', msgKind: '' });
    const trip = s.trip || undefined;
    live.run(inputText, { auto: !manual, trip }).then((r) => {
      waitFrom = 0;
      if (inflight === key) inflight = '';
      const byHand = manual || manualFor === key;
      if (manualFor === key) manualFor = '';
      phrases.remember(inputText, r);
      showRow(r, { manual: byHand, saved: false });
    }, (e) => {
      if (e && e.code === 'stale') return;
      if (inflight === key) inflight = '';
      const byHand = manual || manualFor === key;
      if (manualFor === key) manualFor = '';
      // 限频：边打边翻的不吵，名额空出来自动补发最后一句；手动的 5 秒内能发就转着圈等
      if (e && e.code === 'rate' && e.wait > 0 && (!byHand || e.wait <= TIMING.spin)) {
        if (!waitFrom) waitFrom = Date.now();
        retryT = T.setTimeout(() => { retryT = null; request(byHand); }, e.wait);
        set({ busy: byHand, manual: byHand });
        return;
      }
      waitFrom = 0;
      const offline = e && e.code === 'offline';
      set({
        busy: false, manual: false, failed: true,
        msg: (e && e.message) || '没翻成，再点一次',
        msgKind: offline ? 'offline' : byHand ? 'bad' : 'soft',
      });
    });
  }

  /** 显示一条结果。o.manual：「翻译」变淡、马上记进最近翻过；o.saved：已经在手机里了（最近翻过 / 收藏），不再记 */
  function showRow(row, o = {}) {
    commitT = clear(commitT);
    const res = {
      id: row.id || '', dir: row.dir === 'in' ? 'in' : 'out', input: row.input || '',
      vi: row.vi || '', en: row.en || '', zh: row.zh || '', back: row.back || '',
      demo: Boolean(row.demo), again: Boolean(row.again), from: row.from || null,
    };
    pending = o.saved ? null : res;
    const s = get();
    const patch = { busy: false, manual: false, res, failed: false, msg: '', msgKind: '' };
    if (o.manual) patch.done = true;
    // 写的语言和语言栏不一样：栏跟着翻过来，提示一次
    if (res.dir !== s.dir) {
      patch.dir = res.dir;
      patch.spin = s.spin + 1;
      if (!hinted[res.dir]) {
        hinted[res.dir] = true;
        patch.msg = res.dir === 'in' ? L.fixIn : L.fixOut;
        patch.msgKind = 'note';
      }
    }
    set(patch);
    if (o.manual) commit();
    else if (pending && (finished(pending.input) || finished(get().text))) commitT = T.setTimeout(commit, TIMING.commit);
    onShown(get().res, { manual: Boolean(o.manual) });
  }

  /** ⇄：方向对调（见文件头） */
  function swap() {
    const s = get();
    if (s.busy && s.manual) return;
    const dir = s.dir === 'out' ? 'in' : 'out';
    const patch = { dir, spin: s.spin + 1, msg: '', msgKind: '' };
    const r = s.res;
    autoT = clear(autoT);
    if (!r || staleOf(s.text, r, s.honor)) { set(patch); return; }
    commit();
    if (r.dir === 'in' && r.from && r.from.text) {
      const back = { ...r.from.res, again: false };
      set({ ...patch, text: r.from.text, res: back, failed: false, done: false });
      pending = null;
      return;
    }
    if (r.dir === 'out' && r.vi) {
      const t = r.vi;
      if (r.back) {
        const from = { text: s.text, res: { ...r, from: null } };
        const res = { id: '', dir: 'in', input: t, vi: '', en: '', zh: r.back, back: '', demo: r.demo, again: false, from };
        phrases.remember(t, res);
        pending = null;
        set({ ...patch, text: t, res, failed: false, done: false });
        return;
      }
      set({ ...patch, text: t, done: false });
      request(false);
      return;
    }
    if (r.dir === 'in' && r.zh) {
      set({ ...patch, text: r.zh, done: false });
      request(false);
      return;
    }
    set(patch);
  }

  function setHonor(id) {
    const s = get();
    if (s.busy && s.manual) return;
    const honor = phrases.setHonor(id);
    set({ honor, failed: false });
  }

  /** 收藏 / 取消收藏结果卡这一条；返回 { on, dropped } */
  function toggleStar() {
    const r = get().res;
    if (!r || !r.input) return null;
    commit();
    const on = !phrases.starred(r.input);
    let dropped = false;
    if (on) dropped = phrases.star(r).dropped;
    else phrases.unstar(r.input);
    return { on, dropped };
  }

  /** 列表里那一行的星 */
  function toggleStarRow(row) {
    if (!row) return null;
    const on = !phrases.starred(row.input);
    let dropped = false;
    if (on) dropped = phrases.star(row).dropped;
    else phrases.unstar(row.input);
    return { on, dropped };
  }

  /** 点开一条（收藏、最近翻过）：成了下面的结果卡 */
  function openRow(row) {
    if (!row) return;
    commit();
    drop();
    const s = get();
    const dir = row.dir === 'in' ? 'in' : 'out';
    set({
      text: row.input, res: { ...row, again: false, from: null, picked: true }, failed: false, busy: false, manual: false, msg: '', msgKind: '',
      done: true, dir, spin: dir !== s.dir ? s.spin + 1 : s.spin,
    });
    onShown(get().res, { manual: false, opened: true });
  }

  function remove(id) {
    if (!id) return;
    phrases.remove(id);
    const r = get().res;
    if (r && r.id === id) set({ res: null });
  }

  /** 复制 / 给对方看之前：边打边翻的结果先记下来；返回这条（带 id） */
  function keep() {
    const row = commit();
    const r = get().res;
    if (row) return row;
    if (r && r.id) return r;
    // 拿出来的是这次打开翻过的（没进历史）：现在记一条
    if (r && r.input) {
      const saved = phrases.save(r.input, r);
      if (saved) set({ res: { ...r, id: saved.id } });
      return saved;
    }
    return null;
  }

  /** 粘贴进来：马上翻 */
  function paste(t) {
    const v = Array.from(String(t || '')).slice(0, MAX_CHARS).join('');
    if (!v.trim()) {
      set({ msg: L.pasteNone, msgKind: 'soft' });
      return false;
    }
    set({ text: v, done: false, msg: '', msgKind: '' });
    request(true);
    return true;
  }

  function dismissMsg() {
    if (get().msg) set({ msg: '', msgKind: '' });
  }

  /** 离开翻译页：看着写完了的就记；正在翻的不作废（翻好了回来结果就在） */
  function leave() {
    autoT = clear(autoT);
    if (pending && finished(pending.input)) commit();
  }

  return {
    state, setTrip, input, blur, go, clear: clearText, swap, setHonor, toggleStar, toggleStarRow, openRow, remove, keep, paste,
    dismissMsg, leave, commit,
    /** 测试用 */
    _pending: () => pending,
  };
}
