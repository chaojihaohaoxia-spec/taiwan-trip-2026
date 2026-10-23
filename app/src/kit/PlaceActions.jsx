// =====================================================================
// kit/PlaceActions.jsx：地点的动作行——按「这一项怎么去」给按钮（规则包 rules/how.js，两端同一套）。
// 条目展开、地点面板、地图面板、预订（酒店 / 餐厅）里**都用这一个组件**（SPEC §6），保证一致。
//
//   <PlaceActions place={place} how={itemHow(store, item)} expense={…} />   每天页、概览「接下来」：按规则给的一排
//   <PlaceActions place={place} />                                          地点页、预订卡：按目的地档案（自动从数据层拿）的一排 + 复制地址
//   <PlaceActions place={place} size="compact" />                           紧凑：一排 44px 的圆图标按钮（读屏有名字）
//     how：data/dest.js 的 itemHow / placeHow 结果；profile：目的地档案（不给 how 时用；都不给就按 place.trip_id 从数据层找）
//     booking：航班（值机、登机牌、航班动态）；primary：哪个更醒目（不给按 how 的主按钮）
//     call：有电话时加「打电话」；expense：加「记一笔」（值是预填：{ itemId, placeId, bookingId, date }）
//     mode：导航的交通方式（不给按 how.navMode）；actions：点名要哪几个（'grab' 是 'ride' 的旧名）；readOnly：只读成员
//     showHint：说明行里带上 how.hint（「离上一站 3.2 公里，按打车算」）
//
// 每个动作做什么：
//   导航      按档案选地图（Google / 高德 / Naver）→ lib/native.js 的 openExternal
//   叫车      叫 Grab / 叫 Uber：先把「当地语名 + 地址」复制到剪贴板（失败也不影响）→ openExternal(带目的地的链接) →
//             1.5 秒内页面没被切到后台（watchAppSwitch）就提示「没打开 Grab？地址已复制，可以在 Grab 里粘贴」+「打开 Grab」；
//             别的 App（GO、滴滴……网页没法带目的地）：按钮下面一行小字「复制地址」，点了复制，提示「打开 GO 粘贴目的地」
//   给司机看  全屏大字卡（sheets/ 的 openDriverCard，从这个按钮长出来；中文还是当地文字按档案）
//   复制地址  当地语名 + 地址（没地址时是「复制名字」），提示「已复制地址」，轻震一下
//   打电话    tel: 链接；记一笔 openExpenseSheet；值机 / 航班动态 外链；登机牌 打开预订（附件在那里）
//   ⋯        最后一格很淡的「⋯」：点开下面多一排这一次临时能用的其余动作（下雨了想打车）——只用这一次，不写库。
//             这一排规则说不用给按钮（同一个地方、做完了）时，只留一行灰字说明 +「⋯」。
// 用不了的动作按钮是禁用的（灰、点不了），下面一行小字说明原因；只是“没坐标、按名字和地址找”的也说一句。
// 外链一律走 lib/native.js（以后 iOS 外壳接管），链接只在 lib/ 里拼（要改格式只改 lib/ride-links.js、lib/maps-links.js）。
// =====================================================================

import './PlaceActions.css';
import { useState } from 'preact/hooks';
import { copyText } from '../lib/clipboard.js';
import { openExternal, haptic, watchAppSwitch } from '../lib/native.js';
import { GRAB_OPEN_URL, addressForCopy, localName, rideTarget, rideOpenUrl } from '../lib/ride-links.js';
import { toast } from '../overlay/index.js';
import { data } from '../data/index.js';
import { profileForPlace } from '../data/dest.js';
import { openDriverCard, openExpenseSheet, openBookingSheet } from '../sheets/index.js';
import { Glyph } from './Glyph.jsx';
import { placeActionModel } from './place-actions.js';

