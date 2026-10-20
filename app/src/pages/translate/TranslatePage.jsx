// =====================================================================
// pages/translate/TranslatePage.jsx：翻译（路由 translate，#/t/:tripId/translate）。照小程序 1.4.5 的翻译栏做，换成网页的组件和「杂志纸本」。
//
// 版式（学 iMessage / 谷歌翻译：要点的都在下面，拇指够得着）：
//   上面随页面滚动的是看的东西：收藏（先露 4 条，「全部」展开）、最近翻过（旧的在上、新的在下）、结果卡（最新的一张紧挨着输入区）；
//   下面固定一块输入区（.tr-dock，浮在底栏上面的一张纸片）：语言栏「中文 ⇄ 越南语 ＋英语」+「对话」；输入框（× 清空、加称呼、粘贴、「翻译」）。
//   键盘弹起时底栏沉下去，输入区整块贴着键盘上沿（overlay/keyboard.js 的 visualViewport 高度）。
// 结果卡：越南语最大（点它 = 给对方看）、一行小字「意思是 …」（回译）、英语；或者翻成的中文。
//   星（收藏）、复制、读出来（这台设备有越南语的声音才有）、「给对方看」排在卡片最下面一行。
//   「给对方看」= sheets/ 的 driver 全屏大字卡（arg `tr.<这条的 id>`，从按钮长出来；刷新、没网也能打开，内容在 localStorage）。
// 「对话」= sheets/converse 全屏分屏（上半屏转 180° 朝着对方）。
// 状态和规则在 controller.js（Node 里测）；接口在 data/translate.js（lib/translate/client.js）。
// 只在越南这类外语行程里有入口（「更多」菜单第一行）；别的行程打开这一页，说一句「这趟不用翻译」。
// =====================================================================

import './translate.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTrip } from '../../data/index.js';
import { translator, phrases, translateDemo } from '../../data/translate.js';
import { translateLang, oneLine, outputOf, HONORS, keyOf } from '../../lib/translate/text.js';
import { SectionHeader } from '../../kit/SectionHeader.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { PageEmptyState, ErrorState } from '../../kit/States.jsx';
import { Button } from '../../ui/Button.jsx';
import { toast } from '../../overlay/toast.js';
import { keyboardState } from '../../overlay/keyboard.js';
import { useKeyboardOpen } from '../../shell/keyboard.js';
import { openDriverCard, openConverse } from '../../sheets/index.js';
import { copyText } from '../../lib/clipboard.js';
import { haptic } from '../../lib/native.js';
import { coarsePointer, prefersReducedMotion, safeAreaInsets } from '../../lib/media.js';
import { href } from '../../router/index.js';
import { usePageChrome } from '../../shell/chrome.js';
import { useSpeech } from '../tips/speech.js';
import { normalizeTipKind, tipLang } from '../tips/model.js';
import { createTranslateController, viewOf, L } from './controller.js';

/** 收藏先露几条 */
const SAVED_SHOW = 4;
/** 输入框最多长到多高（px：5 行 × 25 + 上下留白 19） */
const BOX_MAX = 144;
/** 这趟的常用语先露几条 */
const TIPS_SHOW = 4;
/** 键盘弹起后，顶栏下面到输入区之间不到这么高：结果卡收成紧凑的（只留越南语和「给对方看」） */
const TIGHT_PX = 360;
/** 顶栏一直是胶囊（这一页像聊天：大标题会停在半淡的样子，评审 7） */
const CHROME = { collapse: 'always' };

// 整个页面共用一个（离开再回来：写到一半的字、刚出的结果、语言栏的方向都还在）
let shownHook = null;
let composingNow = false;
const ctl = createTranslateController({
  client: translator,
  phrases,
  isComposing: () => composingNow,
  onShown: (res, o) => shownHook?.(res, o),
});

export default function TranslatePage({ route }) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const trip = store?.trip.value || null;
  const status = store?.status.value || 'idle';
  usePageChrome(CHROME);

  let body;
  if (trip) {
    body = translateLang(trip)
      ? <Translate tripId={tripId} store={store} />
      : (
        <PageEmptyState
          preset="search"
          title="这趟不用翻译"
          description="翻译现在只做了越南语（中文 ⇄ 越南语，带英语）。"
          action={<Button variant="secondary" href={href({ name: 'tips', params: { tripId } })}>去看常用语</Button>}
          testId="tr-none"
        />
      );
  } else if (status === 'missing' || status === 'removed') {
    body = <PageEmptyState preset="notfound" title="找不到这趟行程" testId="tr-missing" />;
  } else if (status === 'error') {
    body = <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="tr-error" />;
  } else {
    body = <span class="visually-hidden" role="status">正在读取…</span>;
  }
  return <div class="tr" data-testid="page-translate">{body}</div>;
}

