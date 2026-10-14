// =====================================================================
// data/guard.js：把登录状态接到路由上。
//
//   installAuthGuard(router, data)   main.jsx 启动时调用一次（在 router.start() 之前或之后都行）：
//     - 守卫：要登录的页面（meta.auth）在“确定没登录”时改道到 #/login?next=<原网址>；
//       还在恢复会话（unknown）时放行，页面先显示骨架，不闪登录页；
//     - 会话中途失效（过期、在别的标签页退出）且当前页要登录 → replace 到登录页；
//       除此之外任何登录事件都不跳页（切回前台不会被拉回首页）；
//     - 登录回调网址（#access_token=… / #error=…，路由给出 auth-callback）：处理完 replace 离开。
//   nextAfterLogin(route)            登录成功后去哪：?next= 里的站内网址（只接受 #/ 开头、且不是登录页），否则 #/trips
// =====================================================================

import { effect, untracked } from '@preact/signals';

const LOGIN_ERRORS = {
  otp_expired: '登录链接已经过期了，请重新获取验证码',
  access_denied: '登录链接无效或已经用过了，请重新获取验证码',
};

/** 登录成功后要去的地方（防止 next 指向站外或登录页本身） */
export function nextAfterLogin(route) {
  const next = route?.query?.next;
  if (typeof next === 'string' && next.startsWith('#/') && !next.startsWith('#/login') && next.length < 600) return next;
  return { name: 'trips' };
}

/** 解析 #access_token=…&refresh_token=… / #error=…&error_code=…&error_description=… */
export function parseCallbackHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const p = new URLSearchParams(s);
  return {
    accessToken: p.get('access_token'),
    refreshToken: p.get('refresh_token'),
    error: p.get('error'),
    errorCode: p.get('error_code'),
    errorDescription: p.get('error_description'),
  };
}

/**
 * @param {object} router  router/index.js 的 router
 * @param {{ auth: object }} data  data/index.js 的 data（数据层实例）
 * @returns {() => void} 取消安装
 */
export function installAuthGuard(router, data) {
  const offGuard = router.addGuard((to) => {
    if (!to?.meta?.auth) return undefined;
    if (data.auth.state.value.status === 'signed-out') return { name: 'login', query: { next: to.href } };
    return undefined;
  });

  let handlingCallback = false;
  const offEffect = effect(() => {
    const status = data.auth.state.value.status;
    const r = router.route.value;
    if (!r) return;
    untracked(() => {
      if (status === 'signed-out' && r.meta?.auth) {
        router.replace({ name: 'login', query: { next: r.href } }).catch(() => {});
      }
      if (r.name === 'auth-callback' && !handlingCallback) {
        handlingCallback = true;
        handleAuthCallback(router, data).finally(() => {
          handlingCallback = false;
        });
      }
    });
  });

  return () => {
    offGuard?.();
    offEffect();
  };
}

/** 处理登录回调网址，然后离开（replace，不留历史） */
export async function handleAuthCallback(router, data) {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  const cb = parseCallbackHash(hash);
  await data.auth.init();
  if (cb.error || cb.errorCode) {
    data.auth.notice.value = LOGIN_ERRORS[cb.errorCode] || LOGIN_ERRORS[cb.error] || `登录没有成功：${cb.errorDescription || cb.error}`;
    return router.replace({ name: 'login' });
  }
  if (cb.accessToken && cb.refreshToken && data.auth.state.value.status !== 'signed-in') {
    try {
      await data.auth.setSessionFromUrl({ access_token: cb.accessToken, refresh_token: cb.refreshToken });
    } catch (e) {
      data.auth.notice.value = e.message;
      return router.replace({ name: 'login' });
    }
  }
  return router.replace(data.auth.state.value.status === 'signed-in' ? { name: 'trips' } : { name: 'login' });
}
