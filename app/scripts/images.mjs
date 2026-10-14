#!/usr/bin/env node
// =====================================================================
// scripts/images.mjs：用本机 Chrome 把 SVG 渲染成位图（npm run images）。
//
// 生成两类文件（都提交进仓库，构建时不需要 Chrome）：
//   1. PWA 图标：static/icons/ 下
//        icon-192.png、icon-512.png              普通图标（圆角、角落透明）← icon.svg
//        icon-maskable-192.png、icon-maskable-512.png  满版（系统裁形状）← icon-maskable.svg
//        apple-touch-icon.png（180×180，满版不透明，iOS 主屏用）← icon-maskable.svg
//        favicon-32.png（浏览器标签页兜底）← favicon.svg
//   2. 演示素材：demo/photos/demo-photo-01…08.jpg（抽象插画，虚构）、demo/files/demo-confirmation.pdf
//
// 改了 static/icons/*.svg 或下面的插画后再跑一次。最后用 sips 核对每个 PNG 的像素尺寸。
// =====================================================================

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STATIC_DIR, DEMO_DIR } from './lib/paths.mjs';
import { launchChrome } from './lib/chrome.mjs';

const ICON_DIR = path.join(STATIC_DIR, 'icons');
const PHOTO_DIR = path.join(DEMO_DIR, 'photos');
const FILES_DIR = path.join(DEMO_DIR, 'files');

const ICONS = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192, transparent: true },
  { src: 'icon.svg', out: 'icon-512.png', size: 512, transparent: true },
  { src: 'icon-maskable.svg', out: 'icon-maskable-192.png', size: 192, transparent: false },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512, transparent: false },
  { src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180, transparent: false },
  { src: 'favicon.svg', out: 'favicon-32.png', size: 32, transparent: true },
];

// ---------------------------------------------------------------------
// 演示照片：纯 SVG 抽象插画（不含任何真实地点、人物），右下角标“演示”
// ---------------------------------------------------------------------
const mark = (w, h) => `<text x="${w - 28}" y="${h - 28}" text-anchor="end" font-family="-apple-system, 'PingFang SC', sans-serif" font-size="${Math.round(w / 36)}" font-weight="600" fill="#ffffff" opacity="0.55">演示</text>`;

