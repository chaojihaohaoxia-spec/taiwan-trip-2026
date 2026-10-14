// =====================================================================
// overlay/dialogs.js：命令式确认框 confirm() / alert() 的排队状态（替代原生 window.confirm）。
//
//   if (await confirm({ title: '删除这笔记账？', message: '删除后可以在 5 秒内撤销。', confirmText: '删除', destructive: true })) { … }
//   await alert({ title: '已复制', message: '订单号已复制到剪贴板。' });
//
// 每个确认框也进历史记录（?sheet=…,confirm:c3）：手机返回手势 = 取消。
// 同时只显示一个确认框（同类只能开一个），后来的排队，前一个关掉后再出现。
// 显示由 OverlayHost 里的 DialogHost 负责（Dialog.jsx）。刷新页面时网址里残留的 confirm:xx
// 没有对应的请求，会被当作“不认识的弹层”清掉。
// =====================================================================

import { signal, effect } from '@preact/signals';
import { route } from '../router/index.js';
import { openOverlay } from './manager.js';

/** 命令式确认框用的弹层 id */
export const DIALOG_SHEET_ID = 'confirm';

let seq = 0;
/** 排队中的请求 */
const queue = [];

/**
 * @typedef {Object} DialogRequest
 * @property {string} token       弹层参数（网址里的 confirm:<token>）
 * @property {'confirm'|'alert'} type
 * @property {object} options
 * @property {(value: any) => void} resolve
 * @property {any} result         用户点了哪个按钮（还没点是 undefined）
 * @property {any} cancelValue    被取消（返回手势、Esc、点遮罩）时的结果
 */

/** 当前正在显示的请求（没有为 null） */
export const activeDialog = signal(null);
/** 正在显示或退场中的请求（DialogHost 按它渲染，退场动画播完再移除） */
export const renderedDialogs = signal([]);

function pump() {
  if (activeDialog.peek() || !queue.length) return;
  const req = queue.shift();
  activeDialog.value = req;
  renderedDialogs.value = [...renderedDialogs.peek(), req];
  openOverlay(DIALOG_SHEET_ID, { arg: req.token }).then(
    () => {
      // 网址里这个确认框没了（点按钮、返回手势、Esc、换页……）就交出结果
      let stop = null;
      let done = false;
      stop = effect(() => {
        const r = route.value;
        if (done || !r) return;
        if (!r.sheets.some((s) => s.id === DIALOG_SHEET_ID && s.arg === req.token)) {
          done = true;
          queueMicrotask(() => stop?.());
          finishDialog(req.token);
        }
      });
      if (done) queueMicrotask(() => stop?.());
    },
    (error) => {
      console.error('[overlay] 打开确认框失败', error);
      finishDialog(req.token);
      removeRenderedDialog(req.token);
    },
  );
}

function enqueue(type, options, cancelValue) {
  return new Promise((resolve) => {
    seq += 1;
    queue.push({ token: `c${seq}`, type, options: { ...(options || {}) }, resolve, result: undefined, cancelValue });
    pump();
  });
}

/**
 * 确认框。用户点“确定”类按钮 → true；点取消、返回手势、Esc → false。
 * @param {{ title: string, message?: string, confirmText?: string, cancelText?: string, destructive?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirm(options) {
  return enqueue('confirm', options, false);
}

/**
 * 只有一个按钮的提示框。
 * @param {{ title: string, message?: string, okText?: string }} options
 * @returns {Promise<void>}
 */
export function alert(options) {
  return enqueue('alert', options, undefined);
}

/** 用户点了按钮：记下结果（关闭由 Dialog 发起，关掉后 finishDialog 交出结果） */
export function settleDialog(token, value) {
  const req = activeDialog.peek();
  if (req && req.token === token) req.result = value;
}

/** 网址里这个确认框没了（点按钮、返回手势、Esc、换页都会走到这里）：交出结果，放下一个出来 */
export function finishDialog(token) {
  const req = activeDialog.peek();
  if (!req || req.token !== token) return;
  activeDialog.value = null;
  req.resolve(req.result === undefined ? req.cancelValue : req.result);
  queueMicrotask(pump);
}

/** 退场动画播完：从渲染列表里移除 */
export function removeRenderedDialog(token) {
  renderedDialogs.value = renderedDialogs.peek().filter((r) => r.token !== token);
}
