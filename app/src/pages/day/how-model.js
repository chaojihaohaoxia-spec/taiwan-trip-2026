// =====================================================================
// pages/day/how-model.js：「怎么过去」那行灰字、「改」的芯片、改一项面板「会给哪几个按钮」的纯逻辑（Node 里能测：test/unit/kit.how.test.js）。
// 规则本身在 rules/how.js（两端同一套）；界面在 HowRow.jsx、sheets/item/ItemSheet.jsx。
//
//   howLineText(how)          没写怎么去时那行灰字（「离上一站 2.3 公里，按打车算」）；同一个地方、坐飞机、没地点 → null
//   closesAfter(choice)       选了这个芯片以后收不收起来（有细分的——地铁公交、骑车、更多——先存默认、留着让人细选）
//   howPreview(how, auto)     改一项面板「怎么去」下面那行：为什么 + 「会给：叫 Grab · 给司机看」
// =====================================================================

import { chipOfMode, TEXT } from '../../rules/how.js';

/** 推出来的走法一句话（how.hint 没有时） */
const KEY_TEXT = Object.freeze({
  walk: '走过去', transit: '坐车过去', self: '自己开车或骑车', ride: '打车过去', transfer: TEXT.transfer, unknown: TEXT.unknown,
});

export function howLineText(how) {
  if (!how || ['none', 'here', 'fly', 'place'].includes(how.key)) return null;
  return how.hint || KEY_TEXT[how.key] || null;
}

export function closesAfter(choice) {
  return choice === 'auto' || !['transit', 'bike', 'more'].includes(chipOfMode(choice));
}

/** 动作键 → 「会给」那行里的叫法 */
const HOW_LABELS = Object.freeze({ nav: '导航', driver: '给司机看', call: '打电话', checkin: '值机', pass: '登机牌', status: '航班动态' });

/**
 * @param {object|null} how data/dest.js 的 itemHow
 * @param {boolean} auto 现在是「自动」（先说为什么）
 */
export function howPreview(how, auto) {
  if (!how) return '';
  const names = how.actions.map((k) => (k === 'ride' ? how.ride?.label || '叫车' : HOW_LABELS[k] || k));
  const buttons = names.length ? `会给：${names.join(' · ')}` : '不给按钮';
  return [auto ? how.hint : null, buttons].filter(Boolean).join('；');
}