function hills(w, h, base, amp, color, phase = 0, step = 60) {
  let d = `M0 ${h} L0 ${base}`;
  for (let x = 0; x <= w + step; x += step) {
    const y = base + Math.sin((x / w) * Math.PI * 2.2 + phase) * amp + Math.sin((x / w) * Math.PI * 5.3 + phase * 2) * amp * 0.35;
    d += ` L${x} ${y.toFixed(1)}`;
  }
  d += ` L${w} ${h} Z`;
  return `<path d="${d}" fill="${color}"/>`;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PHOTOS = [
  {
    name: 'demo-photo-01.jpg', w: 1200, h: 900, title: '清晨的海',
    svg: (w, h) => `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9EC5FF"/><stop offset="0.6" stop-color="#FFC9B5"/><stop offset="1" stop-color="#FFE3B8"/></linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5B8FD6"/><stop offset="1" stop-color="#16376B"/></linearGradient>
        <radialGradient id="sun"><stop offset="0" stop-color="#FFF6DD"/><stop offset="1" stop-color="#FFD58A" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <circle cx="${w * 0.62}" cy="${h * 0.5}" r="${h * 0.28}" fill="url(#sun)"/>
      <circle cx="${w * 0.62}" cy="${h * 0.52}" r="${h * 0.07}" fill="#FFF3D6"/>
      <rect y="${h * 0.56}" width="${w}" height="${h * 0.44}" fill="url(#sea)"/>
      ${Array.from({ length: 14 }, (_, i) => `<rect x="${w * 0.62 - 120 + (i % 3) * 30}" y="${h * 0.58 + i * 22}" width="${240 - i * 12}" height="3" rx="1.5" fill="#FFE9C2" opacity="${0.7 - i * 0.04}"/>`).join('')}`,
  },
  {
    name: 'demo-photo-02.jpg', w: 900, h: 1200, title: '椰林',
    svg: (w, h) => `
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2EC4B6"/><stop offset="1" stop-color="#CBF3F0"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <rect y="${h * 0.82}" width="${w}" height="${h * 0.18}" fill="#F4D6A0"/>
      ${[[0.3, 0.86, -8], [0.7, 0.9, 6]].map(([cx, base, lean]) => {
    const x = w * cx;
    const y = h * base;
    const top = h * 0.32;
    const trunk = `<path d="M${x - 10} ${y} Q${x + lean * 8} ${(y + top) / 2} ${x + lean * 6} ${top} L${x + lean * 6 + 14} ${top} Q${x + lean * 8 + 16} ${(y + top) / 2} ${x + 12} ${y} Z" fill="#0F3D3A"/>`;
    const fronds = Array.from({ length: 7 }, (_, i) => {
      const a = (-160 + i * 45) * (Math.PI / 180);
      const len = 170;
      const ex = x + lean * 6 + 7 + Math.cos(a) * len;
      const ey = top + Math.sin(a) * len * 0.6 + 40;
      return `<path d="M${x + lean * 6 + 7} ${top} Q${(x + lean * 6 + 7 + ex) / 2} ${top - 60} ${ex} ${ey}" stroke="#0F3D3A" stroke-width="22" fill="none" stroke-linecap="round"/>`;
    }).join('');
    return trunk + fronds;
  }).join('')}`,
  },
  {
    name: 'demo-photo-03.jpg', w: 1200, h: 900, title: '夜市灯光',
    svg: (w, h) => {
      const rnd = seeded(3);
      const colors = ['#FFB703', '#FB8500', '#FF5D8F', '#FFD166', '#F28482'];
      const dots = Array.from({ length: 70 }, () => {
        const r = 10 + rnd() * 60;
        return `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h * 0.8).toFixed(0)}" r="${r.toFixed(0)}" fill="${colors[Math.floor(rnd() * colors.length)]}" opacity="${(0.12 + rnd() * 0.35).toFixed(2)}"/>`;
      }).join('');
      const bulbs = Array.from({ length: 24 }, (_, i) => {
        const x = (i + 0.5) * (w / 24);
        const y = 120 + Math.sin((i / 24) * Math.PI) * 90;
        return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="9" fill="#FFE8A3"/>`;
      }).join('');
      return `<rect width="${w}" height="${h}" fill="#141B33"/>${dots}
        <path d="M0 120 Q${w / 2} 300 ${w} 120" stroke="#3A3F5C" stroke-width="3" fill="none"/>${bulbs}
        <rect y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="#0B1022"/>`;
    },
  },
  {
    name: 'demo-photo-04.jpg', w: 1200, h: 900, title: '茶山',
    svg: (w, h) => `
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8F3EC"/><stop offset="1" stop-color="#C8E3D2"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      ${hills(w, h, h * 0.42, 40, '#9CC9A8', 0.4)}
      ${hills(w, h, h * 0.55, 50, '#6FAE84', 1.3)}
      ${hills(w, h, h * 0.68, 45, '#3F8A5C', 2.1)}
      ${hills(w, h, h * 0.82, 35, '#1F5E3B', 3.0)}
      <rect width="${w}" height="${h * 0.5}" fill="#FFFFFF" opacity="0.25"/>`,
  },
  {
    name: 'demo-photo-05.jpg', w: 1000, h: 1000, title: '城市黄昏',
    svg: (w, h) => {
      const rnd = seeded(5);
      let x = 0;
      let blocks = '';
      while (x < w) {
        const bw = 50 + rnd() * 90;
        const bh = h * (0.18 + rnd() * 0.38);
        blocks += `<rect x="${x.toFixed(0)}" y="${(h - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="#24203F"/>`;
        for (let wy = h - bh + 16; wy < h - 20; wy += 26) {
          for (let wx = x + 10; wx < x + bw - 14; wx += 20) {
            if (rnd() > 0.55) blocks += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="8" height="12" fill="#FFD68A" opacity="0.85"/>`;
          }
        }
        x += bw + 4;
      }
      return `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E4B8B"/><stop offset="0.55" stop-color="#E07A5F"/><stop offset="1" stop-color="#F2CC8F"/></linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#sky)"/>${blocks}`;
    },
  },
  {
    name: 'demo-photo-06.jpg', w: 1000, h: 1000, title: '一碗面',
    svg: (w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      // 面条：一条条横跨碗里的波浪线，长度按碗的弦长
      const noodles = Array.from({ length: 11 }, (_, i) => {
        const y = cy - 150 + i * 30;
        const half = Math.sqrt(Math.max(0, 300 ** 2 - (y - cy) ** 2)) - 20;
        const amp = 14 + (i % 3) * 6;
        let d = `M${(cx - half).toFixed(0)} ${y}`;
        for (let k = 1; k <= 6; k++) {
          const x = cx - half + (k * 2 * half) / 6;
          d += ` Q${(x - half / 6).toFixed(0)} ${y + (k % 2 ? -amp : amp)} ${x.toFixed(0)} ${y}`;
        }
        return `<path d="${d}" stroke="#F6DFA4" stroke-width="11" fill="none" stroke-linecap="round" opacity="0.95"/>`;
      }).join('');
      return `<rect width="${w}" height="${h}" fill="#3D5A5B"/>
        <circle cx="${cx}" cy="${cy}" r="380" fill="#F4F1EA"/>
        <circle cx="${cx}" cy="${cy}" r="330" fill="#A0522D"/>
        <circle cx="${cx}" cy="${cy}" r="330" fill="#C46A2E" opacity="0.6"/>
        ${noodles}
        <ellipse cx="${cx + 120}" cy="${cy - 120}" rx="70" ry="44" fill="#7A3E1D"/>
        <ellipse cx="${cx - 140}" cy="${cy + 130}" rx="64" ry="40" fill="#7A3E1D"/>
        ${Array.from({ length: 16 }, (_, i) => `<circle cx="${cx - 200 + (i * 47) % 400}" cy="${cy - 160 + ((i * 89) % 320)}" r="10" fill="#6BBF59"/>`).join('')}`;
    },
  },
  {
    name: 'demo-photo-07.jpg', w: 900, h: 1200, title: '灯笼',
    svg: (w, h) => {
      const lanterns = [];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
          const x = (col + 0.5) * (w / 3) + (row % 2 ? 40 : -40);
          const y = 180 + row * 270;
          lanterns.push(`<circle cx="${x}" cy="${y}" r="110" fill="#FF7B54" opacity="0.18"/>
            <line x1="${x}" y1="${y - 160}" x2="${x}" y2="${y - 70}" stroke="#2B0F0F" stroke-width="4"/>
            <ellipse cx="${x}" cy="${y}" rx="62" ry="76" fill="#D62828"/>
            <ellipse cx="${x}" cy="${y}" rx="30" ry="76" fill="#F77F00" opacity="0.35"/>
            <rect x="${x - 30}" y="${y - 82}" width="60" height="12" rx="4" fill="#FCBF49"/>
            <rect x="${x - 30}" y="${y + 70}" width="60" height="12" rx="4" fill="#FCBF49"/>`);
        }
      }
      return `<rect width="${w}" height="${h}" fill="#3A0D0D"/>${lanterns.join('')}`;
    },
  },
  {
    name: 'demo-photo-08.jpg', w: 1200, h: 900, title: '海边日落',
    svg: (w, h) => `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3D2C8D"/><stop offset="0.45" stop-color="#E76F51"/><stop offset="0.62" stop-color="#F4A261"/></linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9C46A"/><stop offset="0.3" stop-color="#2A6F97"/><stop offset="1" stop-color="#013A63"/></linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <circle cx="${w * 0.5}" cy="${h * 0.62}" r="${h * 0.13}" fill="#FFE8B0"/>
      <rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="url(#sea)"/>
      ${hills(w, h, h * 0.86, 18, '#F1D7A8', 0.8, 40)}`,
  },
];

function svgDoc(inner, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}

async function renderSvg(page, svg, w, h, { type, transparent = false, quality } = {}) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:${transparent ? 'transparent' : '#ffffff'}}svg{display:block}</style></head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  return page.screenshot({ type, omitBackground: transparent, quality, clip: { x: 0, y: 0, width: w, height: h } });
}

function pngSize(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1]);
  return { w, h };
}

