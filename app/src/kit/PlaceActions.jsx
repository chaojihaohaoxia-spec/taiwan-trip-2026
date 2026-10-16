// =====================================================================
// kit/PlaceActions.jsx：地点的动作行——导航 / 叫 Grab / 给司机看 / 复制地址（可选：打电话、记一笔）。
// 条目展开、地点面板、地图面板、预订（酒店 / 餐厅）里**都用这一个组件**（SPEC §6），保证一致。
//
//   <PlaceActions place={place} />                                       完整：一行纯文字链接（「导航 | 叫 Grab | 给司机看 | 记一笔」）
//   <PlaceActions place={place} size="compact" />                        紧凑：一排 44px 的圆图标按钮（读屏有名字）
//   <PlaceActions place={place} primary="grab" call expense={{ itemId: item.id, date: day.date }} mode="walk" />
//     primary：哪个更醒目（完整版字重一点、紧凑版实心海色；一般不用）
//     call：有电话时加「打电话」；expense：加「记一笔」（值是预填：{ itemId, placeId, bookingId, date }，placeId 默认就是这个地点）
//     mode：导航的交通方式（walk / grab / taxi …，见 lib/maps-links.js 的 travelModeFor；默认 driving）
//     actions：只要其中几个，例如 ['nav', 'copy']；readOnly：只读成员（记一笔禁用）
//
// 每个动作做什么：
//   导航      Google 地图导航链接（有坐标用坐标，没有用名字 + 地址；只精确到城市的坐标不用）→ lib/native.js 的 openExternal
//   叫 Grab   先把「当地语名 + 地址」复制到剪贴板（失败也不影响）→ openExternal(grabBookingUrl) →
//             1.5 秒内页面没被切到后台（watchAppSwitch）就提示「没打开 Grab？地址已复制，可以在 Grab 里粘贴」+「打开 Grab」按钮
//   给司机看  全屏大字卡（sheets/ 的 openDriverCard，从这个按钮长出来）
//   复制地址  当地语名 + 地址（没地址时是「复制名字」），提示「已复制地址」，轻震一下
//   打电话    tel: 链接（openExternal）；记一笔  sheets/ 的 openExpenseSheet（预填条目 / 地点 / 日期，iOS 先叫出键盘）
// 用不了的动作按钮是禁用的（灰、点不了），下面一行小字说明原因；只是“没坐标、按名字和地址找”的也说一句。
// 下车点（SPEC §10，地点 extra.ride_via / ride_note / no_road / access_note）：叫 Grab、给司机看、复制都用下车点
// （同一趟行程的地点自动从数据层找；也可以传 places），「导航」仍然导到地点本身；下车提示放在说明行最前面。
// 外链一律走 lib/native.js（以后 iOS 外壳接管），链接只在 lib/ 里拼（Grab 的格式等手机实测，要改只改 lib/ride-links.js）。
// =====================================================================

import './PlaceActions.css';
import { copyText } from '../lib/clipboard.js';
import { openExternal, haptic, watchAppSwitch } from '../lib/native.js';
import { GRAB_OPEN_URL, addressForCopy, localName, rideTarget } from '../lib/ride-links.js';
import { toast } from '../overlay/index.js';
import { data } from '../data/index.js';
import { openDriverCard, openExpenseSheet } from '../sheets/index.js';
import { Glyph } from './Glyph.jsx';
import { placeActionModel } from './place-actions.js';

/**
 * 按 id 找同一趟行程的地点（解析下车点用）：传了 places（Map / 数组 / 函数）就用它，否则从数据层拿这趟行程的地点表。
 * 地点没有 trip_id（拼出来的临时对象）或还没登录时返回 undefined（不解析下车点）。
 */
export function placeLookup(place, places) {
  if (typeof places === 'function') return places;
  if (places instanceof Map) return (id) => places.get(id);
  if (Array.isArray(places)) return (id) => places.find((p) => p.id === id);
  const tripId = place?.trip_id;
  if (!tripId || !data.userId.value) return undefined;
  const table = data.getStore(tripId)?.tables?.places?.value;
  return table ? (id) => table.get(id) : undefined;
}

