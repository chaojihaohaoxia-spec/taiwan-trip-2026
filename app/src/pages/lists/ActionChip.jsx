// =====================================================================
// pages/lists/ActionChip.jsx：从备注里认出来的「打电话 / WhatsApp / 写邮件 / 打开网页」小胶囊（model.js 的 noteActions）。
// 清单页的一行（TodoRow）和待办弹层（sheets/todo，备注下面）共用；样式自带（action-chip.css），弹层从别的页面打开时也有样子。
//
//   <NoteActions note={todo.note} title={todo.title} />     一排（没有认出来的就什么都不渲染）
//   <ActionChip a={noteActions(...)[0]} />                  单个
//
// 点了走 lib/native.js 的 openExternal：App 外壳里交给外壳；网页 tel: / mailto: / wa.me 同一个窗口（iOS 才唤起拨号、WhatsApp），
// 普通网页开新标签页（不把当前页换掉）。按下和别的小胶囊一样缩一下；长按照样出 iOS 的「拨打 / 拷贝」菜单（CSS 放开了 touch-callout）。
// 点击不往外冒泡：清单行整行是「编辑」按钮，点胶囊不能顺带打开编辑。
// =====================================================================

import './action-chip.css';
import { Glyph } from '../../kit/Glyph.jsx';
import { openExternal } from '../../lib/native.js';
import { noteActions } from './model.js';

/** 动作 → 图形（kit/glyphs.js） */
const ACTION_GLYPHS = Object.freeze({ tel: 'call', whatsapp: 'message', mail: 'message', url: 'external' });

/**
 * @param {{ a: { type: string, href: string, label: string, aria: string }, class?: string }} props
 */
export function ActionChip({ a, class: cls }) {
  return (
    <a
      class={`lact lact--${a.type}${cls ? ` ${cls}` : ''}`}
      data-press="scale"
      href={a.href}
      rel="noopener noreferrer"
      aria-label={a.aria}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternal(a.href, { newTab: a.type === 'url' });
      }}
      data-testid={`note-action-${a.type}`}
    >
      <Glyph name={ACTION_GLYPHS[a.type] || 'external'} size={14} stroke={2} />
      {a.type === 'whatsapp' && <span class="lact__pre">WhatsApp</span>}
      <span class="lact__label">{a.label}</span>
    </a>
  );
}

/**
 * 备注里认出来的一排（弹层里用；清单行把它们和关联的小链接排在同一排，直接用 ActionChip）。
 * @param {{ note?: string|null, title?: string, class?: string, testId?: string }} props
 */
export function NoteActions({ note, title = '', class: cls, testId = 'note-actions' }) {
  const acts = noteActions(note, { title });
  if (!acts.length) return null;
  return (
    <div class={cls ? `lact-row ${cls}` : 'lact-row'} data-testid={testId}>
      {acts.map((a) => <ActionChip key={a.href} a={a} />)}
    </div>
  );
}