/** 这个地点所在行程的 store（没有 trip_id、还没登录 → null） */
function storeOf(place) {
  const tripId = place?.trip_id;
  if (!tripId || !data.userId.value) return null;
  return data.getStore(tripId) || null;
}

/**
 * 按 id 找同一趟行程的地点（解析下车点用）：传了 places（Map / 数组 / 函数）就用它，否则从数据层拿这趟行程的地点表。
 * 地点没有 trip_id（拼出来的临时对象）或还没登录时返回 undefined（不解析下车点）。
 */
export function placeLookup(place, places) {
  if (typeof places === 'function') return places;
  if (places instanceof Map) return (id) => places.get(id);
  if (Array.isArray(places)) return (id) => places.find((p) => p.id === id);
  const table = storeOf(place)?.tables?.places?.value;
  return table ? (id) => table.get(id) : undefined;
}

/**
 * 叫车（能带目的地的 App：Grab、Uber）。要在点击回调里同步调用（复制和跳转都要用户手势）。
 * @param {object} place
 * @param {string} url 带目的地的链接
 * @param {{ id: string, name: string, link: string|null }} app
 */
export async function callRide(place, url, app, { timeout = 1500, getPlace } = {}) {
  const text = addressForCopy(place, { getPlace });
  // 先发起复制（同步发起，不等它完成——等了再跳转，iOS 会认为不是用户点的、不唤起 App）
  const copying = text ? copyText(text, { silent: true }) : Promise.resolve({ ok: false });
  haptic('light');
  if (!openExternal(url)) return { opened: false, switched: false };
  const [switched, copied] = await Promise.all([watchAppSwitch({ timeout }), copying]);
  if (!switched) {
    const name = localName(rideTarget(place, { getPlace }).place);
    const appName = app?.name || 'Grab';
    const open = rideOpenUrl(app);
    toast({
      message: copied.ok ? `没打开 ${appName}？地址已复制，可以在 ${appName} 里粘贴` : `没打开 ${appName}？可以在 ${appName} 里搜「${name || '目的地'}」`,
      tone: 'info',
      key: 'ride-fallback',
      action: open ? { label: `打开 ${appName}`, onClick: () => openExternal(open) } : undefined,
    });
  }
  return { opened: true, switched, copied: copied.ok };
}

/** 叫 Grab 的完整流程（旧名字，等于 callRide(place, url, Grab)） */
export function callGrab(place, url, o) {
  return callRide(place, url, { id: 'grab', name: 'Grab', link: 'grab' }, o);
}

/** 网页没法带目的地打开的叫车 App（GO、滴滴……）：复制地址，提示自己打开 */
async function copyForRide(place, app, getPlace) {
  const text = addressForCopy(place, { getPlace });
  const r = await copyText(text, { silent: true });
  haptic(r.ok ? 'success' : 'light');
  const name = app?.name || '叫车 App';
  toast({
    message: r.ok ? `地址已复制，打开 ${name} 粘贴目的地` : `没复制上：在 ${name} 里搜「${localName(rideTarget(place, { getPlace }).place) || '目的地'}」`,
    tone: r.ok ? 'success' : 'info',
    key: 'ride-copy',
  });
}

