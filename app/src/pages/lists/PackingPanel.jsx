// =====================================================================
// pages/lists/PackingPanel.jsx：打包清单。
//
//   顶部卡片：还有几件没装（跟着筛选）+ 进度圆环；「谁的东西」分段（全部 / 共用 / 每位成员，记在网址 ?who=）；
//            「隐藏已装好」（本机记住）
//   每个分类一张卡（证件 / 衣物 / 电子 / 洗护 / 药品 / 其他，按清单里第一次出现的顺序）：分类图标、名字、
//            「3/6」和细进度条（这一组装齐了变成「齐了」）；没装的在前，装好的沉到下面（FLIP）；带数量的用步进器
//   最后：快速添加（回车连续加）。自动带上当前筛选的人；分类可以选，选「自动」就按名字猜（「充电宝」→ 电子），
//         加完下面说一声加到了哪一组，点「改」打开待办弹层改
// 清单是空的：说明 + 「用常用清单开始」（一键加十几样常见的）。
// =====================================================================

import { useMemo, useRef, useState, useEffect } from 'preact/hooks';
import { FlipGroup, SegmentedControl, Chip, Button } from '../../ui/index.js';
import { Card, InlineAdd, PageEmptyState } from '../../kit/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { LISTS, PACKING_CATEGORIES, packingGroups, progressOf, ownerOptions, matchOwner, categoryOf, inferCategory, zoneNote, joinWords } from './model.js';
import { PanelHead } from './parts.jsx';
import { RowItem, flipKey, FLIP_OPTIONS } from './ListPanel.jsx';

/** 「自动」= 按名字猜分类 */
const AUTO = '__auto';

/**
 * 一个分类一张卡。
 * @param {{ g: object, ctx: object, actions: object, hideDone: boolean, focusId?: string|null, showOwner: boolean, hold?: Map }} props
 */
function PackGroup({ g, ctx, actions, hideDone, focusId, showOwner, hold = null }) {
  const full = g.progress.total > 0 && g.progress.done >= g.progress.total;
  const ratio = g.progress.total ? g.progress.done / g.progress.total : 0;
  return (
    <Card padding="sm" class="lgroup" testId={`pack-group-${g.category}`} as="section">
      <header class="lgroup__head" data-full={full ? '' : undefined}>
        <span class="lgroup__tile" aria-hidden="true"><Glyph name={g.glyph} size={20} /></span>
        <h2 class="lgroup__title">
          {g.category}
          <span class="visually-hidden">{full ? '：都装好了' : `：装好 ${g.progress.done} 件，共 ${g.progress.total} 件`}</span>
        </h2>
        <span class="lgroup__count" aria-hidden="true">
          {full ? (
            <>
              <Glyph name="check" size={14} stroke={2.4} />
              齐了
            </>
          ) : (
            <span class="lgroup__frac">
              <b>{g.progress.done}</b>/{g.progress.total}
            </span>
          )}
        </span>
        <span class="lgroup__bar" aria-hidden="true"><i style={{ '--lg-p': ratio.toFixed(3) }} /></span>
      </header>
      {(g.open.length > 0 || g.done.length > 0) && (
        <FlipGroup class="lgroup__rows" trigger={flipKey(g.open, g.done, hideDone)} options={FLIP_OPTIONS}>
          {g.open.map((t) => <RowItem key={t.id} todo={t} ctx={ctx} actions={actions} focusId={focusId} showOwner={showOwner} hold={hold} />)}
          {g.done.map((t) => <RowItem key={t.id} todo={t} ctx={ctx} actions={actions} focusId={focusId} showOwner={showOwner} hold={hold} />)}
        </FlipGroup>
      )}
    </Card>
  );
}

/**
 * @param {{ rows: object[], ctx: object, actions: object, hold: Map, hideDone: boolean, onHideDone: () => void,
 *           who: string, onWho: (who: string) => void, members: object[], focusId?: string|null, celebrate?: 'static'|'play'|null,
 *           onStarter?: () => Promise<any> }} props
 */
