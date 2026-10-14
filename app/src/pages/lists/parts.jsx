// =====================================================================
// pages/lists/parts.jsx：清单页的几个小部件。
//
//   <ProgressRing done total />     进度圆环（「3/9」，完成的那一段弹簧补上去）
//   <PanelHead … />                 一张清单卡片的头：「还有 6 件事要办」（大号数字）+ 快到期提醒 + 进度圆环；
//                                   全部勾完时换成 <Celebrate>
//   <Celebrate play … />            全部完成：圆环画满、对勾描出来、几粒小光点轻轻散开（克制，不放彩带）；
//                                   只在“刚刚勾完最后一项”时播，平时打开就是静止的样子
//   <DoneDivider … />               「已完成 3 · 收起 / 展开」分隔行
//   <ReadOnlyNote />                只读成员的说明
// =====================================================================

import { Fragment } from 'preact';
import { Glyph } from '../../kit/Glyph.jsx';
import { MorphIcon } from '../../ui/index.js';
import { LISTS, joinWords } from './model.js';

const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

/**
 * 进度圆环（44×44）：底圈 + 完成的弧（stroke-dashoffset 过渡），中间「3/9」。
 * @param {{ done: number, total: number, label?: string }} props
 */
export function ProgressRing({ done, total, label }) {
  const ratio = total ? Math.min(1, done / total) : 0;
  return (
    <span
      class="lring"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={label || `已完成 ${done} 项，共 ${total} 项`}
      data-full={total && done >= total ? '' : undefined}
    >
      <svg class="lring__svg" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <circle class="lring__track" cx="22" cy="22" r={RING_R} />
        <circle
          class="lring__arc"
          cx="22"
          cy="22"
          r={RING_R}
          style={{ strokeDasharray: `${RING_C.toFixed(2)}`, strokeDashoffset: `${(RING_C * (1 - ratio)).toFixed(2)}` }}
        />
      </svg>
      <span class="lring__text" aria-hidden="true">
        <b>{done}</b>
        <i>/{total}</i>
      </span>
    </span>
  );
}

/**
 * 卡片头。
 * @param {{ list: string, open: number, progress: { done: number, total: number }, due?: { tone: string, parts: string[] } | null,
 *           zone?: string|null, who?: string|null, celebrate?: 'static'|'play'|null, extra?: any }} props
 *   open：还没勾的（按数据算：一勾数字马上变，行过一会儿才沉下去）；who：「谁的东西」筛选的人名（打包）；
 *   zone：时区说明（model.js 的 zoneNote：「截止时间按越南时间（比香港慢 1 小时）」，行里不再重复）；
 *   extra：放在左边文字下面的一个小控件（打包的「隐藏已装好」）
 */
export function PanelHead({ list, open, progress, due, zone = null, who = null, celebrate = null, extra = null }) {
  const meta = LISTS[list] || LISTS.todo;
  if (celebrate) {
    return (
      <div class="lhead lhead--done" data-testid="lists-head">
        <Celebrate list={list} total={progress.total} who={who} play={celebrate === 'play'} />
        {extra && <div class="lhead__extra">{extra}</div>}
      </div>
    );
  }
  return (
    <div class="lhead" data-testid="lists-head">
      <div class="lhead__text">
        <p class="lhead__count" data-testid="lists-remaining">
          <span class="lhead__pre">{who ? joinWords(who, '还有') : '还有'}</span>
          <b class="lhead__n">{open}</b>
          <span class="lhead__unit">{meta.countUnit}</span>
        </p>
        {due && (
          <p class={`lhead__due lhead__due--${due.tone}`} data-testid="lists-due-summary">
            <Glyph name={due.tone === 'danger' ? 'alert' : 'clock'} size={14} stroke={2} />
            <span>
              {/* 每段自己不折行；「 · 」放在段外面（那里的空格才是折行的地方） */}
              {due.parts.map((t, i) => (
                <Fragment key={t}>
                  {i > 0 && '\u00a0· '}
                  <span class="lhead__part">{t}</span>
                </Fragment>
              ))}
            </span>
          </p>
        )}
        {zone && (
          <p class="lhead__zone" data-testid="lists-zone-note">
            <Glyph name="info" size={14} stroke={2} />
            <span>{zone}</span>
          </p>
        )}
        {extra && <div class="lhead__extra">{extra}</div>}
      </div>
      <ProgressRing done={progress.done} total={progress.total} label={`${meta.label}：已完成 ${progress.done} ${meta.unit}，共 ${progress.total} ${meta.unit}`} />
    </div>
  );
}

/** 小光点的方向（度）：六个，不均匀一点更自然 */
const SPARKS = [-78, -22, 28, 86, 148, 212];

/**
 * 全部完成。
 * @param {{ list: string, total: number, who?: string|null, play?: boolean }} props
 */
export function Celebrate({ list, total, who = null, play = false }) {
  const meta = LISTS[list] || LISTS.todo;
  const title = who ? joinWords(who === '共用的' ? '共用的' : joinWords(who, '的'), list === 'packing' ? '都装好了' : '都勾完了') : meta.doneTitle;
  return (
    <div class="lcele" data-play={play ? '' : undefined} data-testid="lists-celebrate" role="status">
      <span class="lcele__mark" aria-hidden="true">
        {SPARKS.map((deg, i) => <i key={deg} class="lcele__spark" style={{ '--lcele-a': `${deg}deg`, '--lcele-i': i }} />)}
        <svg class="lcele__svg" viewBox="0 0 44 44" focusable="false">
          <circle class="lcele__ring" cx="22" cy="22" r={RING_R} pathLength="1" />
          <path class="lcele__tick" d="M14.5 22.6 L19.6 27.6 L29.8 16.6" pathLength="1" />
        </svg>
      </span>
      <span class="lcele__text">
        <span class="lcele__title">{title}</span>
        <span class="lcele__desc">{meta.doneDesc(total)}</span>
      </span>
    </div>
  );
}

/**
 * 「已完成 3」分隔行；整行是按钮：收起 / 展开勾完的（记在本机，每个清单分开记）。
 * @param {{ list: string, count: number, hidden: boolean, onToggle: () => void }} props
 */
export function DoneDivider({ list, count, hidden, onToggle }) {
  const meta = LISTS[list] || LISTS.todo;
  return (
    <button
      type="button"
      class="ldone"
      data-press="highlight"
      aria-expanded={hidden ? 'false' : 'true'}
      onClick={onToggle}
      data-testid="lists-done-toggle"
    >
      <span class="ldone__label">
        {meta.doneSection}
        <b class="ldone__n">{count}</b>
      </span>
      <span class="ldone__action">
        {hidden ? '展开' : '收起'}
        <MorphIcon kind="chevron" state={!hidden} size={16} />
      </span>
    </button>
  );
}

/** 只读成员的说明（编辑入口都藏起来或禁用了，这里说一声为什么） */
export function ReadOnlyNote() {
  return (
    <p class="lro" data-testid="lists-readonly">
      <Glyph name="info" size={16} stroke={2} />
      <span>你是这趟行程的只读成员：能看清单，不能勾选、添加或修改。需要的话请行程的创建者把你改成可编辑。</span>
    </p>
  );
}
