// =====================================================================
// data/translate.js：翻译接口的实例（翻译页、对话模式用；不进 data/index.js，免得每一页都下载）。
//
//   import { translator, phrases } from '../../data/translate.js';
//   translator.translate(text, { trip, auto, signal })   见 lib/translate/client.js
//   translator.warm({ trip })
//   phrases                                              翻过的、收藏的、称呼（localStorage，lib/translate/store.js）
//
// token：数据层后台的 auth.accessToken()（Supabase 会话的 access token；演示模式是个假的）。
// 地址：data/config.js 的 TRANSLATE_URL（CSP 也从那里读）。
// 演示模式（本机 ?demo=1）：不连网，用 lib/translate/demo.js 的假接口（同一个 client，同一套错误处理）；
//   本机再加 ?trhttp=1 改走真的 fetch（e2e 用它拦下请求、检查请求格式，返回假的结果）。
// =====================================================================

import { effect } from '@preact/signals';
import { data } from './index.js';
import { TRANSLATE_URL } from './config.js';
import { isDemoMode, isLocalhost, searchParam } from '../lib/env.js';
import { local } from '../lib/storage.js';
import { createTranslateClient } from '../lib/translate/client.js';
import { createDemoFetch } from '../lib/translate/demo.js';
import { createPhraseStore } from '../lib/translate/store.js';

const demo = isDemoMode();
const http = !demo || (isLocalhost() && searchParam('trhttp') === '1');

export const translator = createTranslateClient({
  url: demo && !http ? 'demo:translate' : TRANSLATE_URL,
  fetch: http ? undefined : createDemoFetch(),
  getToken: (o) => data.backend.auth.accessToken(o),
  online: () => data.online.peek() !== false && (typeof navigator === 'undefined' || navigator.onLine !== false),
});

export const phrases = createPhraseStore({ storage: local });

// 退出登录：本机存的句子由数据层清掉（data/layer.js 的 clearLocal）；这里再清掉这次打开期间记着的、刷新列表
effect(() => {
  if (data.auth.state.value?.status !== 'signed-out') return;
  phrases._memo.clear();
  phrases.version.value = phrases.version.peek() + 1;
});

/** 演示模式（结果卡下面写「演示模式」） */
export const translateDemo = demo && !http;