/** 这趟的越南语常用语（贴士里的）：点一行直接「给对方看」 */
function tripPhrases(store) {
  const tips = store?.view?.tips?.value || [];
  return tips.filter((t) => normalizeTipKind(t.kind) === 'phrase' && t.local_text && t.title && (tipLang(t) || 'vi') === 'vi');
}

function Translate({ tripId, store }) {
  const s = ctl.state.value;
  const v = viewOf(s);
  phrases.version.value;   // 收藏、最近翻过变了就重画
  const pageRef = useRef(null);
  const dockRef = useRef(null);
  const resRef = useRef(null);
  const boxRef = useRef(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [tight, setTight] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [copiedKey, setCopiedKey] = useState('');
  const kbOpen = useKeyboardOpen();
  const kb = keyboardState.value.inset;
  const speech = useSpeech();
  const canPaste = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText);

  // 进来：认这趟行程、预热接口（回到前台再预热一次；4 分钟内只发一次）；离开：看着写完了的记进最近翻过
  useEffect(() => {
    ctl.setTrip(tripId);
    translator.warm({ trip: tripId });
    const onVisible = () => {
      if (document.visibilityState === 'visible') translator.warm({ trip: tripId });
      else ctl.commit();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      ctl.leave();
    };
  }, [tripId]);

  // ---------- 滚到最新的结果：放得下就底边贴着输入区；比能看见的地方高就顶边贴着顶栏下面（越南语那句永远看得见） ----------
  const scrollLatest = (smooth = true) => {
    const card = resRef.current;
    const dock = dockRef.current;
    if (!card || !dock) return;
    const r = card.getBoundingClientRect();
    const topLine = topLineOf();
    const bottomLine = dock.getBoundingClientRect().top - 14;
    const fits = r.height <= bottomLine - topLine;
    const d = Math.round(fits ? r.bottom - bottomLine : r.top - topLine);
    if (Math.abs(d) < 2) return;
    if (!fits || d > 0 || r.top < topLine) {
      window.scrollBy({ top: d, behavior: smooth && !prefersReducedMotion.peek() ? 'smooth' : 'auto' });
    }
  };
  useEffect(() => {
    shownHook = (res, o) => {
      if (o.manual) haptic('light');
      requestAnimationFrame(() => requestAnimationFrame(() => scrollLatest(true)));
    };
    // 回到这一页时有上次的结果：直接停在它那里
    requestAnimationFrame(() => scrollLatest(false));
    return () => { shownHook = null; };
  }, []);

  // 键盘弹起、能看见的地方不够：结果卡收紧（英语、回译、下面一行先收起，越南语和「给对方看」一直看得见）
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const next = kbOpen && dock.getBoundingClientRect().top - topLineOf() < TIGHT_PX;
    if (next !== tight) setTight(next);
  });

  // ---------- 输入区多高：内容最下面垫多高（最后一张卡片停在输入区上面）；内容不够一屏时贴着下面排（像聊天） ----------
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const page = pageRef.current;
    if (!dock || !page || typeof ResizeObserver === 'undefined') return undefined;
    const lay = () => {
      page.style.setProperty('--tr-dock-h', `${Math.round(dock.offsetHeight)}px`);
      const feed = page.firstElementChild;
      if (!feed) return;
      // 键盘开着时不量（输入区被推上去了，量出来的不是平时的位置）
      if (keyboardState.peek().inset > 0) return;
      const top = feed.getBoundingClientRect().top + window.scrollY;
      // 内容最下面 = 输入区上沿再往上 14px
      const min = Math.max(0, Math.round(dock.getBoundingClientRect().top - 14 - top));
      page.style.setProperty('--tr-feed-min', `${min}px`);
    };
    const ro = new ResizeObserver(lay);
    ro.observe(dock);
    window.addEventListener('resize', lay);
    lay();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', lay);
    };
  }, []);

  // 键盘弹起、收起、结果卡收紧 / 放开：最新的结果卡跟着对一下
  useEffect(() => {
    const t = setTimeout(() => scrollLatest(true), 60);
    return () => clearTimeout(t);
  }, [kbOpen, kb > 0, tight]);

  // 输入框自动长高（最多 5 行，再多在框里滚）
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, BOX_MAX)}px`;
  }, [s.text]);

  const saved = phrases.stars();
  const tips = useMemo(() => tripPhrases(store), [store?.view?.tips?.value]);
  const tipRows = tipsOpen ? tips : tips.slice(0, TIPS_SHOW);
  const savedRows = savedOpen ? saved : saved.slice(0, SAVED_SHOW);
  const starKeys = useMemo(() => new Set(saved.map((x) => keyOf(x.input))), [phrases.version.value]);
  const res = s.res;
  // 最近翻过：新的在下面（离输入框近）；正在看的那一条就是下面的结果卡，不重复
  const hist = phrases.list().filter((x) => !res || x.id !== res.id).reverse();
  const empty = !saved.length && !hist.length && !res && !v.waiting;

  // ---------- 动作 ----------
  const blurOnPhone = () => { if (coarsePointer.peek()) boxRef.current?.blur(); };
  const onGo = () => {
    if (ctl.go()) blurOnPhone();
  };
  const onClear = () => {
    ctl.clear();
    boxRef.current?.focus();   // 同步聚焦：iOS 才会弹键盘
  };
  const onSwap = () => {
    haptic('selection');
    ctl.swap();
  };
  const onStar = () => {
    const r = ctl.toggleStar();
    if (!r) return;
    haptic('light');
    if (r.dropped) toast(L.full);
  };
  /** 复制结果的某一段（field：vi / en / zh）；mark：哪个按钮显示「已复制」 */
  const onCopy = (field, mark) => {
    const r = ctl.state.peek().res;
    const t = r && r[field];
    if (!t) return;
    ctl.keep();
    copyText(t, { silent: true }).then((x) => {
      if (!x.ok) return;
      haptic('success');
      setCopiedKey(mark);
      setTimeout(() => setCopiedKey((c) => (c === mark ? '' : c)), 1600);
    });
  };
  const onShow = (e) => {
    if (!v.canShow) return;
    const row = ctl.keep();
    if (!row) return;
    blurOnPhone();
    openDriverCard(`tr.${row.id}`, { trigger: e.currentTarget });
  };
  const onTalk = (e) => {
    ctl.commit();
    blurOnPhone();
    openConverse({ trigger: e.currentTarget });
  };
  const onPaste = () => {
    navigator.clipboard.readText().then((t) => {
      if (ctl.paste(t)) blurOnPhone();
    }, () => toast(L.pasteNone));
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      onGo();
    }
  };

  const busyManual = s.busy && s.manual;
  const out = s.dir === 'out';
  const showTip = !s.text && !s.msg;

  return (
    <div ref={pageRef} class="tr-page" data-kb={kbOpen ? '' : undefined}>
      <div class="tr-feed" data-testid="tr-feed">
        {/* 还没收藏过：先把这趟贴士里的常用语列出来，点一行直接给对方看（贴士页「常用语」同一份） */}
        {!saved.length && tips.length > 0 && (
          <section class="tr-sec" aria-label={L.tips}>
            <SectionHeader
              title={L.tips}
              count={tips.length}
              action={tips.length > TIPS_SHOW
                ? { label: tipsOpen ? L.savedLess : `${L.savedAll} ${tips.length}`, onClick: () => setTipsOpen(!tipsOpen), glyph: tipsOpen ? 'chev-u' : 'chev-d', testId: 'tr-tips-more' }
                : undefined}
            />
            <ul class="tr-list" data-testid="tr-tips">
              {tipRows.map((tip) => <TipRow key={tip.id} tip={tip} />)}
            </ul>
          </section>
        )}

        {saved.length > 0 && (
          <section class="tr-sec" aria-label={L.saved}>
            <SectionHeader
              title={L.saved}
              count={saved.length}
              action={saved.length > SAVED_SHOW
                ? { label: savedOpen ? L.savedLess : `${L.savedAll} ${saved.length}`, onClick: () => setSavedOpen(!savedOpen), glyph: savedOpen ? 'chev-u' : 'chev-d', testId: 'tr-saved-more' }
                : undefined}
            />
            <ul class="tr-list" data-testid="tr-saved">
              {savedRows.map((row) => (
                <PhraseRow key={row.id} row={row} star onOpen={() => ctl.openRow(row)} onStar={() => phrases.unstar(row.id)} />
              ))}
            </ul>
          </section>
        )}

        {hist.length > 0 && (
          <section class="tr-sec" aria-label={L.recent}>
            <SectionHeader title={L.recent} count={hist.length} />
            <ul class="tr-list" data-testid="tr-recent">
              {hist.map((row) => (
                <PhraseRow
                  key={row.id}
                  row={row}
                  star={starKeys.has(keyOf(row.input))}
                  onOpen={() => ctl.openRow(row)}
                  onStar={() => { const r = ctl.toggleStarRow(row); if (r?.dropped) toast(L.full); }}
                  onDelete={() => ctl.remove(row.id)}
                />
              ))}
            </ul>
          </section>
        )}

        {empty && (
          <div class="tr-empty" data-testid="tr-empty">
            <p class="tr-empty__t">{L.empty}</p>
            <p class="tr-empty__s">{L.emptySub}</p>
          </div>
        )}

        {v.waiting && (
          <div ref={resRef} class="tr-res" data-going="" data-testid="tr-waiting" aria-label={L.busy}>
            <span class="tr-res__line" aria-hidden="true" />
            <p class="tr-k">{out ? L.vi : L.zh}</p>
            <span class="tr-sk" aria-hidden="true" />
            <span class="tr-sk tr-sk--s" aria-hidden="true" />
          </div>
        )}

        {res && (
          <article
            ref={resRef}
            class="tr-res"
            data-dim={v.dim ? '' : undefined}
            data-going={s.busy ? '' : undefined}
            data-compact={tight ? '' : undefined}
            data-testid="tr-result"
            aria-busy={s.busy ? 'true' : undefined}
          >
            <span class="tr-res__line" aria-hidden="true" />
            {v.old && <p class="tr-prev" data-testid="tr-prev"><b>{L.prev}</b>{res.input}</p>}
            {res.dir === 'out' ? (
              <>
                {/* 「给对方看」和越南语在同一处：键盘弹起、卡片收紧时也一直看得见（评审 1） */}
                <div class="tr-res__head">
                  <p class="tr-k">{L.vi}</p>
                  {v.canShow && (
                    <button
                      type="button"
                      class="tr-btn tr-btn--show"
                      data-press="scale"
                      data-overlay-trigger="driver"
                      onClick={onShow}
                      data-testid="tr-show"
                    >
                      <Glyph name="show" size={18} />
                      <span>{L.show}</span>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  class="tr-vi"
                  lang="vi"
                  data-press={v.canShow ? 'scale' : undefined}
                  aria-disabled={v.canShow ? undefined : 'true'}
                  aria-label={v.canShow ? `${res.vi}（点了给对方看）` : res.vi}
                  data-overlay-trigger="driver"
                  onClick={onShow}
                  data-testid="tr-vi"
                >
                  {res.vi}
                </button>
                {res.back && (
                  <p class="tr-back tr-more" data-testid="tr-back"><b>{L.back}</b>{res.back}</p>
                )}
                {res.en && (
                  <div class="tr-en tr-more">
                    <div class="tr-en__head">
                      <p class="tr-k">{L.en}</p>
                      <button type="button" class="tr-mini" data-press="scale" onClick={() => onCopy('en', 'en')} data-done={copiedKey === 'en' ? '' : undefined} data-testid="tr-copy-en" aria-label={`${L.copy}${L.en}`}>
                        <Glyph name={copiedKey === 'en' ? 'check' : 'copy'} size={16} />
                        <span>{copiedKey === 'en' ? L.copied : L.copy}</span>
                      </button>
                    </div>
                    <p class="tr-en__t" lang="en">{res.en}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <p class="tr-k">{L.zh}</p>
                <p class="tr-zh" data-testid="tr-zh">{res.zh}</p>
              </>
            )}
            <div class="tr-acts tr-more">
              <button
                type="button"
                class="tr-btn tr-btn--icon"
                data-press="scale"
                data-on={phrases.starred(res.input) ? '' : undefined}
                aria-pressed={phrases.starred(res.input) ? 'true' : 'false'}
                aria-label={phrases.starred(res.input) ? L.unstar : L.star}
                onClick={onStar}
                data-testid="tr-star"
              >
                <Glyph name="star" size={20} fill={phrases.starred(res.input) ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                class="tr-btn"
                data-press="scale"
                data-done={copiedKey === 'main' ? '' : undefined}
                onClick={() => onCopy(res.dir === 'out' ? 'vi' : 'zh', 'main')}
                data-testid="tr-copy"
              >
                <Glyph name={copiedKey === 'main' ? 'check' : 'copy'} size={18} />
                <span>{copiedKey === 'main' ? L.copied : res.dir === 'out' ? L.copyVi : L.copy}</span>
              </button>
              {res.dir === 'out' && speech.can('vi') && (
                <button
                  type="button"
                  class="tr-btn"
                  data-press="scale"
                  aria-pressed={speech.speaking === res.vi ? 'true' : 'false'}
                  onClick={() => speech.speak(res.vi, 'vi')}
                  data-testid="tr-speak"
                >
                  <Glyph name="speaker" size={20} />
                  <span>{L.speak}</span>
                </button>
              )}
            </div>
            {(res.again || res.demo || translateDemo) && (
              <p class="tr-foot tr-more">{res.demo || translateDemo ? L.demo : L.again}</p>
            )}
          </article>
        )}

        {showTip && <p class="tr-tip" data-testid="tr-tip">{out ? L.mic : L.micIn}</p>}
      </div>

      {/* ============ 输入区：浮在底栏上面；键盘弹起时贴着键盘 ============ */}
      <div
        ref={dockRef}
        class="tr-dock"
        data-kb={kbOpen ? '' : undefined}
        style={kb > 0 ? { bottom: `${kb + 8}px` } : undefined}
        data-testid="tr-dock"
      >
        {s.msg && (
          <p key="msg" class="tr-msg" data-kind={s.msgKind} role={s.msgKind === 'bad' || s.msgKind === 'offline' ? 'alert' : 'status'} data-testid="tr-msg">
            {s.msg}
          </p>
        )}
        {/* key：上面那行提示出现 / 消失时输入框还是同一个元素（焦点、键盘不丢） */}
        <div key="top" class="tr-top">
          <div class="tr-lang" role="group" aria-label="翻译方向">
            <button type="button" class="tr-lang__s" tabIndex={-1} aria-hidden="true" onClick={() => setNudge((n) => n + 1)}>
              <span key={`a${s.spin}`} class="tr-lang__t">{out ? L.zh : L.vi}</span>
            </button>
            <button
              type="button"
              class="tr-swap"
              data-press="scale"
              data-nudge={nudge ? String(nudge % 2) : undefined}
              aria-label={`${L.swap}：现在是${out ? '中文翻成越南语' : '越南语、英语翻成中文'}`}
              disabled={busyManual}
              onClick={onSwap}
              data-testid="tr-swap"
            >
              <span class="tr-swap__i" style={{ transform: `rotate(${s.spin * 180}deg)` }}>
                <Glyph name="swap" size={18} stroke={2} />
              </span>
            </button>
            <button type="button" class="tr-lang__s tr-lang__s--r" tabIndex={-1} aria-hidden="true" onClick={() => setNudge((n) => n + 1)}>
              <span key={`b${s.spin}`} class="tr-lang__t">
                {out ? L.vi : L.zh}
                {out && <small>{L.plusEn}</small>}
              </span>
            </button>
          </div>
          <button type="button" class="tr-talk" data-press="scale" data-overlay-trigger="converse" onClick={onTalk} data-testid="tr-talk">
            <Glyph name="message" size={18} />
            <span>{L.talk}</span>
          </button>
        </div>

        <div key="box" class="tr-box">
          <textarea
            ref={boxRef}
            class="tr-in"
            rows={1}
            value={s.text}
            maxLength={300}
            placeholder={out ? L.ph : L.phIn}
            aria-label={out ? L.ph : L.phIn}
            enterKeyHint="go"
            autocomplete="off"
            spellcheck={false}
            lang={out ? 'zh-CN' : 'vi'}
            onInput={(e) => ctl.input(e.currentTarget.value, e.currentTarget.selectionEnd)}
            onCompositionStart={() => { composingNow = true; }}
            onCompositionEnd={(e) => { composingNow = false; ctl.input(e.currentTarget.value, e.currentTarget.selectionEnd); }}
            onFocus={() => translator.warm({ trip: tripId })}
            onBlur={() => ctl.blur()}
            onKeyDown={onKey}
            data-testid="tr-input"
          />
          {s.text && (
            <button type="button" class="tr-x" data-press="scale" aria-label={L.clear} onPointerDown={(e) => e.preventDefault()} onClick={onClear} data-testid="tr-clear">
              <Glyph name="x" size={16} stroke={2.2} />
            </button>
          )}
          <div class="tr-bar">
            {out && (
              <label class="tr-honor" data-on={s.honor ? '' : undefined} data-press="scale">
                <span>{s.honor ? `${L.honorPre}${HONORS.find((h) => h.id === s.honor)?.label || ''}` : L.honorNone}</span>
                <Glyph name="chev-d" size={14} stroke={2.2} />
                <select
                  value={s.honor}
                  aria-label="对方称呼"
                  disabled={busyManual}
                  onChange={(e) => ctl.setHonor(e.currentTarget.value)}
                  data-testid="tr-honor"
                >
                  {HONORS.map((h) => <option key={h.id} value={h.id}>{h.id ? `${h.label}（${h.vi}）` : h.label}</option>)}
                </select>
              </label>
            )}
            {canPaste && !s.text && (
              <button type="button" class="tr-honor" data-press="scale" onClick={onPaste} data-testid="tr-paste">{L.paste}</button>
            )}
            {v.left && <span class="tr-left">{v.left}</span>}
            <span class="tr-bar__sp" />
            <button
              type="button"
              class="tr-go"
              data-press="scale"
              data-off={v.goOff && !busyManual ? '' : undefined}
              data-busy={busyManual ? '' : undefined}
              aria-disabled={busyManual || v.goOff ? 'true' : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={onGo}
              data-testid="tr-go"
            >
              {busyManual && <span class="tr-go__spin" aria-hidden="true" />}
              <span>{busyManual ? L.busy : L.go}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 顶栏（一直是胶囊）下沿：--topbar-h + 刘海 + 8 */
function topLineOf() {
  const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 70;
  return topbar + (safeAreaInsets().top || 0) + 8;
}

/** 这趟的一句常用语：点了直接全屏给对方看（driver 弹层，arg 是贴士 id；和贴士页同一个） */
function TipRow({ tip }) {
  return (
    <li class="tr-row">
      <button
        type="button"
        class="tr-row__m"
        data-press="scale"
        data-overlay-trigger="driver"
        data-overlay-arg={tip.id}
        aria-label={`${tip.title}：${tip.local_text}（点了给对方看）`}
        onClick={(e) => {
          haptic('light');
          openDriverCard(tip.id, { trigger: e.currentTarget });
        }}
        data-testid="tr-tip-row"
      >
        <span class="tr-row__t">{oneLine(tip.title)}</span>
        <span class="tr-row__s" lang="vi">{oneLine(tip.local_text)}</span>
      </button>
      <span class="tr-row__i" aria-hidden="true"><Glyph name="show" size={18} /></span>
    </li>
  );
}

/** 收藏、最近翻过的一行：点了成为下面的结果卡；右边星（和 ×） */
function PhraseRow({ row, star, onOpen, onStar, onDelete }) {
  return (
    <li class="tr-row">
      <button type="button" class="tr-row__m" data-press="scale" onClick={onOpen} data-testid="tr-row">
        <span class="tr-row__t">{oneLine(row.input)}</span>
        <span class="tr-row__s" lang={row.dir === 'in' ? 'zh-CN' : 'vi'}>{oneLine(outputOf(row))}</span>
      </button>
      <button
        type="button"
        class="tr-row__b"
        data-press="scale"
        data-on={star ? '' : undefined}
        aria-pressed={star ? 'true' : 'false'}
        aria-label={star ? L.unstar : L.star}
        onClick={onStar}
        data-testid="tr-row-star"
      >
        <Glyph name="star" size={18} fill={star ? 'currentColor' : 'none'} />
      </button>
      {onDelete && (
        <button type="button" class="tr-row__b" data-press="scale" aria-label={L.del} onClick={onDelete} data-testid="tr-row-del">
          <Glyph name="x" size={16} stroke={2} />
        </button>
      )}
    </li>
  );
}

