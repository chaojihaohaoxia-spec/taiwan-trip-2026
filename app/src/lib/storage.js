// =====================================================================
// lib/storage.js：localStorage / sessionStorage 的安全包装。
//
// 浏览器存储随时可能不可用（无痕模式、存储已满、被清理、iOS 7 天清理），
// 所以每次读写都 try/catch，失败时返回默认值、不抛错。
// 只放“丢了也没关系”的界面偏好（主题、滚动位置、上次的筛选）；
// 业务数据走数据层（IndexedDB 缓存 + Supabase），不要放这里。
//
// 所有键自动加前缀 `rs7885:`，避免和旧版（taiwanTrip2026*）混在一起。
// 旧版的键（taiwanTrip2026State 等）不要删，迁移脚本还要读。
// =====================================================================

export const KEY_PREFIX = 'rs7885:';

function backend(kind) {
  try {
    const store = typeof window !== 'undefined' ? window[kind] : undefined;
    return store || null;
  } catch {
    return null;
  }
}

/** 创建一个带前缀、读写都不会抛错的存储。kind = 'localStorage' | 'sessionStorage'。 */
export function createSafeStorage(kind, getBackend = () => backend(kind)) {
  return {
    /** 读字符串，失败返回 fallback */
    get(key, fallback = null) {
      try {
        const v = getBackend()?.getItem(KEY_PREFIX + key);
        return v === null || v === undefined ? fallback : v;
      } catch {
        return fallback;
      }
    },
    /** 写字符串，返回是否成功 */
    set(key, value) {
      try {
        getBackend()?.setItem(KEY_PREFIX + key, String(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        getBackend()?.removeItem(KEY_PREFIX + key);
      } catch {
        /* 忽略 */
      }
    },
    /** 读 JSON，解析失败返回 fallback */
    getJSON(key, fallback = null) {
      const raw = this.get(key, null);
      if (raw === null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      try {
        return this.set(key, JSON.stringify(value));
      } catch {
        return false;
      }
    },
  };
}

/** 长期偏好（主题等） */
export const local = createSafeStorage('localStorage');
/** 本次会话（滚动位置、刷新重载保护等） */
export const session = createSafeStorage('sessionStorage');
