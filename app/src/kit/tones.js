// =====================================================================
// kit/tones.js：kit 组件的语气词和全站统一（lib/notify.js、ui/Badge、overlay 的 Toast：neutral / success / warning / danger / info）。
//
// kit 早先用过 'default'、'positive'、'negative' 这几个词，现在都认、都换成全站的写法：
//   'default' → 'neutral'    'positive' → 'success'    'negative' → 'danger'
// 'accent'（强调色浅底 / 字）和 'muted'（次要色）不是“语气”，是 kit 自己的外观选项，原样保留。
// =====================================================================

const ALIASES = Object.freeze({ default: 'neutral', positive: 'success', negative: 'danger' });

/** 旧写法 → 全站写法；空的当 'neutral' */
export function kitTone(tone) {
  if (!tone) return 'neutral';
  return ALIASES[tone] || tone;
}
