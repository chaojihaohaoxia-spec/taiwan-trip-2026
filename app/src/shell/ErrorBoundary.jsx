// =====================================================================
// shell/ErrorBoundary.jsx：页面级错误兜底。
//
// 一个页面渲染出错，只把这一页换成“出错了”，外壳（顶栏、底栏、更新提示）照常可用。
// 换页（resetKey 变化）或点“重试”会重新渲染：按需加载的页面（lib/lazy.js）这时会重新下载代码，
// 所以断网时打开失败、联网后点「重试」就能打开。传了 onRetry（例如 RouterView 传页面的 preload）会先调它。
// 分包加载失败（发版后旧页面）另有自动刷新，见 lib/lazy.js。
// =====================================================================

import { Component } from 'preact';
import { isChunkError } from '../lib/lazy.js';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error) {
    console.error('[页面出错]', error);
    this.setState({ error });
  }

  render({ children }, { error }) {
    if (!error) return children;
    // 分包或它的按需样式表（lib/chunk-css.js）没下载成：断网、发版后旧文件被删
    const isChunk = isChunkError(error);
    return (
      <section class="shell-error" role="alert">
        <h1 class="shell-error__title">{isChunk ? '页面加载失败' : '这一页出错了'}</h1>
        <p class="shell-error__text">
          {isChunk ? '可能是网络不稳定，或者网站刚刚更新。' : '别担心，你的数据没有丢。可以先重试，不行就刷新页面。'}
        </p>
        <div class="shell-error__actions">
          <button
            type="button"
            class="shell-btn shell-btn--primary"
            data-press="scale"
            data-testid="error-retry"
            onClick={() => {
              this.props.onRetry?.();
              this.setState({ error: null });
            }}
          >
            重试
          </button>
          <button type="button" class="shell-btn" data-press="scale" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
        <details class="shell-error__details">
          <summary>错误详情</summary>
          <pre>{String(error?.stack || error)}</pre>
        </details>
      </section>
    );
  }
}
