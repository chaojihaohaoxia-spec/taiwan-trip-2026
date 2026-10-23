// =====================================================================
// pages/tips/LocalFacts.jsx：贴士页最上面的「当地须知」——从目的地档案现算（rules/dest.js，data/dest.js 的 localSummary），
// 不用自己写贴士：新建一趟日本行程，这里就是 110 / 119、A/B 插座 100V、不给小费、叫车用 GO。
//
//   紧急电话：几个大号数字并排，点了直接拨（和置顶里手写的「紧急电话」贴士同一种样子；手写的那条照样在，号码重复的不再拆一遍）
//   下面几行：插座（相对香港说，电压低提醒吹风机）、小费、叫车（档案的第一个 App + 一句注意）、钱（当地币种 + 一句）、地图
//   没核过的地区：只写钱和叫车，下面一句「紧急电话、插座、小费还没核对」
// =====================================================================

import { Glyph } from '../../kit/Glyph.jsx';
import { SectionHeader } from '../../kit/SectionHeader.jsx';
import { localSummary, tripProfile } from '../../data/dest.js';

/** 这趟行程档案里的紧急电话号码（置顶里手写的紧急电话贴士，重复的号码不再拆成大号数字） */
export function profileSosNumbers(store) {
  const s = localSummary(tripProfile(store));
  return new Set((s?.sos || []).map((n) => n.number));
}

/** @param {{ store: object }} props */
export function LocalFacts({ store }) {
  const s = localSummary(tripProfile(store));
  if (!s) return null;
  const rows = [
    s.plug && { key: 'plug', glyph: 'cable', label: '插座', text: s.plug },
    s.tip && { key: 'tip', glyph: 'wallet', label: '小费', text: s.tip },
    s.ride && { key: 'ride', glyph: 'car', label: '叫车', text: [s.ride, s.rideNote].filter(Boolean).join('；') },
    s.money && { key: 'money', glyph: 'ledger', label: '钱', text: s.money },
    s.mapNote && { key: 'map', glyph: 'map', label: '地图', text: s.mapNote },
  ].filter(Boolean);
  const cols = Math.min(4, Math.max(1, s.sos.length));
  return (
    <section class="tp-facts" aria-labelledby="tp-facts-title" data-testid="tips-local" data-region={s.region}>
      <SectionHeader id="tp-facts-title" title="当地须知" meta={s.name} />
      {s.sos.length > 0 && (
        <ul class="tp-sos tp-facts__sos" aria-label="紧急电话" style={{ '--tp-sos-cols': cols }} data-testid="tips-local-sos">
          {s.sos.map((n) => (
            <li key={n.number}>
              <a class="tp-sos__item" href={`tel:${n.number}`} data-press="scale" aria-label={`${n.label} ${n.number}，拨打`}>
                <b class="tp-sos__num t-figure-serif">{n.number}</b>
                <span class="tp-sos__label"><Glyph name="call" size={13} stroke={2} />{n.label}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <dl class="tp-facts__rows">
        {rows.map((r) => (
          <div key={r.key} class="tp-facts__row" data-key={r.key}>
            <dt><Glyph name={r.glyph} size={15} /><span>{r.label}</span></dt>
            <dd>{r.text}</dd>
          </div>
        ))}
      </dl>
      {!s.checked && <p class="tp-facts__note">紧急电话、插座、小费还没核对，先不写</p>}
    </section>
  );
}
