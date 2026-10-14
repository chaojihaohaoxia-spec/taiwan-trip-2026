// =====================================================================
// pages/tips/parts.jsx：贴士页的几种卡片。
//
//   TipCard        防坑 / 小贴士 / 实用信息（以及置顶卡里的每一条）：长的用 ui/ExpandableCard 原地展开（页面一个 useAccordion，
//                  一次只开一张；收起时两行预览，展开时预览收起、全文 Markdown 展开）；短的整段直接显示，不做没意义的展开
//   PinnedCard     置顶：最上面一张暖色的卡，里面一行一条
//   TemplateCard   消息模板：用法说明 + 原文（超过 6 行收起，「显示全文」用 motion 的 useHeightFlip 平滑展开）
//                  + 复制原文 / 给对方看 + 能直接发给谁（同一个预订 / 地点的联系人：WhatsApp 预填原文、Zalo 先复制、邮件预填）
//   PhraseCard     常用语：中文 → 大字原文（能读就点一下读出来）→ 复制 / 给对方看；网格里长句占满一行
//   「相关」小胶囊、小标在 common.jsx（联系人页也用）
// 给对方看 = sheets/ 的 driver 弹层（arg 是贴士 id），从按钮长出来。
// =====================================================================

import { useRef, useState } from 'preact/hooks';
import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { MorphIcon } from '../../ui/MorphIcon.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { Highlight } from '../../kit/search/SearchResults.jsx';
import { Markdown } from '../../lib/markdown.js';
import { useCopy, copyText } from '../../lib/clipboard.js';
import { haptic } from '../../lib/native.js';
import { href } from '../../router/index.js';
import { useHeightFlip } from '../../motion/hooks.js';
import { openDriverCard } from '../../sheets/index.js';
import { openLink, RelatedLinks, Tags } from './common.jsx';
import { previewText, needsExpand, isEmergencyTip, langLabel, phraseWide, bodyText, isLongLocal, tipLang } from './model.js';

// ---------------------------------------------------------------------
// 小部件
// ---------------------------------------------------------------------

/** 紧急类贴士：去联系人页看紧急电话 */
function ContactsLink({ tripId }) {
  return (
    <a class="pg-link tp-related__contacts" href={href({ name: 'contacts', params: { tripId }, query: { cat: 'emergency' } })} data-press="scale" data-testid="tip-to-contacts">
      <Glyph name="call" size={15} />
      <span class="pg-link__text">联系人 · 紧急电话</span>
      <Glyph name="chev-r" size={13} stroke={2.2} class="pg-link__chev" />
    </a>
  );
}

/** 复制原文（复制后图标变对勾、字变「已复制」1.6 秒；提示「已复制原文」） */
function CopyLocal({ tip, compact = false }) {
  const { copy, copied } = useCopy();
  return (
    <button
      type="button"
      class={`tp-btn${compact ? ' tp-btn--icon' : ''}`}
      data-press="scale"
      data-done={copied ? '' : undefined}
      aria-label={compact ? `复制原文：${tip.title}` : undefined}
      data-testid={`tip-copy-${tip.id}`}
      onClick={() => {
        // 同步发起（iOS 只认点击回调里直接发起的复制）
        copy(tip.local_text, { label: '原文' }).then((r) => r.ok && haptic('success'));
      }}
    >
      <Glyph name={copied ? 'check' : 'copy'} size={18} stroke={copied ? 2.3 : 1.9} />
      {!compact && <span>{copied ? '已复制' : '复制原文'}</span>}
    </button>
  );
}

/** 给对方看：全屏大字（sheets/ 的 driver 弹层，arg 是贴士 id），从这个按钮长出来 */
function ShowLocal({ tip, grow = false }) {
  return (
    <button
      type="button"
      class={`tp-btn tp-btn--show${grow ? ' tp-btn--grow' : ''}`}
      data-press="scale"
      data-overlay-trigger="driver"
      data-overlay-arg={tip.id}
      data-testid={`tip-show-${tip.id}`}
      onClick={(e) => {
        haptic('light');
        openDriverCard(tip.id, { trigger: e.currentTarget });
      }}
    >
      <Glyph name="show" size={18} />
      <span>给对方看</span>
    </button>
  );
}

/**
 * 原文块：当地语（lang 属性：读屏、断词、字形都对），保留分行；太长先收起，「显示全文」平滑展开（useHeightFlip）。
 */
function LocalText({ tip, ranges, clamp = true }) {
  const ref = useRef(null);
  const capture = useHeightFlip(ref);
  const [open, setOpen] = useState(false);
  const long = clamp && isLongLocal(tip.local_text);
  const code = tipLang(tip);
  const lang = langLabel(code);
  return (
    <div class="tp-local" ref={ref} data-clamped={long && !open ? '' : undefined} data-testid={`tip-local-${tip.id}`}>
      {lang && <span class="tp-local__lang">{lang}原文</span>}
      <p class="tp-local__text" lang={code || undefined}>
        {ranges?.length ? <Highlight text={tip.local_text} ranges={ranges} /> : tip.local_text}
      </p>
      {long && (
        <button
          type="button"
          class="tp-local__more"
          data-press="scale"
          aria-expanded={open ? 'true' : 'false'}
          data-testid={`tip-local-more-${tip.id}`}
          onClick={() => {
            capture();
            setOpen(!open);
          }}
        >
          <span>{open ? '收起' : '显示全文'}</span>
          <MorphIcon kind="chevron" state={open} size={16} />
        </button>
      )}
    </div>
  );
}

