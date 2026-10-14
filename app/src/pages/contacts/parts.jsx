// =====================================================================
// pages/contacts/parts.jsx：联系人卡片。
//
//   ContactCard    一个联系人：ui/ExpandableCard（页面一个 useAccordion，一次只开一张）+ 右上 1–2 个快捷圆钮。
//                  快捷圆钮是卡片标题行的“兄弟”（不能把链接放进标题行那个按钮里），绝对定位盖在标题行右上角；
//                  标题文字最前面放一块同样大的浮动空位（.ct-float，float: right）：名字、身份那两行绕开圆钮，
//                  下面的号码、备注又能用满整行（手机上两个圆钮 + 箭头占掉 150px，不绕开的话号码要折成两行）。
//   QuickActions   快捷圆钮：打电话（实心强调色；紧急类是危险色）+ WhatsApp / Zalo（凸起的白）；只有邮箱的给「邮件」
//   ContactDetails 展开后：号码（点了复制，等宽）、带字的大按钮（打电话 / WhatsApp / Zalo / 邮件）、邮箱 / 微信 / LINE、备注、关联
//   NoteText       备注全文；里面写的别的号码（「总机 +84 …」）做成能点的 tel: 链接
// 外链（tel: / wa.me / zalo.me / mailto:）都是真的 <a href>（长按能看到、e2e 能读），点击走 lib/native.js 的 openExternal（同一个窗口：
// iOS 才会唤起电话、WhatsApp、Zalo；以后 iOS 外壳接管）。
// =====================================================================

import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { CopyText } from '../../kit/CopyText.jsx';
import { Highlight } from '../../kit/search/SearchResults.jsx';
import { openLink, RelatedLinks, Tags } from '../tips/common.jsx';
import { channelsOf, numberLines, headlineNumber, subtitleOf, numberLabel, phoneSpans } from './model.js';
import { openContactSheet } from './ContactSheet.jsx';

/** 快捷圆钮的宽（44）和间距（6）：标题文字绕开同样宽的浮动空位 */
const QUICK_SIZE = 44;
const QUICK_GAP = 6;

const ACTION_VERB = { call: '打电话给', whatsapp: 'WhatsApp：', zalo: 'Zalo：', email: '发邮件给' };

/**
 * @param {{ row: { contact, links, hit, cat, today }, ctx: { tripId, flash }, acc }} props
 */
export function ContactCard({ row, ctx, acc }) {
  const { contact: c, links, hit, cat, today } = row;
  const ch = channelsOf(c);
  const quick = ch.quick;
  const emergency = cat === 'emergency';
  const flash = ctx.flash === c.id ? '' : undefined;
  const sub = subtitleOf(c, links);
  const head = headlineNumber(c);
  const name = hit?.name?.length ? <Highlight text={c.name} ranges={hit.name} /> : c.name;
  const spaceW = quick.length ? quick.length * QUICK_SIZE + (quick.length - 1) * QUICK_GAP : 0;

  return (
    <div
      class="ct-card"
      data-cat={cat}
      data-quick={quick.length}
      data-contact-id={c.id}
      data-testid={`contact-${c.id}`}
      data-pg-flash={flash}
    >
      <ExpandableCard
        {...acc.bind(c.id)}
        class="ct-x"
        lazy={!flash}
        leading={<Glyph name={kindGlyph('contact', cat)} size={20} />}
        title={(
          <>
            {quick.length > 0 && <span class="ct-float" aria-hidden="true" style={{ width: `${spaceW}px` }} />}
            <span class="ct-x__name">{name}</span>
            <Tags today={today} testId="contact-today" />
          </>
        )}
        subtitle={(
          <span class="ct-sub">
            {sub && <span class="ct-sub__line">{sub}</span>}
            {head && (
              <span class={`ct-sub__num${head.kind === 'email' ? ' ct-sub__num--email' : ''}`} data-testid="contact-number">
                {head.value}
              </span>
            )}
            {c.note && <span class="ct-sub__note"><span class="ct-sub__note-in">{c.note}</span></span>}
          </span>
        )}
      >
        <ContactDetails contact={c} channels={ch} links={links} tripId={ctx.tripId} emergency={emergency} canEdit={ctx.canEdit} />
      </ExpandableCard>
      {quick.length > 0 && <QuickActions contact={c} actions={quick} emergency={emergency} />}
    </div>
  );
}

