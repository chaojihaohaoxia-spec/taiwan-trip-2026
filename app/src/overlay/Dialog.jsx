// =====================================================================
// overlay/Dialog.jsx：居中的确认框（iOS 提示框风格，替代原生 confirm / alert）。
//
// 两种用法：
//   1. 命令式（最常用）：
//        import { confirm, alert } from '../overlay/index.js';
//        if (await confirm({ title: '删除这笔记账？', message: '删除后 6 秒内可以撤销。', confirmText: '删除', destructive: true })) …
//      由 OverlayHost 里的 DialogHost 显示；进历史（?sheet=…,confirm:c3），返回手势 = 取消；同时只显示一个，后来的排队。
//   2. 声明式（网址驱动，和 Sheet 一样）：
//        <Dialog sheetId="confirm-leave" title="离开这一页？" actions={[{ label: '留下', role: 'cancel' }, { label: '离开', role: 'destructive', onSelect: leave }]} />
//
// 行为：标题 + 说明 + 按钮（两个短按钮横排，否则竖排）；取消在左（竖排时在最下）；
//   危险操作红字、取消加粗，焦点默认落在“取消”上（回车不会误删）；Esc / 返回手势 = 取消；
//   默认点遮罩不关（iOS 提示框的习惯），可以用 closeOnScrim 打开；
//   出场：从 1.08 倍缩回（--spring-snappy）+ 淡入；退场：淡出 + 轻微缩小；减弱动态效果时只淡入淡出。
//   动画用 motion/animate.js（缩放是弹簧通道，透明度见 transitions.js），都可以半路打断。
// =====================================================================

import './overlay.css';
import './Dialog.css';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { Portal } from './Portal.jsx';
import { OverlayContext, useLayer, useOverlayRoute } from './binding.js';
import { claimSheet } from './manager.js';
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { prefersReducedMotion } from '../lib/media.js';
import { CH, fadeTo, prepareHidden } from './transitions.js';
import { uid } from './dom.js';
import { DIALOG_SHEET_ID, activeDialog, renderedDialogs, settleDialog, removeRenderedDialog } from './dialogs.js';

const renderScale = ({ s }) => ({ transform: `scale(${num(s, 4)})` });
/** 退场时的轻微缩小：很快、不回弹的弹簧 */
const SHRINK = Object.freeze({ duration: 0.2, bounce: 0 });

/** 框的缩放（弹簧通道：被打断时从当前大小、当前速度接着走） */
function scaleTo(el, s, { from, spring = 'snappy' } = {}) {
  return animateSpring(el, {
    channel: CH.scale,
    current: () => ({ s: from ?? 1 }),
    to: { s },
    spring,
    commit: 'clear',
    render: renderScale,
  });
}

/**
 * @typedef {Object} DialogAction
 * @property {string} label
 * @property {'cancel'|'destructive'|'default'} [role='default']
 * @property {any} [value]                 命令式确认框用：点了它，confirm() 得到这个值
 * @property {boolean} [preferred]         加粗（默认：有危险操作时“取消”加粗，否则确认类按钮加粗）
 * @property {() => any} [onSelect]        弹层关掉后执行
 * @property {string} [testId]
 */

/**
 * @param {Object} props
 * @param {string} props.sheetId
 * @param {string|null} [props.arg]
 * @param {any} props.title
 * @param {any} [props.message]
 * @param {any} [props.children]          说明下面的自定义内容
 * @param {DialogAction[]} [props.actions] 默认只有一个「好」
 * @param {boolean} [props.closeOnScrim=false]
 * @param {boolean} [props.closeOnEsc=true]
 * @param {(action: DialogAction) => void} [props.onAction]  点了按钮（关闭之前）
 * @param {() => void} [props.onDismiss]   网址里它没了（任何原因关闭）的那一刻
 * @param {() => void} [props.onClosed]    退场动画播完
 * @param {boolean} [props.claim=true]
 * @param {string} [props.testId]
 */
export function Dialog(props) {
  const ov = useOverlayRoute(props.sheetId, { kind: 'dialog', arg: props.arg, claim: props.claim !== false });
  if (!ov.mounted) return null;
  return (
    <Portal>
      <DialogLayer {...props} ov={ov} />
    </Portal>
  );
}

