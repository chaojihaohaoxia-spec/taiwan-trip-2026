// =====================================================================
// test/e2e/lib/contrast.mjs：在真实渲染上量文字对比度（玻璃、模糊、光场、照片都算进去）。
//
//   const r = await measureTextContrast(app, {
//     targets: '.tabbar__label',                  // 要量的字（每个元素单独出结果）
//     hide: '.tabbar__label, .tabbar__label *',   // 把字“藏掉”的选择器：只把 color 设成透明（内联 !important），text-shadow（活力晕）照常画
//     clip: { x, y, width, height },              // 截哪一块（视口坐标）
//   });
//   r → [{ name, color, min, p5, median, pixels }]
//
// 做法：同一块截两张——有字 / 字透明（其余完全一样，字后面的晕还在）。两张不一样的像素就是字形；
// 字形下面的“背景”取第二张同一像素（玻璃 + 模糊 + 晕 + 后面的内容，真实渲染的结果），
// 字的颜色取计算样式（有透明度的先叠在那个背景像素上），逐像素算 WCAG 对比度，给最小值、第 5 百分位和中位数。
// 不受抗锯齿影响（字的颜色是已知的，只用到背景像素）。
// =====================================================================

const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * @param {object} app openApp() 的返回值
 * @param {{ targets: string, hide: string, clip: { x: number, y: number, width: number, height: number }, name?: (el: Element) => string, threshold?: number }} o
 */
export async function measureTextContrast(app, o) {
  const { page } = app;
  const meta = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)];
    return {
      dpr: window.devicePixelRatio,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      items: els.map((el, i) => {
        const r = el.getBoundingClientRect();
        // 叠在一起交叉淡化的字（「更多」↔「关闭」）：量看得见的那个
        const shown = el.querySelector('[data-on]') || el;
        const tab = el.closest('[data-tab]');
        return {
          name: tab ? `${tab.dataset.tab}${tab.getAttribute('aria-current') === 'page' ? '（选中）' : ''}` : `#${i}`,
          color: getComputedStyle(shown).color,
          rect: { x: r.left, y: r.top, w: r.width, h: r.height },
        };
      }),
    };
  }, o.targets);
  const clip = { ...o.clip, x: o.clip.x + meta.scrollX, y: o.clip.y + meta.scrollY };
  const shoot = () => page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false });
  const withText = await shoot();
  // 页面有 CSP（不许内联 <style>）：用 CSSOM 在元素上写内联样式（!important），量完还原
  await page.evaluate((sel) => {
    window.__contrastHidden = [...document.querySelectorAll(sel)].map((el) => {
      const before = [el.style.getPropertyValue('color'), el.style.getPropertyPriority('color'), el.style.getPropertyValue('transition')];
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('color', 'transparent', 'important');
      return [el, before];
    });
  }, o.hide);
  await twoFrames(page);
  const without = await shoot();
  await page.evaluate(() => {
    for (const [el, [color, priority, transition]] of window.__contrastHidden || []) {
      el.style.removeProperty('color');
      el.style.removeProperty('transition');
      if (color) el.style.setProperty('color', color, priority);
      if (transition) el.style.setProperty('transition', transition);
    }
    delete window.__contrastHidden;
  });
  await twoFrames(page);

  const blank = await app.context.newPage();
  try {
    return await blank.evaluate(async (a, b, items, dpr, c, threshold) => {
      const decode = async (b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const rgba = (css) => {
        const ctx = new OffscreenCanvas(1, 1).getContext('2d');
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const lin = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r, g, bb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bb);
      const A = await decode(a);
      const B = await decode(b);
      const W = A.width;
      return items.map((it) => {
        const [tr, tg, tb, ta] = rgba(it.color);
        const x0 = Math.max(0, Math.floor((it.rect.x - c.x) * dpr));
        const y0 = Math.max(0, Math.floor((it.rect.y - c.y) * dpr));
        const x1 = Math.min(W, Math.ceil((it.rect.x + it.rect.w - c.x) * dpr));
        const y1 = Math.min(A.height, Math.ceil((it.rect.y + it.rect.h - c.y) * dpr));
        const ratios = [];
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            const diff = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
            if (diff < threshold) continue;
            const br = B.data[i];
            const bg = B.data[i + 1];
            const bb = B.data[i + 2];
            const fr = tr * ta + br * (1 - ta);
            const fg = tg * ta + bg * (1 - ta);
            const fb = tb * ta + bb * (1 - ta);
            const l1 = lum(fr, fg, fb);
            const l2 = lum(br, bg, bb);
            ratios.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
          }
        }
        ratios.sort((p, q) => p - q);
        const at = (q) => (ratios.length ? ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * q))] : 0);
        return { name: it.name, color: it.color, pixels: ratios.length, min: ratios[0] ?? 0, p5: at(0.05), median: at(0.5) };
      });
    }, withText, without, meta.items, meta.dpr, o.clip, o.threshold ?? 30);
  } finally {
    await blank.close();
  }
}

/**
 * 在底栏后面垫一块测试背景（盖住页面内容）：最亮、最暗、最花。
 * 默认垫在滚动边缘层（.shell-edge--bottom，它会先把内容淡淡洗一层）下面——和真实页面一样；
 * over: true 垫在滚动边缘层上面、紧贴底栏玻璃（最坏情况：玻璃直接看到纯黑 / 纯白）。
 * @param {import('puppeteer-core').Page} page
 * @param {string|null} css 背景的 CSS（background 简写）；null 撤掉
 * @param {{ over?: boolean }} [o]
 */
export async function backdropUnderTabbar(page, css, { over = false } = {}) {
  await page.evaluate((bg, above) => {
    document.getElementById('__tabbar-backdrop')?.remove();
    if (!bg) return;
    const el = document.createElement('div');
    el.id = '__tabbar-backdrop';
    // 同一层叠上下文里 z-index 相同时后放进去的在上面：tabbar - 1 正好在滚动边缘层（也是 tabbar - 1）上面、底栏下面
    el.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:220px;z-index:calc(var(--z-tabbar) - ${above ? 1 : 2});pointer-events:none;background:${bg}`;
    document.body.append(el);
  }, css, over);
  await twoFrames(page);
}