/** 收起时右上的快捷圆钮（读屏名字「打电话给椰影湾酒店前台」） */
function QuickActions({ contact: c, actions, emergency }) {
  return (
    <div class="ct-quick" data-testid={`contact-quick-${c.id}`}>
      {actions.map((a, i) => (
        <a
          key={a.key}
          href={a.href}
          class={`ct-qbtn ct-qbtn--${a.key}${i === 0 && a.key === 'call' ? ' ct-qbtn--primary' : ''}${emergency && a.key === 'call' ? ' ct-qbtn--danger' : ''}`}
          rel="noopener noreferrer"
          data-press="scale"
          data-contact-action={a.key}
          aria-label={`${ACTION_VERB[a.key] || a.label}${c.name}`}
          onClick={(e) => openLink(a.href, e)}
        >
          <Glyph name={a.glyph} size={20} stroke={a.key === 'call' ? 2 : 1.9} />
        </a>
      ))}
    </div>
  );
}

/** 展开后的详情 */
function ContactDetails({ contact: c, channels, links, tripId, emergency, canEdit }) {
  const numbers = numberLines(c);
  const others = channels.copies.filter((x) => x.key !== 'number');
  const inferred = channels.actions.some((a) => a.inferred);
  return (
    <div class="ct-body" data-testid={`contact-body-${c.id}`}>
      {numbers.length > 0 && (
        <ul class="ct-nums" aria-label="号码">
          {numbers.map((n) => (
            <li key={n.key} class="ct-num">
              <span class="ct-num__label">{[n.label, ...(n.also || [])].join(' · ')}</span>
              <CopyText text={n.value} label="号码" mono class="ct-num__copy" data-testid={`contact-copy-${n.key}`}>
                {numberLabel(n.value)}
              </CopyText>
            </li>
          ))}
        </ul>
      )}

      {channels.actions.length > 0 && (
        <div class="ct-acts" style={{ '--ct-cols': Math.min(channels.actions.length, 4) }} data-testid={`contact-actions-${c.id}`}>
          {channels.actions.map((a) => (
            <a
              key={a.key}
              href={a.href}
              class={`ct-act ct-act--${a.key}${a.key === 'call' ? ' ct-act--primary' : ''}${emergency && a.key === 'call' ? ' ct-act--danger' : ''}`}
              rel="noopener noreferrer"
              data-press="scale"
              data-contact-action={a.key}
              data-inferred={a.inferred ? '' : undefined}
              aria-label={`${ACTION_VERB[a.key] || a.label}${c.name}${a.inferred ? '（按手机号在 Zalo 里找）' : ''}`}
              onClick={(e) => openLink(a.href, e)}
            >
              <span class="ct-act__icon" aria-hidden="true"><Glyph name={a.glyph} size={20} stroke={a.key === 'call' ? 2 : 1.9} /></span>
              <span class="ct-act__label">{a.label}</span>
            </a>
          ))}
        </div>
      )}
      {inferred && <p class="ct-hint">越南的手机号一般都开着 Zalo：点「Zalo」按这个号码找人。</p>}

      {others.length > 0 && (
        <ul class="ct-ids" aria-label="其他联系方式">
          {others.map((x) => (
            <li key={x.key} class="ct-id">
              <span class="ct-num__label">{x.label}</span>
              <CopyText text={x.value} label={x.label} size="sm" class="ct-id__copy" />
            </li>
          ))}
        </ul>
      )}

      {c.note && <NoteText text={c.note} name={c.name} />}

      <RelatedLinks links={links} tripId={tripId} class="ct-related" testId={`contact-links-${c.id}`} />

      {canEdit && (
        <button
          type="button"
          class="ct-edit"
          data-press="scale"
          data-overlay-trigger="contact-edit"
          data-overlay-arg={c.id}
          data-testid={`contact-edit-${c.id}`}
          onClick={(e) => openContactSheet(c.id, { trigger: e.currentTarget })}
        >
          <Glyph name="pen" size={16} />
          <span>编辑</span>
        </button>
      )}
    </div>
  );
}

/** 备注全文：里面的号码（model.js 的 phoneSpans）点了直接拨（tel:，走 openExternal） */
function NoteText({ text, name }) {
  const spans = phoneSpans(text);
  return (
    <p class="ct-note" data-testid="contact-note">
      {spans.map((s, i) => (s.tel ? (
        <a
          key={i}
          class="ct-note__tel"
          href={s.tel}
          data-press="scale"
          aria-label={`打电话：${s.text}（${name}的备注里）`}
          onClick={(e) => openLink(s.tel, e)}
        >
          {s.text}
        </a>
      ) : s.text))}
    </p>
  );
}
