// =====================================================================
// sheets/converse/ConverseSheet.jsx：翻译的对话模式（弹层 id: converse，全屏；学苹果翻译的「面对面」，照小程序 1.4.5 的 trip-converse）。
//
//   全屏分成上下两半：上半屏转 180° 朝着对面的人（越南语大字），下半屏是我（中文）。双方的话都翻成对方的语言，落在对方那半屏；按轮次排。
//   全由我来操作（对方不用碰手机）：我这半屏下面两个按钮「我说」「对方说」——
//     手机能语音识别（iOS Safari 的 webkitSpeechRecognition，lib/translate/listen.js）：点了直接听，不弹键盘——
//       我说听中文、对方说听越南语，一句说完自动停、自动翻；点输入框或「打字」随时改成打字；话筒用不了退回键盘方式。
//     不能语音识别（键盘方式）：
//     我说：输入框弹键盘，打字或点键盘话筒说中文；
//     对方说：同一个输入框换成「对方说的」，键盘上面一行提示「键盘切到越南语再点话筒」；对方那头（屏幕最上面）一颗小胶囊：
//       三个跳动的点 + 「Mời anh/chị nói」（键盘方式下面再一行越南语「点键盘上的话筒说」），他说的字照着出来。
//   边说边翻：停 0.8 秒自动翻（还在打拼音不翻、以最后一次为准）；收键盘、回车、换人说时这一轮结束（没翻的马上再翻一次），下一句是新的一轮。
//     没翻成的点一下重翻。撞到限频：名额很快空出来就等着自动补发。
//   对方那半屏不滚动：列表贴着他那头排，最新一句永远在他眼前；我这半屏能往回翻，有新的就滚到最下面。
//   第一次打开先讲一遍怎么用（没有越南语键盘去哪里加、对方说英语也行）；中间一排「？」随时再看。
//   横屏（手机横过来）：左右两栏，对方那栏不再倒过来。
//   退出：中间一排的「退出」、Esc、手机返回手势。开着的时候屏幕常亮（Wake Lock，浏览器支持才有）。
//   记录留在这次打开里（关了再进来还在），最多 40 轮，「清空」可以清掉。
// 弹层的基础设施（网址联动、锁滚动、背景 inert、焦点、Esc）和 driver 一样用 overlay/ 的 useOverlayRoute / useLayer / Portal；
// 打开：从「对话」按钮长出来（morphFrom），找不到按钮就淡入。
// =====================================================================

import './converse.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Portal, OverlayContext, useLayer, useOpenedGate, useOverlayRoute, findTrigger, anchorRect, uid, viewportInfo, fadeTo, prepareHidden, setPageCovered,
} from '../../overlay/index.js';
import { keyboardState, watchKeyboard } from '../../overlay/keyboard.js';
import { morphFrom } from '../../motion/morph.js';
import { animateTween } from '../../motion/animate.js';
import { prefersReducedMotion, coarsePointer } from '../../lib/media.js';
import { canListen, listen } from '../../lib/translate/listen.js';
import { haptic } from '../../lib/native.js';
import { local } from '../../lib/storage.js';
import { keyOf, composing, text as clean } from '../../lib/translate/text.js';
import { translator, phrases } from '../../data/translate.js';
import { route } from '../../router/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { rowsOf, tail, CL, KEEP } from './model.js';

const TALK_MS = 800;        // 停多久自动翻
const BLUR_GAP = 150;       // 收键盘后等一下再算「这一轮结束」：点「对方说」「我说」切换时不先闪回两个按钮
const RATE_MS = 15000;      // 撞到限频：15 秒内能发就等着自动补发，不算没翻成
const INTRO_KEY = 'translate:converse-intro';

// 这次打开期间的对话（关了再进来还在）
const store = { turns: [], seq: 0 };

export default function ConverseSheet() {
  const ov = useOverlayRoute('converse', { kind: 'menu' });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <ConverseLayer ov={ov} />
    </Portal>
  );
}

