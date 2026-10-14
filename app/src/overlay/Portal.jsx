// =====================================================================
// overlay/Portal.jsx：把子树渲染到弹层挂载点（#overlay-root）里。
//
// 为什么要挪出去：页面里任何祖先元素带 transform / filter / contain 都会让 position: fixed 失效，
// 层叠上下文也会把 z-index 关在里面；弹层挂在 body 下的 #overlay-root，才能稳稳盖住顶栏、底栏。
//
// 不用 preact/compat 的 createPortal：compat 会全局改写事件行为（onChange 变 onInput 等），影响别的模块。
// 这里每个 Portal 自己建一个容器 <div>，用 preact 的 render() 渲染进去；
// 同时把外面的 context 原样传进去（和 compat 的做法一样），弹层里照样能用 useContext。
// =====================================================================

import { Component, h, render } from 'preact';
import { overlayRoot } from './dom.js';

/** 把外层的全部 context 透传进独立的渲染根 */
function ContextBridge(props) {
  this.getChildContext = () => props.context;
  return props.children;
}

export class Portal extends Component {
  componentDidMount() {
    this.host = document.createElement('div');
    this.host.className = 'ov-portal';
    overlayRoot().appendChild(this.host);
    this.paint();
  }

  componentDidUpdate() {
    this.paint();
  }

  componentWillUnmount() {
    if (!this.host) return;
    render(null, this.host);
    this.host.remove();
    this.host = null;
  }

  paint() {
    if (this.host) render(h(ContextBridge, { context: this.context }, this.props.children), this.host);
  }

  render() {
    return null;
  }
}