function DialogLayer(props) {
  const {
    ov, title, message, children, closeOnScrim = false, closeOnEsc = true, onAction, onDismiss, onClosed, testId,
  } = props;
  const actions = props.actions?.length ? props.actions : [{ label: '好', role: 'default' }];
  const layerRef = useRef(null);
  const scrimRef = useRef(null);
  const boxRef = useRef(null);
  const actionRefs = useRef([]);
  const motion = useRef({ token: 0 });
  const ids = useMemo(() => ({ title: uid('ov-dialog-title'), message: uid('ov-dialog-message') }), []);

  const hasDestructive = actions.some((a) => a.role === 'destructive');
  const preferredIndex = (() => {
    const explicit = actions.findIndex((a) => a.preferred);
    if (explicit !== -1) return explicit;
    if (hasDestructive) return actions.findIndex((a) => a.role === 'cancel');
    const confirmLike = actions.map((a, i) => ({ a, i })).filter(({ a }) => a.role !== 'cancel').pop();
    return confirmLike ? confirmLike.i : 0;
  })();
  const layout = actions.length === 2 && actions.every((a) => String(a.label).length <= 6) ? 'row' : 'column';
  // 竖排时“取消”放最下面；横排时放左边
  const ordered = actions.map((a, i) => ({ a, i }));
  if (layout === 'column') ordered.sort((x, y) => (x.a.role === 'cancel') - (y.a.role === 'cancel'));
  else ordered.sort((x, y) => (y.a.role === 'cancel') - (x.a.role === 'cancel'));

  // 挂上的第一帧：框和遮罩都透明（出场动画从这里开始）
  useLayoutEffect(() => prepareHidden(boxRef.current, scrimRef.current), []);

  const enter = () => {
    motion.current.token += 1;
    const box = boxRef.current;
    if (prefersReducedMotion.peek()) {
      fadeTo(box, 1, 'reduced');
      fadeTo(scrimRef.current, 1, 'reduced');
      return;
    }
    scaleTo(box, 1, { from: 1.08 });
    fadeTo(box, 1, 'in');
    fadeTo(scrimRef.current, 1, 'in');
  };

  const exit = () => {
    motion.current.token += 1;
    const token = motion.current.token;
    const box = boxRef.current;
    const reduced = prefersReducedMotion.peek();
    const jobs = [
      fadeTo(box, 0, reduced ? 'reduced' : 'out'),
      fadeTo(scrimRef.current, 0, reduced ? 'reduced' : 'out-slow'),
    ];
    if (!reduced) jobs.push(scaleTo(box, 0.97, { spring: SHRINK }));
    Promise.all(jobs.map((a) => a.finished)).then((done) => {
      if (token !== motion.current.token || !done.every(Boolean)) return;
      ov.onExited();
      onClosed?.();
    });
  };

  const wasOpen = useRef(ov.open);
  useLayoutEffect(() => {
    if (ov.open) enter();
    else {
      exit();
      if (wasOpen.current) onDismiss?.();
    }
    wasOpen.current = ov.open;
  }, [ov.open]);

  useLayer(ov, {
    layerRef,
    focusRef: boxRef,
    closeOnEsc,
    initialFocus: () => boxRef.current?.querySelector('[data-autofocus]') || actionRefs.current[preferredIndex] || boxRef.current,
  });

  const choose = async (action) => {
    onAction?.(action);
    await ov.requestClose('action');
    action.onSelect?.();
  };

  const ctx = useMemo(() => ({ sheetId: ov.sheetId, arg: ov.arg, close: (r = 'action') => ov.requestClose(r) }), [ov.sheetId, ov.arg]);

  return (
    <OverlayContext.Provider value={ctx}>
      <div
        ref={layerRef}
        class="ov-layer ov-layer--dialog"
        data-overlay-layer=""
        data-kind="dialog"
        data-sheet-id={ov.sheetId}
        data-state={ov.open ? 'open' : 'closing'}
        style={{ zIndex: ov.z }}
      >
        <div
          ref={scrimRef}
          class="ov-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && closeOnScrim) ov.requestClose('scrim');
          }}
        />
        <div class="ov-dialog-wrap">
          <div
            ref={boxRef}
            class="ov-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={ids.title}
            aria-describedby={message ? ids.message : undefined}
            tabIndex={-1}
            data-testid={testId}
          >
            <div class="ov-dialog__content">
              <h2 id={ids.title} class="ov-dialog__title">{title}</h2>
              {message && <p id={ids.message} class="ov-dialog__message">{message}</p>}
              {children}
            </div>
            <div class="ov-dialog__actions" data-layout={layout}>
              {ordered.map(({ a, i }) => (
                <button
                  key={`${i}-${a.label}`}
                  ref={(el) => { actionRefs.current[i] = el; }}
                  type="button"
                  class="ov-dialog__action"
                  data-press="scale"
                  data-role={a.role || 'default'}
                  data-preferred={i === preferredIndex ? 'true' : undefined}
                  data-testid={a.testId}
                  onClick={() => choose(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </OverlayContext.Provider>
  );
}

/**
 * 命令式确认框的显示者（OverlayHost 里挂一个）。认领 'confirm' 这个弹层 id，
 * 但只认当前排队中的那一个参数（刷新后网址里残留的 confirm:xx 会被当作不认识的弹层清掉）。
 */
export function DialogHost() {
  useLayoutEffect(() => claimSheet(DIALOG_SHEET_ID, { kind: 'dialog', accepts: (arg) => activeDialog.peek()?.token === arg }), []);
  const list = renderedDialogs.value;
  return list.map((req) => {
    const o = req.options;
    const actions = req.type === 'alert'
      ? [{ label: o.okText || '好', role: 'default', value: undefined, testId: 'dialog-ok' }]
      : [
        { label: o.cancelText || '取消', role: 'cancel', value: false, testId: 'dialog-cancel' },
        { label: o.confirmText || '确定', role: o.destructive ? 'destructive' : 'default', value: true, testId: 'dialog-confirm' },
      ];
    return (
      <Dialog
        key={req.token}
        sheetId={DIALOG_SHEET_ID}
        arg={req.token}
        claim={false}
        title={o.title || (req.type === 'alert' ? '提示' : '确定吗？')}
        message={o.message}
        actions={actions}
        closeOnScrim={Boolean(o.closeOnScrim)}
        testId="dialog"
        onAction={(a) => settleDialog(req.token, a.value)}
        onClosed={() => removeRenderedDialog(req.token)}
      />
    );
  });
}