/**
 * @param {Object} props
 * @param {object} props.place                 places 行（或同样字段的对象）；为空时所有按钮禁用并说明
 * @param {object} [props.how]                 data/dest.js 的 itemHow / placeHow（规则算好的一排）
 * @param {object} [props.profile]             目的地档案（不给 how 时用）
 * @param {object} [props.booking]             航班（值机、登机牌、航班动态）
 * @param {'full'|'compact'} [props.size]
 * @param {string[]} [props.actions]           点名要哪几个
 * @param {string} [props.primary]             哪个动作做成强调（不给按 how 的主按钮）
 * @param {boolean} [props.call]               有电话时加「打电话」
 * @param {boolean|object} [props.expense]     加「记一笔」（对象 = 预填）
 * @param {boolean} [props.readOnly]
 * @param {string} [props.mode]                导航的交通方式
 * @param {boolean} [props.hideNote]           不显示下面那行说明
 * @param {boolean} [props.showHint]           说明行里带上 how.hint
 * @param {boolean} [props.noMore]             不要「⋯」
 * @param {boolean} [props.plain]              不强调主按钮（概览上正在进行的那一条：人已经在那儿了）
 * @param {'ride'} [props.prefer]              没有 how 时：叫车放第一个、做主按钮（住处卡第一晚）
 * @param {boolean} [props.noCopy]             没有 how 时：「复制地址」不放在这一排（进「⋯」）
 * @param {Map|Array|Function} [props.places]   同一趟行程的地点（解析下车点）；不传就从数据层按 place.trip_id 拿
 * @param {(key: string) => void} [props.onAction]  点了某个动作（关面板、记日志用）
 * @param {string} [props.class]
 * @param {string} [props.testId]
 */
