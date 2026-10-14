// =====================================================================
// scripts/lib/chrome.mjs：启动本机 Chrome（puppeteer-core，不下载浏览器）。
// 生成图标/演示图片的脚本、e2e 测试、截图工具 shoot.mjs 共用。
//
// Chrome 路径默认 /Applications/Google Chrome.app/…，可用环境变量 CHROME_PATH 覆盖。
// 每次启动都用一个全新的临时用户目录（系统临时目录下的 rs7885-chrome-XXXXXX，关浏览器时删掉）：
// 不碰你平时用的 Chrome 配置、不带任何登录状态；几个 e2e / 截图同时跑也互不干扰
// （各自的缓存、IndexedDB、Service Worker 完全分开）。调试端口由 Chrome 自己挑空闲的。
// 设 HEADFUL=1 可以看到浏览器窗口（调试 e2e 用）。
// =====================================================================

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME_PATH } from './paths.mjs';

/**
 * @param {string[]} [extraArgs]  额外的命令行参数
 * @param {{ userDataDir?: string }} [o]  指定用户目录（调用方自己负责清理）；不传就建临时目录、关闭时删掉
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function launchChrome(extraArgs = [], o = {}) {
  if (!existsSync(CHROME_PATH)) {
    throw new Error(`找不到 Chrome：${CHROME_PATH}\n请安装 Google Chrome，或用环境变量 CHROME_PATH 指定路径。`);
  }
  const ownDir = !o.userDataDir;
  const userDataDir = o.userDataDir || mkdtempSync(path.join(os.tmpdir(), 'rs7885-chrome-'));
  const remove = () => {
    try {
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return true;
    } catch {
      return false;
    }
  };
  // Chrome 进程刚退出时可能还在写文件：删不掉就过一会儿再删一次（失败也不抛，临时目录系统会清）
  const cleanup = () => {
    if (ownDir && !remove()) setTimeout(remove, 1000).unref?.();
  };
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: process.env.HEADFUL ? false : true,
      userDataDir,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-features=Translate,OptimizationHints,MediaRouter',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--lang=zh-CN',
        ...extraArgs,
      ],
      defaultViewport: null,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
  // Chrome 进程真正退出以后再删临时用户目录（断开连接时 Chrome 还在收尾、还在写配置目录，
  // 那时删会让它崩溃退出，崩溃处理进程留着 stderr 管道不放，测试进程就一直等着退不出来）
  const proc = browser.process();
  if (proc && proc.exitCode === null && proc.signalCode === null) proc.once('exit', cleanup);
  else browser.once('disconnected', cleanup);
  return browser;
}
