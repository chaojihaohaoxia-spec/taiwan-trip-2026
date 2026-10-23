// =====================================================================
// pages/day/HowRow.jsx：每天页条目展开后的「怎么过去」一行（规则包推出来的时候）+「改」的那排芯片。
//
//   <HowLine how={how} item={item} store={store} canEdit />      没写怎么去：一行灰字说为什么是这几个按钮
//                                                                （「离上一站 2.3 公里，按打车算」），末尾一个很淡的「改」
//   <TransportChips item={item} onPick={(mode) => …} />          「怎么去」芯片（自动 · 走路 · 打车 · 地铁公交 · 自驾 · 骑车 · 有人接 · 更多）；
//                                                                地铁公交 / 骑车 / 更多下面再一排小字（地铁 · 公交 · 火车 …）
// 点「改」直接弹芯片，点一下就存（store.update 写 transport_in，离线也行），不进整个编辑面板；
// 选「地铁公交」这种有细分的，先按默认（地铁）存上，下面一排小字可以再细选。
// 规则和写法都在 rules/how.js（transportChoices / transportPatch，两端同一套）；改一项面板里的「怎么去」也用这一排。
// =====================================================================

import './how.css';
import { useState } from 'preact/hooks';
import { Chip } from '../../ui/Chip.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { haptic } from '../../lib/native.js';
import { toast } from '../../overlay/index.js';
import { transportChoices, transportPatch } from '../../rules/how.js';
import { howLineText, closesAfter } from './how-model.js';

export { howLineText, closesAfter };

/**
 * 「怎么去」芯片。value：现在选中的 mode（null = 自动）；onPick(mode | 'auto')。
 * @param {{ item: object, transportIn?: object|null, onPick: (choice: string) => void, disabled?: boolean, testId?: string }} props
 *   transportIn：面板里还没保存的值（不给就用 item.transport_in）
 */
export function TransportChips({ item, transportIn, onPick, disabled = false, testId = 'how-chips' }) {
  const it = transportIn === undefined ? item : { ...item, transport_in: transportIn };
  const c = transportChoices(it);
  // 「更多」只是展开（飞机 · 其他），点了不存
  const [peek, setPeek] = useState(false);
  const shownId = peek ? 'more' : c.current;
  const chip = c.chips.find((x) => x.id === shownId) || null;
  const sub = chip?.sub || null;
  const pick = (ch) => {
    haptic('selection');
    if (ch.id === 'more') {
      setPeek(true);
      return;
    }
    setPeek(false);
    onPick(ch.id === 'auto' ? 'auto' : ch.mode);
  };
  return (
    <div class="how-chips" data-testid={testId} data-current={c.current}>
      <div class="how-chips__row" role="radiogroup" aria-label="怎么去">
        {c.chips.map((ch) => (
          <Chip
            key={ch.id}
            size="sm"
            selected={shownId === ch.id}
            onToggle={() => { if (shownId !== ch.id) pick(ch); }}
            disabled={disabled}
            role="radio"
            aria-checked={shownId === ch.id ? 'true' : 'false'}
            data-chip={ch.id}
          >
            {ch.label}
          </Chip>
        ))}
      </div>
      {sub && (
        <div class="how-chips__sub" role="radiogroup" aria-label={`${chip.label}：哪一种`} data-testid={`${testId}-sub`}>
          {sub.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              class="how-chips__subopt"
              role="radio"
              aria-checked={c.sub === mode ? 'true' : 'false'}
              disabled={disabled}
              data-press="scale"
              data-mode={mode}
              onClick={() => { if (c.sub !== mode) { haptic('selection'); setPeek(false); onPick(mode); } }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!c.autoAllowed && <p class="how-chips__note">导入时写了几种走法：这里只改推荐哪一种，原来写的说明都留着</p>}
    </div>
  );
}

/**
 * 点一下就存「怎么去」（transport_in）。
 * @returns {Promise<boolean>}
 */
export async function saveTransport(store, item, choice) {
  let next;
  try {
    next = transportPatch(item, choice);
  } catch (e) {
    toast.error(e?.message || '没改成');
    return false;
  }
  try {
    const r = store.update('items', item.id, { transport_in: next }, { label: `改「${item.title}」怎么去` });
    await r.saved;
    return true;
  } catch (e) {
    toast.error(e?.message || '没有保存上');
    return false;
  }
}

/**
 * 没写怎么去时的一行：灰字说明 +「改」。写过（App 里点的）时由 TransportBlock 显示，同样带「改」。
 * @param {{ how: object, item: object, store: object, canEdit: boolean, testId?: string }} props
 */
export function HowLine({ how, item, store, canEdit, testId = 'tl-how' }) {
  const [open, setOpen] = useState(false);
  const text = howLineText(how);
  if (!text) return null;
  return (
    <div class="how-line" data-testid={testId} data-how={how.key} data-source={how.source}>
      <p class="how-line__text">
        <Glyph name="route" size={15} />
        <span>{text}</span>
        {canEdit && (
          <button type="button" class="how-line__edit" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((o) => !o)} data-press="scale" data-testid={`${testId}-edit`}>
            {open ? '收起' : '改'}
          </button>
        )}
      </p>
      {open && canEdit && (
        <TransportChips
          item={item}
          testId={`${testId}-chips`}
          onPick={async (choice) => {
            const ok = await saveTransport(store, item, choice);
            if (ok && closesAfter(choice)) setOpen(false);
          }}
        />
      )}
    </div>
  );
}
