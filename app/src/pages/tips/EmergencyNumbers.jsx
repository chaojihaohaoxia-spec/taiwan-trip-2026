// =====================================================================
// pages/tips/EmergencyNumbers.jsx：置顶组最上面的紧急电话——三个大号数字并排，下面一行小字，点了直接拨。
// 号码从「紧急电话」那条贴士的正文第一行拆出来（emergency.js）；拆不出两个以上就不显示（正文照常）。
// 拆出来的那一行不再在贴士正文里重复（PinnedCard 用 emergencyRest 去掉）；小字前面一个电话图标，看得出能点。
// =====================================================================

import { Glyph } from '../../kit/Glyph.jsx';
import { isEmergencyTip } from './model.js';
import { emergencyNumbers } from './emergency.js';

/** 置顶里拆成大号数字的那条贴士（没有返回 null） */
export function sosTip(tips) {
  return (tips || []).find((t) => isEmergencyTip(t) && emergencyNumbers(t.body).length) || null;
}

/** @param {{ tips: object[] }} props 置顶的贴士 */
export function EmergencyNumbers({ tips }) {
  const tip = sosTip(tips);
  const list = tip ? emergencyNumbers(tip.body) : [];
  if (!list.length) return null;
  return (
    <ul class="tp-sos" aria-label="紧急电话" data-testid="tips-sos">
      {list.map((n) => (
        <li key={n.number}>
          <a class="tp-sos__item" href={`tel:${n.number}`} data-press="scale" aria-label={`${n.label} ${n.number}，拨打`}>
            <b class="tp-sos__num t-figure-serif">{n.number}</b>
            <span class="tp-sos__label"><Glyph name="call" size={13} stroke={2} />{n.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