async function main() {
  mkdirSync(ICON_DIR, { recursive: true });
  mkdirSync(PHOTO_DIR, { recursive: true });
  mkdirSync(FILES_DIR, { recursive: true });
  const browser = await launchChrome();
  try {
    const page = await browser.newPage();

    console.log('PWA 图标：');
    for (const icon of ICONS) {
      const src = readFileSync(path.join(ICON_DIR, icon.src), 'utf8')
        .replace(/<svg /, `<svg width="${icon.size}" height="${icon.size}" `);
      const buf = await renderSvg(page, src, icon.size, icon.size, { type: 'png', transparent: icon.transparent });
      const file = path.join(ICON_DIR, icon.out);
      writeFileSync(file, buf);
      const { w, h } = pngSize(file);
      if (w !== icon.size || h !== icon.size) throw new Error(`${icon.out} 尺寸不对：${w}×${h}`);
      console.log(`  ${icon.out.padEnd(24)} ${w}×${h}  ${(statSync(file).size / 1024).toFixed(1)} KB`);
    }

    console.log('演示照片：');
    for (const photo of PHOTOS) {
      const svg = svgDoc(`${photo.svg(photo.w, photo.h)}${mark(photo.w, photo.h)}`, photo.w, photo.h);
      const buf = await renderSvg(page, svg, photo.w, photo.h, { type: 'jpeg', quality: 80 });
      const file = path.join(PHOTO_DIR, photo.name);
      writeFileSync(file, buf);
      console.log(`  ${photo.name.padEnd(24)} ${photo.w}×${photo.h}  ${(statSync(file).size / 1024).toFixed(1)} KB  ${photo.title}`);
    }

    console.log('演示确认单 PDF：');
    await page.setViewport({ width: 800, height: 1000, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,"PingFang SC",sans-serif;color:#1d1d1f;margin:40px}
      h1{font-size:22px;margin:0 0 4px} p{color:#5c5c63;margin:0 0 24px}
      table{border-collapse:collapse;width:100%} td{padding:10px 0;border-bottom:1px solid #e5e5ea;font-size:14px}
      td:first-child{color:#5c5c63;width:30%} .note{margin-top:28px;font-size:12px;color:#8a4b00}
    </style></head><body>
      <h1>航班确认单（演示）</h1><p>示例航空 · 本文件为演示用虚构内容</p>
      <table>
        <tr><td>订单号</td><td>DEMO-FL01</td></tr>
        <tr><td>航班</td><td>DM801 · HKG → VCS</td></tr>
        <tr><td>日期</td><td>2027-01-10 08:05 起飞</td></tr>
        <tr><td>乘客</td><td>2 人（演示）</td></tr>
        <tr><td>行李</td><td>手提 7kg，加购托运 20kg × 1</td></tr>
      </table>
      <p class="note">这是演示模式用的假文件，不对应任何真实订单。</p>
    </body></html>`, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A5', printBackground: true });
    const pdfFile = path.join(FILES_DIR, 'demo-confirmation.pdf');
    writeFileSync(pdfFile, pdf);
    console.log(`  demo-confirmation.pdf      ${(statSync(pdfFile).size / 1024).toFixed(1)} KB`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
