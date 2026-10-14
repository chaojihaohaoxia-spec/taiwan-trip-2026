// =====================================================================
// ui/scroll-intent.js：根据滚动判断“用户想看内容（收起顶栏）还是想找导航（展开顶栏）”。纯逻辑，单元测试覆盖。
//
//   const intent = createScrollIntent();
//   onScroll → const state = intent.update(window.scrollY, maxScroll);   // 'bar' | 'pill'
//
// 规则（参照 iOS Safari 的地址栏）：
//   - 靠近顶部（≤ topZone）永远展开；
//   - 往下滚累计超过 down 像素、并且已经离开顶部区域（> threshold）→ 收成胶囊；
//   - 往上滚累计超过 up 像素 → 展开（往上要“有意”一点，避免手指抖一下就弹出来）；
//   - 方向一变累计清零；到底部的回弹（iOS 橡皮筋）不算往上滚：位置先夹在 [0, maxScroll]；
//   - forceBar()：点了胶囊、键盘焦点进了顶栏 → 展开，直到下一次往下滚。
// =====================================================================

/**
 * @param {{ threshold?: number, down?: number, up?: number, topZone?: number }} [o]
 */
export function createScrollIntent({ threshold = 56, down = 10, up = 24, topZone = 4 } = {}) {
  let lastY = null;
  let acc = 0;
  let state = 'bar';
  return {
    /**
     * @param {number} rawY 当前滚动位置
     * @param {number} [maxY] 最大可滚动距离（用来忽略到底时的回弹）
     * @returns {'bar'|'pill'}
     */
    update(rawY, maxY = Infinity) {
      const y = Math.min(Math.max(rawY, 0), Math.max(0, maxY));
      if (lastY === null) {
        lastY = y;
        state = y > threshold ? state : 'bar';
        return state;
      }
      const dy = y - lastY;
      lastY = y;
      if (y <= topZone) {
        acc = 0;
        state = 'bar';
        return state;
      }
      if (dy === 0) return state;
      if (acc !== 0 && Math.sign(dy) !== Math.sign(acc)) acc = 0;
      acc += dy;
      if (state === 'bar' && acc >= down && y > threshold) {
        state = 'pill';
        acc = 0;
      } else if (state === 'pill' && acc <= -up) {
        state = 'bar';
        acc = 0;
      }
      return state;
    },
    /** 强制展开（点胶囊、焦点进入顶栏） */
    forceBar() {
      state = 'bar';
      acc = 0;
      return state;
    },
    get state() {
      return state;
    },
  };
}