/** 叫 Grab 的完整流程（SPEC §6）。要在点击回调里同步调用（复制和跳转都要用户手势）。 */
export async function callGrab(place, url, { timeout = 1500, getPlace } = {}) {
  const text = addressForCopy(place, { getPlace });
  // 先发起复制（同步发起，不等它完成——等了再跳转，iOS 会认为不是用户点的、不唤起 App）
  const copying = text ? copyText(text, { silent: true }) : Promise.resolve({ ok: false });
  haptic('light');
  if (!openExternal(url)) return { opened: false, switched: false };
  const [switched, copied] = await Promise.all([watchAppSwitch({ timeout }), copying]);
  if (!switched) {
    const name = localName(rideTarget(place, { getPlace }).place);
    toast({
      message: copied.ok ? '没打开 Grab？地址已复制，可以在 Grab 里粘贴' : `没打开 Grab？可以在 Grab 里搜「${name || '目的地'}」`,
      tone: 'info',
      key: 'grab-fallback',
      action: { label: '打开 Grab', onClick: () => openExternal(GRAB_OPEN_URL) },
    });
  }
  return { opened: true, switched, copied: copied.ok };
}

/**
 * @param {Object} props
 * @param {object} props.place                 places 行（或同样字段的对象）；为空时所有按钮禁用并说明
 * @param {'full'|'compact'} [props.size]
 * @param {string[]} [props.actions]           默认 ['nav', 'grab', 'driver', 'copy']
 * @param {string} [props.primary]             哪个动作做成强调色实心
 * @param {boolean} [props.call]               有电话时加「打电话」
 * @param {boolean|object} [props.expense]     加「记一笔」（对象 = 预填）
 * @param {boolean} [props.readOnly]
 * @param {string} [props.mode]                导航的交通方式
 * @param {boolean} [props.hideNote]           不显示下面那行说明
 * @param {Map|Array|Function} [props.places]   同一趟行程的地点（解析下车点）；不传就从数据层按 place.trip_id 拿
 * @param {(key: string) => void} [props.onAction]  点了某个动作（关面板、记日志用）
 * @param {string} [props.class]
 * @param {string} [props.testId]
 */
export function PlaceActions({
  place, size = 'full', actions, primary, call = false, expense = false, readOnly = false, mode, hideNote = false, onAction,
  places, class: className, testId = 'place-actions',
}) {
  const getPlace = placeLookup(place, places);
  const model = placeActionModel(place, { actions, call, expense: Boolean(expense), readOnly, mode, getPlace });
  const compact = size === 'compact';

  const run = (key, href, e) => {
    onAction?.(key);
    switch (key) {
      case 'nav':
      case 'call':
        e?.preventDefault();
        haptic('light');
        openExternal(href);
        break;
      case 'grab':
        e?.preventDefault();
        callGrab(place, href, { getPlace });
        break;
      case 'driver':
        haptic('light');
        openDriverCard(place.id, { trigger: e?.currentTarget });
        break;
      case 'copy':
        copyText(addressForCopy(place, { getPlace }), { label: model.ride.place?.address ? '地址' : '名字' }).then((r) => r.ok && haptic('success'));
        break;
      case 'expense': {
        const prefill = typeof expense === 'object' ? expense : {};
        openExpenseSheet({ placeId: place?.id, ...prefill }, { keyboard: true, trigger: e?.currentTarget });
        break;
      }
      default:
        break;
    }
  };

  const cols = model.actions.length <= 4 ? model.actions.length : Math.ceil(model.actions.length / 2);
  const note = !hideNote && model.note;

  return (
    <div class={['k-acts', compact ? 'k-acts--compact' : 'k-acts--full', className].filter(Boolean).join(' ')} data-testid={testId}>
      <div class="k-acts__row" role="group" aria-label="地点动作" style={{ '--k-acts-cols': cols }}>
        {model.actions.map((a) => {
          const cls = ['k-act', a.key === primary && !a.disabled && 'k-act--primary'].filter(Boolean).join(' ');
          const inner = (
            <>
              {compact ? <Glyph name={a.glyph} size={20} /> : <span class="k-act__label">{a.label}</span>}
            </>
          );
          const common = {
            class: cls,
            'data-action': a.key,
            'data-press': 'scale',
            'aria-label': compact || a.disabled ? (a.disabled ? `${a.label}（${a.reason}）` : a.label) : undefined,
            title: compact ? a.label : undefined,
          };
          if (a.href && !a.disabled) {
            return (
              <a key={a.key} {...common} href={a.href} rel="noopener noreferrer" onClick={(e) => run(a.key, a.href, e)}>
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
              aria-haspopup={a.key === 'driver' || a.key === 'expense' ? 'dialog' : undefined}
              data-overlay-trigger={a.key === 'driver' ? 'driver' : a.key === 'expense' ? 'expense' : undefined}
              data-overlay-arg={a.key === 'driver' ? place?.id : undefined}
              onClick={(e) => run(a.key, null, e)}
            >
              {inner}
            </button>
          );
        })}
      </div>
      {note && (
        <p class="k-acts__note" data-testid={`${testId}-note`}>
          <Glyph name="info" size={14} />
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}
