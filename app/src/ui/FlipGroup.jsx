// =====================================================================
// ui/FlipGroup.jsx：属性驱动的 FLIP 容器。trigger 一变，里面所有 [data-flip-key] 元素
// 从旧位置平滑移到新位置（排序、增删、列表 ↔ 网格、筛选）。
//
//   <FlipGroup as="ul" class="list" trigger={items.map((i) => i.id).join()} options={{ spring: 'smooth' }}>
//     {items.map((it) => <li key={it.id} data-flip-key={it.id}>…</li>)}
//   </FlipGroup>
//
// 原理：Preact 的 getSnapshotBeforeUpdate 在“新内容算好了、还没写进 DOM”时调用 —— 这时记下旧位置；
// componentDidUpdate（DOM 已更新、浏览器还没绘制）里播放。所以不会闪、不需要 setTimeout。
// options 见 motion/flip.js 的 playFlip（spring、stagger、enter、exit、enterFrom…）。
// elRef 拿到容器元素。
// =====================================================================

import { Component } from 'preact';
import { captureLayout, playFlip } from '../motion/flip.js';
import { setRef } from './util.js';

export class FlipGroup extends Component {
  constructor(props) {
    super(props);
    this.root = null;
    this.setRoot = (el) => {
      this.root = el;
      setRef(this.props.elRef, el);
    };
  }

  getSnapshotBeforeUpdate(prevProps) {
    if (!this.root || Object.is(prevProps.trigger, this.props.trigger)) return null;
    return captureLayout(this.root, { selector: this.props.options?.selector });
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    if (snapshot && this.root) {
      const done = playFlip(snapshot, this.root, this.props.options || {});
      this.props.onFlip?.(done);
    }
  }

  render({ as: Tag = 'div', trigger, options, elRef, onFlip, children, ...rest }) {
    return (
      <Tag ref={this.setRoot} {...rest}>
        {children}
      </Tag>
    );
  }
}
