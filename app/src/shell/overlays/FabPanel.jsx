// =====================================================================
// shell/overlays/FabPanel.jsx：＋ 快速添加面板（sheet id fab；样稿 03-加号面板.png、13 / 14-帧条）。
//
// 从底栏的 ＋ 原位长出来（overlay/AnchoredPanel，加号转 ×；纸本：tintOnEnter={false}，不先盖一大块实心海色，
// 是纸色的面板从按钮的形状长出来、内容跟着淡入）；底栏这时浮在面板上面、一直能点。
// 收回：原路缩回 ＋，最后一段淡掉（tintOnExit={false}：底栏浮在面板上面，染成按钮色的形状会从底栏上沿冒出一块青绿，
// 样稿 14-帧条里是白色的形状缩进加号）。
// 五个动作（打开 sheets/ 的弹层，参数照 sheets/index.js 的帮手写）：
//   记一笔     expense   openExpenseSheet({ date })            （进行中：放第一个、最大，副标题是今天记了几笔）
//   拍照打卡   journal   瓷砖上叠透明的 <input type=file capture>：点了直接开相机，拍完 checkInWith(files, { date })（sheets/journal/capture.js）
//   写日记     journal   openJournalSheet({ date, mode: 'text' })
//   加条目     item      openItemSheet({ date })
//   加待办     todo      openTodoSheet({ list: 'todo' })
// 只读成员：记一笔 / 加条目 / 加待办变淡、不能点，副标题写原因（view-rules.js 的 fabActions）。
// date：在某一天的页面上就是那天；行程进行中是今天；否则不预填。
// 外观（「杂志纸本」）：像酒店房间手册的目录——一列单色的行，线条图标 + 宋体名字 + 一行灰字说明，行间细线。
// 顺序按阶段：进行中「记一笔」放第一行、大一号；出发前先「加条目」「加待办」；回顾先「写日记」。
//
// 衔接：点了以后面板先原路收回到 ＋（--spring-smooth），同时目标面板从底部滑上来——两段动画同时进行，
// 中间没有空白帧（e2e 截半路图核对）；历史里只留目标面板一条（返回手势直接回到页面）。
// 记一笔的金额输入框要在 iOS 上直接弹出键盘：点击回调里同步 primeKeyboard()（先让隐藏输入框接住焦点），
// 目标面板里 data-autofocus 的输入框挂上后接过焦点。
// =====================================================================

import './overlays.css';
import { AnchoredPanel } from '../../overlay/AnchoredPanel.jsx';
import { closeOverlay } from '../../overlay/manager.js';
import { primeKeyboard } from '../../overlay/focus.js';
import { route } from '../../router/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { openExpenseSheet, openJournalSheet, openItemSheet, openTodoSheet } from '../../sheets/index.js';
import { checkInWith } from '../../sheets/journal/capture.js';
import { tripInfo, tripStore } from '../trip-state.js';
import { fabActions } from '../view-rules.js';

/** 面板底边离 ＋ 按钮顶边多远：让面板停在底栏胶囊上方 12px（按钮顶边比胶囊顶边低 7px） */
const GAP = 19;

/** 预填哪天：在某一天的页面上就是那天，行程进行中是今天 */
function prefillDate(r, info) {
  if (r?.name === 'day') return r.params.date;
  if (info?.phase?.phase === 'ongoing') return info.today;
  return undefined;
}

export default function FabPanel() {
  const info = tripInfo.value;
  const store = tripStore.value;
  const phase = info?.phase?.phase || 'upcoming';
  const today = info?.today;
  const todayCount = phase === 'ongoing' && store ? store.view.expenses.value.filter((e) => e.date === today).length : 0;
  const canEdit = store ? store.view.canEdit.value !== false : true;
  const actions = fabActions({ phase, localCurrency: info?.trip?.local_currency, todayCount, canEdit });

  const run = (id) => {
    const r = route.peek();
    const date = prefillDate(r, info);
    // iOS：要弹键盘的面板，必须在点击回调里同步把键盘叫出来
    if (id === 'expense' || id === 'todo') primeKeyboard();
    const open = {
      expense: () => openExpenseSheet(date ? { date } : undefined),
      photo: () => openJournalSheet({ date, mode: 'photo' }),
      journal: () => openJournalSheet({ date, mode: 'text' }),
      item: () => openItemSheet(date ? { date } : undefined),
      todo: () => openTodoSheet({ list: 'todo' }),
    }[id];
    // 先收回 ＋ 面板（历史退一格），网址更新后再打开目标面板：两段动画同时在播，衔接处不空
    closeOverlay('fab', { force: true }).then(open);
  };

  // 拍照打卡一步到位：瓷砖上叠一层透明的 <input type="file" capture>，手指点到的就是它——iOS 只认落在 file input 上的
  // 真实点击才一定弹相机（先开面板、面板里再叫相机在 iPhone 上不可靠）。拍完：收回 ＋ 面板，照片交给写日记面板（mode=photo）。
  // 取消拍照什么都不发生，＋ 面板还开着。
  const onPhotos = (e) => {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = '';
    if (!files.length) return;
    const date = prefillDate(route.peek(), info);
    closeOverlay('fab', { force: true }).then(() => checkInWith(files, date ? { date } : {}));
  };

  return (
    <AnchoredPanel sheetId="fab" placement="above" align="center" width={520} gap={GAP} title="快速添加" class="fab-panel" testId="fab-panel" tintOnEnter={false} tintOnExit={false}>
      <div class="fab-grid" data-phase={phase}>
        {actions.map((a) => {
          const inner = (
            <>
              <span class="fab-tile__ico" aria-hidden="true"><Glyph name={a.glyph} size={24} /></span>
              <span class="fab-tile__text" aria-hidden={a.id === 'photo' ? 'true' : undefined}>
                <b>{a.title}</b>
                <i>{a.hint}</i>
              </span>
            </>
          );
          const common = {
            class: a.id === 'photo' ? 'fab-tile fab-tile--file' : 'fab-tile',
            'data-hero': a.hero ? '' : undefined,
            'data-disabled': a.disabled ? '' : undefined,
            'data-press': a.disabled ? undefined : 'scale',
            'data-testid': `fab-${a.id}`,
          };
          if (a.id === 'photo') {
            return (
              <span key={a.id} {...common}>
                {inner}
                <input
                  class="fab-tile__file"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label={`${a.title}：${a.hint}`}
                  data-testid="fab-photo-input"
                  onChange={onPhotos}
                />
              </span>
            );
          }
          return (
            <button key={a.id} type="button" {...common} disabled={a.disabled} aria-label={a.disabled ? `${a.title}：${a.hint}` : undefined} onClick={() => run(a.id)}>
              {inner}
            </button>
          );
        })}
      </div>
    </AnchoredPanel>
  );
}
