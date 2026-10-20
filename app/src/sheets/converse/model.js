// =====================================================================
// sheets/converse/model.js：对话模式的纯逻辑（Node 里测）。
//
//   turns：这次打开期间的对话，一轮 = { id, who: 'me'|'them', src, res, live, fail }
//     res：翻好的结果（lib/translate/text.js 的 shape：dir / vi / en / zh）；live：正在翻；fail：没翻成
//   rowsOf(turns) → { me, them }：两半屏各自显示什么（me 是我这半屏：中文；them 是对方那半屏：越南语）
//     双方的话都翻成对方的语言，落到对方那半屏；自己说的原话也留在自己那半屏（小一号）。
//   tail(s)：对方那头胶囊里只显示他说的最后 60 个字（前面用「…」）
// =====================================================================

export const KEEP = 40;

export const CL = Object.freeze({
  me: '中文', them: 'Tiếng Việt',
  meSay: '我说', themSay: '对方说', mePh: '说中文，或者打字', themPh: '对方说的会出现在这里',
  themHi: 'Xin chào! Điện thoại này sẽ dịch giúp chúng ta.',
  themHiEn: 'Hi! This phone will translate for us.',
  themListen: 'Mời anh/chị nói',
  meHi: '上半屏朝着对方', meHiSub: '轮流点「我说」「对方说」，各看各的',
  kbTip: '键盘切到越南语再点话筒，朝着对方',
  // 直接听（浏览器能语音识别时）：不用切键盘，点「对方说」他直接说
  voiceMe: '在听中文，说完自动翻', voiceThem: '在听越南语，说完自动翻', typeInstead: '打字',
  quiet: '没听到，再点一次', micOff: '话筒用不了，点上面的框打字',
  themKb: 'Nhấn vào micro trên bàn phím để nói',
  close: '退出', clear: '清空', help: '怎么用',
  fail: '没翻成，点一下再试', failVi: 'Chưa dịch được',
  introT: '怎么用',
  i1: '上半屏朝着对方', i1s: '他看越南语，你看中文',
  i2: '轮到对方说', i2s: '点「对方说」，键盘切到越南语，再点话筒',
  i2sVoice: '点「对方说」，手机朝着他，他直接说；说完自动翻',
  i3: '手机里没有越南语键盘', i3s: '设置 › 通用 › 键盘 › 添加新键盘 › 越南语',
  i4: '对方说英语也行',
  ok: '知道了',
});

/** 一轮 → 两半屏各自要显示的 */
export function rowsOf(turns) {
  const n = turns.length;
  const me = [];
  const them = [];
  turns.forEach((t, i) => {
    const r = t.res || {};
    const last = i === n - 1;
    // 这一轮是中文 → 越南语吗（还没出结果时按谁在说猜）
    const out = r.dir ? r.dir !== 'in' : t.who === 'me';
    if (t.who === 'me') {
      me.push({ id: `m${t.id}`, tid: t.id, own: true, main: t.src, sub: '', live: false, fail: false, last });
      them.push({
        id: `t${t.id}`, tid: t.id, own: false,
        main: t.fail ? CL.failVi : out ? r.vi || '' : t.src,
        sub: t.fail || !out ? '' : r.en || '',
        live: Boolean(t.live), fail: Boolean(t.fail), last,
      });
    } else {
      them.push({ id: `t${t.id}`, tid: t.id, own: true, main: t.src, sub: '', live: false, fail: false, last });
      me.push({
        id: `m${t.id}`, tid: t.id, own: false,
        main: t.fail ? CL.fail : out ? t.src : r.zh || '',
        sub: '', live: Boolean(t.live), fail: Boolean(t.fail), last,
      });
    }
  });
  return { me, them };
}

/** 对方那头胶囊里显示的：最后 60 个字 */
export function tail(v) {
  const a = Array.from(String(v || ''));
  return a.length > 60 ? `…${a.slice(-60).join('')}` : a.join('');
}
