// =====================================================================
// shell/scroll-state.js：顶栏三种状态、底栏收小随滚动怎么变（纯逻辑，Node 里能直接测）。
// 底栏的规则见文件末尾 createTabbarIntent；两者由 FrameUI.jsx 的同一个滚动处理（rAF 节流）驱动，互不影响。
//
//   top   页面最上面：大标题在内容里（它就是标题），顶栏只剩两边的圆按钮，玻璃透明
//   pill  往下滚过大标题：标题收成顶部正中的小胶囊（行程名 + 箭头，点了打开行程切换面板）
//   bar   在页面中间往上滑：胶囊展开成整条玻璃顶栏（封面点 + 行程名 + 日期 + 箭头）；再往下滑又收回胶囊
//
//   const intent = createTopbarIntent();
//   onScroll → const state = intent.update(window.scrollY, maxScroll, { collapse });
//
// 规则（参照样稿 07-ui.js 的 TopBar.sync 和 iOS Safari 的地址栏）：
//   - y < threshold → top（大标题还看得见）；collapse 'always' 时没有 top，最少也是 pill；
//     'never'（不收成胶囊）：滚过大标题以后一直是整条顶栏 bar（标题、副标题一直看得见，点了照样打开行程切换）；
//   - 从 top 往下滚过 threshold → 直接 pill（不会先闪一下整条）；
//   - pill 时往上累计滑过 up 像素 → bar（往上要“有意”一点，手指抖一下不会弹出来）；
//   - bar 时往下累计滑过 down 像素 → pill；
//   - 方向一变累计清零；到底部的回弹（iOS 橡皮筋）不算往上滑：位置先夹在 [0, maxY]。
// =====================================================================

/**
 * @param {{ threshold?: number, up?: number, down?: number }} [o]
 */
export function createTopbarIntent({ threshold = 48, up = 28, down = 16 } = {}) {
  let lastY = null;
  let upAcc = 0;
  let downAcc = 0;
  let state = 'top';

  return {
    /**
     * @param {number} rawY
     * @param {number} [maxY]
     * @param {{ collapse?: 'auto'|'always'|'never' }} [o]
     * @returns {'top'|'pill'|'bar'}
     */
    update(rawY, maxY = Infinity, { collapse = 'auto' } = {}) {
      const y = Math.min(Math.max(Number(rawY) || 0, 0), Math.max(0, maxY));
      const dy = lastY === null ? 0 : y - lastY;
      lastY = y;
      if (dy > 0) {
        downAcc += dy;
        upAcc = 0;
      } else if (dy < 0) {
        upAcc -= dy;
        downAcc = 0;
      }
      if (collapse === 'never') {
        upAcc = 0;
        downAcc = 0;
        state = y < threshold ? 'top' : 'bar';
        return state;
      }
      if (collapse !== 'always' && y < threshold) {
        upAcc = 0;
        downAcc = 0;
        state = 'top';
        return state;
      }
      if (state === 'top') {
        state = 'pill';
        upAcc = 0;
        downAcc = 0;
      } else if (state === 'pill' && upAcc > up) {
        state = 'bar';
        upAcc = 0;
      } else if (state === 'bar' && downAcc > down) {
        state = 'pill';
        downAcc = 0;
      }
      return state;
    },
    /** 换页以后：按新页面的位置重新起算（不带着上一页的累计） */
    reset(y = 0, { collapse = 'auto' } = {}) {
      lastY = Math.max(0, Number(y) || 0);
      upAcc = 0;
      downAcc = 0;
      if (collapse === 'never') state = lastY < threshold ? 'top' : 'bar';
      else if (collapse === 'always') state = 'pill';
      else state = lastY < threshold ? 'top' : 'pill';
      return state;
    },
    /** 点了胶囊 / 焦点进了顶栏：展开成整条，直到下一次往下滑 */
    forceBar() {
      if (state !== 'top') state = 'bar';
      upAcc = 0;
      downAcc = 0;
      return state;
    },
    get state() {
      return state;
    },
    get threshold() {
      return threshold;
    },
  };
}

/**
 * 底栏随滚动收小（Apple Music 的做法，iOS 26 的 tabBarMinimizeBehavior .onScrollDown）：
 *   const intent = createTabbarIntent();
 *   onScroll → const compact = intent.update(window.scrollY, maxScroll);
 * 规则：
 *   - 离页面顶部不到 minY（默认 96px）→ 完整（回到顶部一定弹回来）；
 *   - 往下累计滚过 down（默认 24px）→ 收小（标签淡出，只留图标）；
 *   - 收小时往上累计滚过 up（默认 12px）→ 弹回完整（往上“一点”就够：要找底栏的时候不用滚很多）；
 *   - 方向一变累计清零；位置先夹在 [0, maxY]（到底的橡皮筋回弹不算往上滚，和顶栏一样）。
 * 换页以后 reset()：一律从完整开始（点了底栏切过去，底栏应该是展开的）。
 * @param {{ minY?: number, down?: number, up?: number }} [o]
 */
export function createTabbarIntent({ minY = 96, down = 24, up = 12 } = {}) {
  let lastY = null;
  let upAcc = 0;
  let downAcc = 0;
  let compact = false;
  return {
    /** @returns {boolean} 是否收小 */
    update(rawY, maxY = Infinity) {
      const y = Math.min(Math.max(Number(rawY) || 0, 0), Math.max(0, maxY));
      const dy = lastY === null ? 0 : y - lastY;
      lastY = y;
      if (dy > 0) {
        downAcc += dy;
        upAcc = 0;
      } else if (dy < 0) {
        upAcc -= dy;
        downAcc = 0;
      }
      if (y < minY) {
        compact = false;
        upAcc = 0;
        downAcc = 0;
      } else if (!compact && downAcc > down) {
        compact = true;
        downAcc = 0;
      } else if (compact && upAcc > up) {
        compact = false;
        upAcc = 0;
      }
      return compact;
    },
    reset(y = 0) {
      lastY = Math.max(0, Number(y) || 0);
      upAcc = 0;
      downAcc = 0;
      compact = false;
      return compact;
    },
    get compact() {
      return compact;
    },
  };
}