const SEND_GLYPH = { whatsapp: 'whatsapp', zalo: 'zalo', email: 'mail' };

/** 能直接发给谁（WhatsApp 预填原文；Zalo 链接不能预填 → 先复制原文再打开；邮件预填标题和原文） */
function SendLinks({ tip, targets }) {
  if (!targets.length) return null;
  return (
    <div class="tp-send" data-testid={`tip-send-${tip.id}`}>
      {targets.map((t) => (
        <a
          key={`${t.key}:${t.contact.id}`}
          class="tp-send__btn"
          href={t.href}
          rel="noopener noreferrer"
          data-press="scale"
          data-send={t.key}
          onClick={(e) => {
            if (t.copyFirst) copyText(tip.local_text, { label: '原文', successMessage: '原文已复制，在 Zalo 里粘贴发送' });
            openLink(t.href, e);
          }}
        >
          <span class={`tp-send__icon tp-send__icon--${t.key}`} aria-hidden="true"><Glyph name={SEND_GLYPH[t.key]} size={18} /></span>
          <span class="tp-send__text">
            <span class="tp-send__label">{t.label}</span>
            <span class="tp-send__to">发给 {t.contact.name}</span>
          </span>
          <Glyph name="external" size={16} class="tp-send__ext" />
        </a>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 贴士卡（防坑 / 小贴士 / 实用信息；置顶卡里的每一条）
// ---------------------------------------------------------------------

/**
 * @param {{ tip, hit, ctx, acc, variant?: 'card'|'row', pinnedTag?: boolean }} props
 *   ctx：{ tripId, related(tip), today(tip), sendTargets(tip), flash }
 */
export function TipCard({ tip, hit, ctx, acc, variant = 'card', pinnedTag = false }) {
  const kind = tip.kind || 'tip';
  const related = ctx.related(tip);
  const today = ctx.today(tip);
  const emergency = isEmergencyTip(tip);
  const title = hit?.title?.length ? <Highlight text={tip.title} ranges={hit.title} /> : tip.title;
  const flash = ctx.flash === tip.id ? '' : undefined;
  const hasLocal = Boolean(tip.local_text);
  const extra = emergency ? <ContactsLink tripId={ctx.tripId} /> : null;
  const expandable = needsExpand(tip) || hasLocal;
  const common = {
    'data-tip-id': tip.id,
    'data-kind': kind,
    'data-testid': `tip-${tip.id}`,
    'data-pg-flash': flash,
  };

  if (!expandable) {
    // 短的：整段直接显示（和展开卡片同样的版式，只是没有箭头）
    return (
      <article class={`tp-tip tp-static tp-static--${variant}`} {...common}>
        <span class="tp-static__lead" aria-hidden="true"><Glyph name={kindGlyph('tip', kind)} size={20} /></span>
        <div class="tp-static__main">
          <div class="tp-static__head">
            <h3 class="tp-static__title">{title}</h3>
            <Tags today={today} pinned={pinnedTag} testId="tip-today" />
          </div>
          {tip.body && <Markdown text={tip.body} class="tp-md tp-static__body" phones />}
          {hit?.snippet && <p class="tp-snippet"><Highlight text={hit.snippet.text} ranges={hit.snippet.ranges} /></p>}
          <RelatedLinks links={related} tripId={ctx.tripId} extra={extra} />
        </div>
      </article>
    );
  }

  const preview = hit?.snippet
    ? <Highlight text={hit.snippet.text} ranges={hit.snippet.ranges} />
    : previewText(tip) || (hasLocal ? tip.local_text : '');
  return (
    <ExpandableCard
      {...acc.bind(tip.id)}
      variant={variant}
      class="tp-tip tp-xtip"
      lazy={!flash}
      leading={<Glyph name={kindGlyph('tip', kind)} size={20} />}
      title={title}
      subtitle={preview ? <span class="tp-preview"><span class="tp-preview__in">{preview}</span></span> : null}
      meta={<Tags today={today} pinned={pinnedTag} testId="tip-today" />}
      {...common}
    >
      <div class="tp-tip__body">
        {tip.body && <Markdown text={tip.body} class="tp-md" phones />}
        {hasLocal && (
          <>
            <LocalText tip={tip} ranges={hit?.local} />
            <div class="tp-acts">
              <CopyLocal tip={tip} />
              <ShowLocal tip={tip} />
            </div>
            <SendLinks tip={tip} targets={ctx.sendTargets(tip)} />
          </>
        )}
        <RelatedLinks links={related} tripId={ctx.tripId} extra={extra} />
      </div>
    </ExpandableCard>
  );
}

/** 置顶：最上面一张暖色的卡，一行一条（行内展开） */
export function PinnedCard({ rows, ctx, acc }) {
  return (
    <section class="tp-pinned" aria-labelledby="tp-pinned-title" data-testid="tips-pinned">
      <header class="tp-pinned__head">
        <span class="tp-pinned__icon" aria-hidden="true"><Glyph name="pin2" size={16} stroke={2} /></span>
        <h2 class="tp-pinned__title" id="tp-pinned-title">置顶提醒</h2>
        <span class="tp-pinned__count">{rows.length} 条</span>
      </header>
      <div class="tp-pinned__list">
        {rows.map(({ tip, hit }) => (
          <TipCard key={tip.id} tip={tip} hit={hit} ctx={ctx} acc={acc} variant="row" />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 消息模板
// ---------------------------------------------------------------------

export function TemplateCard({ tip, hit, ctx, pinnedTag = false }) {
  const related = ctx.related(tip);
  const today = ctx.today(tip);
  const title = hit?.title?.length ? <Highlight text={tip.title} ranges={hit.title} /> : tip.title;
  return (
    <article
      class="tp-tpl"
      data-tip-id={tip.id}
      data-kind="template"
      data-testid={`tip-${tip.id}`}
      data-pg-flash={ctx.flash === tip.id ? '' : undefined}
    >
      <header class="tp-tpl__head">
        <span class="tp-static__lead" aria-hidden="true"><Glyph name={kindGlyph('tip', 'template')} size={20} /></span>
        <div class="tp-tpl__titles">
          <div class="tp-static__head">
            <h3 class="tp-static__title">{title}</h3>
            <Tags today={today} pinned={pinnedTag} testId="tip-today" />
          </div>
          {tip.body && <Markdown text={tip.body} class="tp-md tp-tpl__note" phones />}
          {hit?.snippet && <p class="tp-snippet"><Highlight text={hit.snippet.text} ranges={hit.snippet.ranges} /></p>}
        </div>
      </header>
      {tip.local_text ? (
        <>
          <LocalText tip={tip} ranges={hit?.local} />
          <div class="tp-acts">
            <CopyLocal tip={tip} />
            <ShowLocal tip={tip} />
          </div>
          <SendLinks tip={tip} targets={ctx.sendTargets(tip)} />
        </>
      ) : (
        <p class="tp-tpl__empty">还没有写原文</p>
      )}
      <RelatedLinks links={related} tripId={ctx.tripId} />
    </article>
  );
}

// ---------------------------------------------------------------------
// 常用语
// ---------------------------------------------------------------------

/**
 * 常用语卡：场景小字 → 中文 → 大字原文（这台设备有这种语言的声音时，点原文读出来）→ 说明 → 复制 / 给对方看。
 */
export function PhraseCard({ row, ctx }) {
  const { tip, hit, scene } = row;
  const wide = phraseWide(tip) || String(tip.title || '').length > 14;
  const lang = tipLang(tip) || 'vi';
  const canSpeak = Boolean(tip.local_text) && ctx.speech.can(lang);
  const speaking = canSpeak && ctx.speech.speaking === tip.local_text;
  const title = hit?.title?.length ? <Highlight text={tip.title} ranges={hit.title} /> : tip.title;
  const local = hit?.local?.length ? <Highlight text={tip.local_text} ranges={hit.local} /> : tip.local_text;
  const note = bodyText(tip);
  return (
    <article
      class="tp-phrase"
      data-wide={wide ? '' : undefined}
      data-flip-key={tip.id}
      data-tip-id={tip.id}
      data-kind="phrase"
      data-scene={scene.key}
      data-testid={`tip-${tip.id}`}
      data-pg-flash={ctx.flash === tip.id ? '' : undefined}
    >
      <div class="tp-phrase__top">
        <span class="tp-phrase__scene"><Glyph name={scene.glyph} size={13} stroke={2} />{scene.label}</span>
        <Tags today={ctx.today(tip)} pinned={tip.pinned} testId="tip-today" />
      </div>
      <h3 class="tp-phrase__zh">{title}</h3>
      {tip.local_text && (canSpeak ? (
        <button
          type="button"
          class="tp-phrase__local tp-phrase__local--speak"
          lang={lang}
          data-press="scale"
          data-speaking={speaking ? '' : undefined}
          aria-label={`${speaking ? '停止朗读' : '读出来'}：${tip.local_text}`}
          data-testid={`tip-speak-${tip.id}`}
          onClick={() => {
            haptic('light');
            ctx.speech.speak(tip.local_text, lang);
          }}
        >
          <span>{local}</span>
          <Glyph name="speaker" size={17} class="tp-phrase__speaker" />
        </button>
      ) : (
        <p class="tp-phrase__local" lang={lang}>{local}</p>
      ))}
      {note && <p class="tp-phrase__note">{note}</p>}
      {hit?.snippet && <p class="tp-snippet"><Highlight text={hit.snippet.text} ranges={hit.snippet.ranges} /></p>}
      {tip.local_text && (
        <div class="tp-phrase__acts">
          <CopyLocal tip={tip} compact />
          <ShowLocal tip={tip} grow />
        </div>
      )}
    </article>
  );
}