function ConverseLayer({ ov }) {
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const headRef = useRef(null);
  const inRef = useRef(null);
  const meListRef = useRef(null);
  const anchorEl = useRef(null);
  const token = useRef(0);
  const titleId = useMemo(() => uid('cv-title'), []);
  const [ver, setVer] = useState(0);
  const [active, setActive] = useState('');       // 谁在说：'' / 'me' / 'them'
  const [mode, setMode] = useState('type');       // 'voice'：直接听；'type'：键盘
  const [note, setNote] = useState('');           // 一句提示（没听到、话筒用不了）
  const activeRef = useRef('');
  activeRef.current = active;
  const voiceOk = canListen({ coarse: coarsePointer.value });
  const [draft, setDraft] = useState('');
  const [intro, setIntro] = useState(() => !local.get(INTRO_KEY, ''));
  const covered = useRef(false);
  const gate = useOpenedGate(() => cover(true));
  const tripId = route.value?.params?.tripId || undefined;
  // 每一轮的「以最后一次为准」、正在说的那一轮、计时器
  const live = useRef({ drafts: { me: null, them: null }, runners: {}, timers: {}, partT: 0, rec: null, recWho: '', recId: 0 });

  const cover = (on) => {
    if (covered.current === on) return;
    covered.current = on;
    setPageCovered(on);
  };
  const render = () => setVer((x) => x + 1);

  // ---------- 进出场（和 driver 一样：从按钮长出来；减弱动态效果只淡入淡出） ----------
  useLayoutEffect(() => {
    const el = findTrigger('converse');
    anchorEl.current = el && el.isConnected ? el : null;
    prepareHidden(cardRef.current);
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    const reduced = prefersReducedMotion.peek();
    token.current += 1;
    const my = token.current;
    if (ov.open) {
      gate.reset();
      translator.warm({ trip: tripId });
      const el = anchorEl.current;
      const r = !reduced && el && el.isConnected ? el.getBoundingClientRect() : null;
      const visible = r && r.width > 0 && r.bottom > 0 && r.top < viewportInfo().height;
      const fade = animateTween(card, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 'fast' : 'base', easing: 'out', channel: 'cv-fade', commit: 'final' });
      if (visible) {
        const anim = morphFrom(card, anchorRect(el), { mode: 'clip', spring: 'smooth', fadeShadow: false, content: '.cv-half, .cv-mid', contentFade: 'shape' });
        anim.finished.then((done) => done && my === token.current && gate.open());
      } else {
        fade.finished.then((done) => done && my === token.current && gate.open());
      }
    } else {
      cover(false);
      endTurn('me');
      endTurn('them');
      fadeTo(card, 0, reduced ? 'reduced' : 'out', { channel: 'cv-fade' }).finished.then((done) => {
        if (done && my === token.current) ov.onExited();
      });
    }
  }, [ov.open]);

  useEffect(() => () => {
    cover(false);
    const L = live.current;
    stopVoice();
    Object.values(L.timers).forEach((t) => clearTimeout(t));
    clearTimeout(L.partT);
  }, []);

  // 屏幕常亮（浏览器支持才有；切到后台会自动释放，回来再要一次）
  useEffect(() => {
    if (!ov.open || typeof navigator === 'undefined' || !navigator.wakeLock) return undefined;
    let lock = null;
    let gone = false;
    const take = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then((l) => { if (gone) l.release(); else lock = l; }, () => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', take);
      lock?.release?.().catch?.(() => {});
    };
  }, [ov.open]);

  // 键盘：整块往上让（我这半屏的输入框贴着键盘）
  useEffect(() => watchKeyboard(), []);
  const kb = keyboardState.value.inset;

  useLayer(ov, { layerRef, focusRef: cardRef, closeOnEsc: true, initialFocus: () => headRef.current });
  const close = () => ov.requestClose('button');
  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close, whenOpened: gate.whenOpened }), [ov.sheetId, ov.arg]);

  // ---------- 一轮一轮 ----------
  /** 把这一边输入框里的字翻了（这一轮没有就开一轮）；同一句不重发（上次没翻成的照样再翻）。manual = 这一轮说完了 */
  function say(who, src0, manual) {
    const src = clean(src0);
    if (!src) return;
    const L = live.current;
    let d = L.drafts[who];
    if (!d) {
      const id = `c${Date.now().toString(36)}${(store.seq++).toString(36)}`;
      d = L.drafts[who] = { id, key: '' };
      L.runners[id] = translator.runner();
      store.turns.push({ id, who, src, res: null, live: true, fail: false });
      while (store.turns.length > KEEP) {
        const old = store.turns.shift();
        delete L.runners[old.id];
      }
    }
    const turn = store.turns.find((t) => t.id === d.id);
    if (!turn) return;
    const key = keyOf(src);
    turn.src = src;
    if (d.key === key && !turn.fail) { render(); return; }
    d.key = key;
    turn.live = true;
    turn.fail = false;
    render();
    run(turn, manual);
  }

  function run(turn, manual) {
    const L = live.current;
    clearTimeout(L.timers[`r${turn.id}`]);
    const runner = L.runners[turn.id] || (L.runners[turn.id] = translator.runner());
    const hit = phrases.peek(turn.src);
    if (hit) {
      runner.cancel();
      turn.res = hit;
      turn.live = false;
      render();
      return;
    }
    runner.run(turn.src, { auto: !manual, trip: tripId }).then((r) => {
      phrases.remember(turn.src, r);
      turn.res = r;
      turn.live = false;
      turn.fail = false;
      render();
      haptic('light');
    }, (e) => {
      if (e && e.code === 'stale') return;
      if (e && e.code === 'rate' && e.wait > 0 && e.wait <= RATE_MS) {
        L.timers[`r${turn.id}`] = setTimeout(() => run(turn, manual), e.wait);
        return;
      }
      turn.live = false;
      turn.fail = true;
      render();
    });
  }

  /** 停掉正在听的（作废它之后的回调：换人说时旧的那次 onEnd 晚到，不能把新的一轮也结束掉） */
  function stopVoice() {
    const L = live.current;
    if (!L.rec) return;
    L.recId += 1;
    const r = L.rec;
    L.rec = null;
    L.recWho = '';
    r.stop();
  }

  /** 这一轮结束：没翻的马上再翻，输入框清空，下一句是新的一轮 */
  function endTurn(who) {
    if (!who) return;
    const L = live.current;
    if (L.recWho === who) stopVoice();
    clearTimeout(L.timers[who]);
    const el = inRef.current;
    const cur = activeRef.current;
    const v = cur === who && el ? el.value : '';
    if (clean(v)) say(who, v, true);
    L.drafts[who] = null;
    if (cur === who) {
      setDraft('');
      if (el) el.value = '';
    }
  }

  /** 直接听：边听边出字、停一下先翻；一句说完（自动停）这一轮结束 */
  function startVoice(who) {
    const L = live.current;
    stopVoice();
    L.recId += 1;
    const id = L.recId;
    L.recWho = who;
    L.rec = listen({
      lang: who === 'them' ? 'vi-VN' : 'zh-CN',
      onText: (t) => {
        if (id !== L.recId) return;
        const el = inRef.current;
        if (el) el.value = t;
        setDraft(t);
        clearTimeout(L.timers[who]);
        L.timers[who] = setTimeout(() => say(who, t, false), TALK_MS);
      },
      onEnd: (reason) => {
        if (id !== L.recId) return;
        L.rec = null;
        L.recWho = '';
        if (reason === 'denied' || reason === 'fail') {
          // 话筒用不了：留在这一轮，改成打字（点输入框弹键盘；异步里叫不出键盘）
          setMode('type');
          setNote(CL.micOff);
          return;
        }
        endTurn(who);
        if (activeRef.current === who) setActive('');
        if (reason === 'quiet') setNote(CL.quiet);
      },
    });
  }

  /** 听着的时候点输入框 / 「打字」：停下来改成打字（同步聚焦，iOS 才会弹键盘） */
  const toType = () => {
    if (mode !== 'voice') return;
    stopVoice();
    setMode('type');
    setNote('');
    inRef.current?.focus();
  };

  /** 我说 / 对方说：同步聚焦（iOS 才会弹键盘） */
  const start = (who) => {
    if (active && active !== who) endTurn(active);
    clearTimeout(live.current.timers.blur);
    setIntro(false);
    setNote('');
    setActive(who);
    activeRef.current = who;
    setDraft('');
    const el = inRef.current;
    if (el) el.value = '';
    if (voiceOk) {
      // 直接听：不弹键盘（正在打字的先收起）
      setMode('voice');
      if (el && document.activeElement === el) el.blur();
      startVoice(who);
    } else {
      setMode('type');
      el?.focus();
    }
    haptic('selection');
  };

  const onInput = (e) => {
    const v = e.currentTarget.value;
    const cursor = e.currentTarget.selectionEnd;
    const who = active;
    setDraft(v);
    const L = live.current;
    clearTimeout(L.timers[who]);
    if (!v.trim() || !who) return;
    L.timers[who] = setTimeout(() => {
      if (who === 'me' && composing(v, cursor, 'out')) return;
      say(who, v, false);
    }, TALK_MS);
  };

  const onBlur = () => {
    if (mode === 'voice') return;
    const who = active;
    endTurn(who);
    clearTimeout(live.current.timers.blur);
    live.current.timers.blur = setTimeout(() => {
      if (document.activeElement !== inRef.current) setActive('');
    }, BLUR_GAP);
  };

  const retry = (tid) => {
    const turn = store.turns.find((t) => t.id === tid);
    if (!turn || !turn.fail) return;
    turn.fail = false;
    turn.live = true;
    render();
    run(turn, true);
  };

  const clearAll = () => {
    endTurn(active);
    setActive('');
    store.turns = [];
    live.current.drafts = { me: null, them: null };
    live.current.runners = {};
    render();
  };

  const help = () => {
    if (active) { endTurn(active); inRef.current?.blur(); }
    setNote('');
    setActive('');
    setIntro(true);
  };
  const introOk = () => {
    local.set(INTRO_KEY, '1');
    setIntro(false);
  };

  // 我这半屏：有新的就滚到最下面
  const rows = rowsOf(store.turns);
  useLayoutEffect(() => {
    const el = meListRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
  }, [ver, kb > 0]);

  // 他正在说的那一轮：他的原话在他那头的胶囊里，列表里先藏起来
  const themDraft = live.current.drafts.them;
  const themHide = active === 'them' && themDraft ? `t${themDraft.id}` : '';
  const themTail = active === 'them' ? tail(draft) : '';

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer cv-layer"
        data-overlay-layer=""
        data-kind="menu"
        data-sheet-id="converse"
        data-state={ov.open ? 'open' : 'closing'}
        style={{ zIndex: ov.z }}
      >
        <section
          ref={cardRef}
          class="cv"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-active={active || undefined}
          data-kb={kb > 0 ? '' : undefined}
          style={kb > 0 ? { paddingBottom: `${kb}px` } : undefined}
          data-testid="converse"
        >
          {/* 对方：转 180°；列表贴着他那头排，不滚动，最新一句永远在他眼前 */}
          <div class="cv-half cv-them" lang="vi" data-testid="cv-them">
            <p class="cv-head">{CL.them}</p>
            <div class="cv-list cv-list--fixed">
              {!rows.them.length && (
                <div class="cv-hi">
                  <p class="cv-hi__t">{CL.themHi}</p>
                  <p class="cv-hi__s" lang="en">{CL.themHiEn}</p>
                </div>
              )}
              {rows.them.filter((x) => x.id !== themHide).map((x) => <Turn key={x.id} row={x} />)}
            </div>
            <div class="cv-foot" aria-live="polite">
              {active === 'them' && (
                <p class="cv-listen" data-testid="cv-listen">
                  <span class="cv-dots" aria-hidden="true"><i /><i /><i /></span>
                  <span data-on={themTail ? '' : undefined}>{themTail || CL.themListen}</span>
                </p>
              )}
              {active === 'them' && mode === 'type' && !themTail && (
                <p class="cv-listen-kb" data-testid="cv-listen-kb">{CL.themKb}</p>
              )}
            </div>
          </div>

          {/* 中间一排（我这边看得懂的）：退出 / 清空 / 怎么用 */}
          <div class="cv-mid">
            <h2 ref={headRef} id={titleId} class="visually-hidden" tabIndex={-1}>对话</h2>
            <button type="button" class="cv-btn" data-press="scale" onClick={close} data-testid="cv-close">
              <Glyph name="x" size={18} stroke={2.1} />
              <span>{CL.close}</span>
            </button>
            {store.turns.length > 0 && (
              <button type="button" class="cv-btn" data-press="scale" onClick={clearAll} data-testid="cv-clear">
                <Glyph name="trash" size={18} />
                <span>{CL.clear}</span>
              </button>
            )}
            <button type="button" class="cv-btn cv-btn--q" data-press="scale" aria-label={CL.help} onClick={help} data-testid="cv-help">
              <span aria-hidden="true">?</span>
            </button>
          </div>

          {/* 我 */}
          <div class="cv-half cv-me" data-testid="cv-me">
            <p class="cv-head">{CL.me}</p>
            <div ref={meListRef} class="cv-list">
              {!rows.me.length && (
                <div class="cv-hi">
                  <p class="cv-hi__t">{CL.meHi}</p>
                  <p class="cv-hi__s">{CL.meHiSub}</p>
                </div>
              )}
              {rows.me.map((x) => <Turn key={x.id} row={x} onRetry={x.fail ? () => retry(x.tid) : undefined} />)}
            </div>

            {active && mode === 'voice' && (
              <p key="voice" class="cv-kbtip cv-kbtip--voice" data-testid="cv-voicetip">
                <span class="cv-rec" aria-hidden="true" />
                <span>{active === 'them' ? CL.voiceThem : CL.voiceMe}</span>
                <button type="button" class="cv-type" data-press="scale" onPointerDown={(e) => e.preventDefault()} onClick={toType} data-testid="cv-type">{CL.typeInstead}</button>
              </p>
            )}
            {active === 'them' && mode === 'type' && !note && <p key="kb" class="cv-kbtip" data-testid="cv-kbtip">{CL.kbTip}</p>}
            {note && <p key="note" class="cv-kbtip cv-kbtip--note" role="status" data-testid="cv-note">{note}</p>}
            {/* key：前面几行提示有的出现、有的消失时，输入框还是同一个元素（不然焦点会丢，键盘收回去） */}
            <div key="box" class="cv-box" data-on={active ? '' : undefined} data-who={active || undefined}>
              <textarea
                ref={inRef}
                class="cv-in"
                rows={1}
                maxLength={300}
                placeholder={active === 'them' ? CL.themPh : CL.mePh}
                aria-label={active === 'them' ? CL.themPh : CL.mePh}
                lang={active === 'them' ? 'vi' : 'zh-CN'}
                enterKeyHint="done"
                tabIndex={active ? 0 : -1}
                onFocus={toType}
                onInput={onInput}
                onBlur={onBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    endTurn(active);
                  }
                }}
                data-testid="cv-input"
              />
              <button
                type="button"
                class="cv-sw"
                data-press="scale"
                tabIndex={active ? 0 : -1}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => start(active === 'them' ? 'me' : 'them')}
                data-testid="cv-switch"
              >
                {active === 'them' ? CL.meSay : CL.themSay}
              </button>
            </div>
            {!active && (
              <div key="acts" class="cv-acts">
                <button type="button" class="cv-act" data-press="scale" onClick={() => start('me')} data-testid="cv-me-say">
                  <Glyph name="mic" size={20} />
                  <span>{CL.meSay}</span>
                </button>
                <button type="button" class="cv-act cv-act--them" data-press="scale" onClick={() => start('them')} data-testid="cv-them-say">
                  <Glyph name="mic" size={20} />
                  <span>{CL.themSay}</span>
                </button>
              </div>
            )}

            {intro && (
              <div class="cv-intro" role="group" aria-label={CL.introT} data-testid="cv-intro">
                <p class="cv-intro__t">{CL.introT}</p>
                <ol class="cv-intro__l">
                  <li><b>{CL.i1}</b><span>{CL.i1s}</span></li>
                  <li><b>{CL.i2}</b><span>{voiceOk ? CL.i2sVoice : CL.i2s}</span></li>
                  {voiceOk
                    ? <li><b>{CL.i4}</b></li>
                    : <li><b>{CL.i3}</b><span>{CL.i3s}</span><span>{CL.i4}</span></li>}
                </ol>
                <button type="button" class="cv-intro__ok" data-press="scale" onClick={introOk} data-testid="cv-intro-ok">{CL.ok}</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </OverlayContext.Provider>
  );
}

function Turn({ row, onRetry }) {
  const cls = `cv-turn${row.own ? ' cv-turn--own' : ''}${row.last ? ' cv-turn--last' : ''}${row.fail ? ' cv-turn--fail' : ''}`;
  const inner = (
    <>
      <span class="cv-turn__main">
        {row.main}
        {row.live && <span class="cv-caret" aria-hidden="true" />}
      </span>
      {row.sub && <span class="cv-turn__sub" lang="en">{row.sub}</span>}
    </>
  );
  if (onRetry) {
    return <button type="button" class={cls} data-press="scale" onClick={onRetry} data-testid="cv-retry">{inner}</button>;
  }
  return <p class={cls}>{inner}</p>;
}