export function PlaceActions({
  place, how, profile, booking, size = 'full', actions, primary, call = false, expense = false, readOnly = false, mode, hideNote = false,
  showHint = false, noMore = false, plain = false, prefer, noCopy = false, onAction, places, class: className, testId = 'place-actions',
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const getPlace = placeLookup(place, places);
  // 地点页、预订卡：没给 how / profile 时按地点所在行程的档案（香港的地点按香港档案；点名要哪几个时叫车 App 也按档案）
  const store = !how && !profile ? storeOf(place) : null;
  const prof = profile || (store ? profileForPlace(store, place) : null);
  const model = placeActionModel(place, {
    how, profile: prof, actions, call, expense: Boolean(expense), readOnly, mode, getPlace, booking: booking || how?.booking || null,
    prefer, copy: !noCopy,
  });
  const compact = size === 'compact';
  const lead = plain ? null : primary ? (primary === 'grab' ? 'ride' : primary) : model.primary;

  const run = (a, e) => {
    onAction?.(a.key);
    switch (a.key) {
      case 'nav':
      case 'call':
      case 'checkin':
      case 'status':
        e?.preventDefault();
        haptic('light');
        openExternal(a.href);
        break;
      case 'ride':
        e?.preventDefault();
        if (a.copyRide) copyForRide(place, model.app, getPlace);
        else callRide(place, a.href, model.app, { getPlace });
        break;
      case 'driver':
        haptic('light');
        openDriverCard(place.id, { trigger: e?.currentTarget });
        break;
      case 'copy':
        copyText(addressForCopy(place, { getPlace }), { label: model.ride.place?.address ? '地址' : '名字' }).then((r) => r.ok && haptic('success'));
        break;
      case 'pass': {
        const b = booking || how?.booking;
        if (b?.id) openBookingSheet(b.id, { trigger: e?.currentTarget });
        break;
      }
      case 'expense': {
        const prefill = typeof expense === 'object' ? expense : {};
        openExpenseSheet({ placeId: place?.id, ...prefill }, { keyboard: true, trigger: e?.currentTarget });
        break;
      }
      default:
        break;
    }
  };

  const button = (a, { extra = false } = {}) => {
    const cls = ['k-act', a.key === lead && !extra && !a.disabled && 'k-act--primary', a.weak && 'k-act--weak', a.sub && 'k-act--sub'].filter(Boolean).join(' ');
    const label = a.sub ? `${a.sub} · ${a.label}` : a.label;
    const inner = compact
      ? <Glyph name={a.glyph} size={20} />
      : (
        <span class="k-act__label">
          {a.label}
          {a.sub && <small class="k-act__sub">{a.sub}</small>}
        </span>
      );
    const common = {
      class: cls,
      'data-action': a.key,
      'data-ride': a.key === 'ride' ? a.app || undefined : undefined,
      'data-more': extra ? '' : undefined,
      'data-press': 'scale',
      'aria-label': compact || a.disabled || a.sub ? (a.disabled ? `${label}（${a.reason}）` : label) : undefined,
      title: compact ? label : undefined,
    };
    if (a.href && !a.disabled) {
      return (
        <a key={a.key} {...common} href={a.href} rel="noopener noreferrer" onClick={(e) => run(a, e)}>
          {inner}
        </a>
      );
    }
    return (
      <button
        key={a.key}
        type="button"
        {...common}
        disabled={a.disabled}
        aria-haspopup={a.key === 'driver' || a.key === 'expense' || a.key === 'pass' ? 'dialog' : undefined}
        data-overlay-trigger={a.key === 'driver' ? 'driver' : a.key === 'expense' ? 'expense' : a.key === 'pass' ? 'booking' : undefined}
        data-overlay-arg={a.key === 'driver' ? place?.id : a.key === 'pass' ? (booking || how?.booking)?.id : undefined}
        onClick={(e) => run(a, e)}
      >
        {inner}
      </button>
    );
  };

  const hasMore = !noMore && model.more.length > 0;
  const toggle = hasMore && (
    <button
      type="button"
      class="k-act k-act--more"
      aria-expanded={moreOpen ? 'true' : 'false'}
      aria-label={moreOpen ? '收起其他动作' : `其他动作：${model.more.map((a) => a.label).join('、')}`}
      title={compact ? '其他动作' : undefined}
      data-press="scale"
      onClick={() => { haptic('selection'); setMoreOpen((o) => !o); }}
      data-testid={`${testId}-more`}
    >
      <Glyph name="more" size={compact ? 20 : 18} />
    </button>
  );

  // 规则说这一项不用按钮（同一个地方、做完了）：只剩页面加的「记一笔」这些时，也按灰字那一行画
  const ruleActs = model.actions.filter((a) => !a.extra);
  const empty = ruleActs.length === 0;
  const cols = model.actions.length <= 4 ? model.actions.length : Math.ceil(model.actions.length / 2);
  const hint = showHint || empty ? model.hint : null;
  const note = !hideNote && [hint && !empty ? hint : null, model.note].filter(Boolean).join('；');

  return (
    <div
      class={['k-acts', compact ? 'k-acts--compact' : 'k-acts--full', empty && 'k-acts--quiet', className].filter(Boolean).join(' ')}
      data-testid={testId}
      data-how={model.how?.key || undefined}
    >
      {empty ? (
        // 规则说这一项不用按钮（同一个地方、从住处出发、做完了）：一行灰字 + 页面加的「记一笔」+「⋯」
        (hasMore || model.actions.length > 0) && (
          <div class="k-acts__quiet">
            <span class="k-acts__quiet-text" data-testid={`${testId}-hint`}>{model.how?.collapsed ? '' : model.hint || ''}</span>
            {model.actions.map((a) => button(a))}
            {toggle}
          </div>
        )
      ) : (
        <div
          class={['k-acts__row', hasMore && model.actions.length <= 4 && 'k-acts__row--more'].filter(Boolean).join(' ')}
          role="group"
          aria-label="地点动作"
          style={{ '--k-acts-cols': cols }}
        >
          {model.actions.map((a) => button(a))}
          {model.actions.length <= 4 && toggle}
        </div>
      )}
      {hasMore && model.actions.length > 4 && !empty && <div class="k-acts__tail">{toggle}</div>}
      {hasMore && moreOpen && (
        <div
          class="k-acts__row k-acts__more"
          role="group"
          aria-label="其他动作（只用这一次）"
          style={{ '--k-acts-cols': Math.min(4, model.more.length) }}
          data-testid={`${testId}-more-row`}
        >
          {model.more.map((a) => button(a, { extra: true }))}
        </div>
      )}
      {note && (
        <p class="k-acts__note" data-testid={`${testId}-note`}>
          <Glyph name="info" size={14} />
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}

export { GRAB_OPEN_URL };