export function PackingPanel({ rows, ctx, actions, hold, hideDone, onHideDone, who, onWho, members, focusId, celebrate, onStarter }) {
  const meta = LISTS.packing;
  const options = useMemo(() => ownerOptions(members), [members]);
  const groups = packingGroups(rows, { who, hold, hideDone });
  const mine = rows.filter((r) => matchOwner(r, who));
  const progress = progressOf(mine);
  const whoOpt = options.find((o) => o.value === who);
  const whoName = who === 'all' ? null : who === 'shared' ? '共用的' : whoOpt?.label || null;

  // 分类：已有的（按出现顺序）+ 建议的
  const categories = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const c = categoryOf(r);
      if (!out.includes(c)) out.push(c);
    }
    for (const c of PACKING_CATEGORIES) if (!out.includes(c)) out.push(c);
    return out;
  }, [rows]);
  const [category, setCategory] = useState(AUTO);
  const [added, setAdded] = useState(null);
  const addedTimer = useRef(0);
  useEffect(() => () => clearTimeout(addedTimer.current), []);

  const add = async (text) => {
    const cat = category === AUTO ? inferCategory(text) || '其他' : category;
    const r = await actions.add('packing', text, { category: cat, who });
    clearTimeout(addedTimer.current);
    setAdded({ id: r?.id || null, title: text, category: cat, guessed: category === AUTO });
    addedTimer.current = setTimeout(() => setAdded(null), 6000);
  };

  if (!rows.length) {
    return (
      <Card padding="sm" class="lpanel" testId="lists-panel-packing">
        <PageEmptyState
          preset="lists"
          compact
          title={meta.emptyTitle}
          description={ctx.canEdit ? meta.emptyDesc : '这个清单还没有内容。'}
          action={ctx.canEdit && onStarter ? <StarterButton onStarter={onStarter} /> : null}
          testId="lists-empty"
        />
        {ctx.canEdit && (
          <div class="lpanel__add">
            <InlineAdd label={meta.addLabel} placeholder={meta.placeholder} onAdd={add} testId="lists-add-packing" />
          </div>
        )}
      </Card>
    );
  }

  return (
    <div class="lpack" data-testid="lists-panel-packing">
      <Card padding="sm" class="lpanel lpack__top">
        <PanelHead
          list="packing"
          open={progress.remaining}
          progress={progress}
          zone={ctx.quiet ? null : zoneNote(mine, { timeZone: ctx.timeZone, deviceZone: ctx.deviceZone, at: ctx.now, tagged: Boolean(ctx.zoneOf) })}
          who={whoName}
          celebrate={celebrate}
          extra={<Chip size="sm" selected={hideDone} onToggle={onHideDone} data-testid="pack-hide-done">隐藏已装好</Chip>}
        />
        <div class="lpack__filter">
          <SegmentedControl
            label="谁的东西"
            value={who}
            onChange={onWho}
            options={options.map((o) => ({ value: o.value, label: o.label }))}
            data-testid="pack-who"
          />
        </div>
      </Card>

      {groups.map((g) => (
        <PackGroup key={g.category} g={g} ctx={ctx} actions={actions} hideDone={hideDone} focusId={focusId} showOwner={who === 'all'} hold={hold} />
      ))}

      {!groups.length && (
        <Card padding="sm" class="lpanel" testId="pack-filter-empty">
          <PageEmptyState
            preset="lists"
            compact
            illustration={false}
            title={who === 'shared' ? '没有共用的东西' : `${whoName || '这个人'}没有要带的东西`}
            description="打包项可以在编辑里指定是谁的东西。"
            action={<Button variant="secondary" size="md" onClick={() => onWho('all')}>看全部</Button>}
          />
        </Card>
      )}

      {ctx.canEdit && (
        <Card padding="sm" class="lpack__add" testId="pack-add">
          <div class="lpack__addhead">
            <label class="lpack__cat">
              <span class="lpack__catlabel">放进</span>
              <span class="lpack__select">
                <select value={category} onChange={(e) => setCategory(e.currentTarget.value)} aria-label="新加的放进哪个分类" data-testid="pack-add-category">
                  <option value={AUTO}>自动分类</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Glyph name="chev-d" size={14} stroke={2.2} />
              </span>
            </label>
            {whoName && <span class="lpack__addwho">{who === 'shared' ? '记为共用' : joinWords(joinWords('记为', whoName), '的')}</span>}
          </div>
          <InlineAdd label={meta.addLabel} placeholder={meta.placeholder} onAdd={add} testId="lists-add-packing" />
          {added && (
            <p class="lpack__added" role="status" data-testid="pack-added">
              <Glyph name="check" size={14} stroke={2.4} />
              <span>
                「{added.title.length > 12 ? `${added.title.slice(0, 11)}…` : added.title}」加到了<b>{added.category}</b>
                {added.guessed ? '（按名字猜的）' : ''}
              </span>
              {added.id && (
                <button type="button" class="lpack__fix" data-press="scale" onClick={(e) => actions.openId(added.id, e.currentTarget)}>
                  改
                </button>
              )}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

/** 「用常用清单开始」：一键加十几样常见的（加完按钮打勾） */
function StarterButton({ onStarter }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      size="md"
      leading={<Glyph name="plus" size={18} stroke={2.2} />}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onStarter();
        } finally {
          setBusy(false);
        }
      }}
      data-testid="pack-starter"
    >
      用常用清单开始
    </Button>
  );
}
