// =====================================================================
// shell/overlays/MoreMenu.jsx：「更多」全屏菜单（sheet id menu；样稿 05-更多菜单.png、10-更多菜单扩散中.png）。
//
// 从底栏「更多」按钮圆形扩散铺满全屏（overlay/FullscreenMenu）；底栏浮在菜单上面，「更多」变成「关闭」（三横线转 ×）。
//   - 上面：眉标（● 行程名）+ 宋体大标题「更多」；
//   - 目录（「杂志纸本」：像书的目录，一列八行、细线分隔）：预订、清单、日记相册、地点与评级、贴士与常用语、联系人、全部行程、设置；
//     要翻译的外语行程最前面多一行「翻译」（lib/translate/text.js 的 translateLang：按目的地档案，语言包测过才有；台湾那趟没有）；
//     每行左边是宋体名字，右边一行灰字实时状态（「2 个待确认」「打包 18/30」「3 篇日记 · 8 张照片」……，数据层现算）；
//     「全部行程」行尾叠着各趟行程的小封面；当前所在的页面名字是海色；
//     390×844 一屏放得下全部目录、外观和签名（不被底栏挡住）；
//   - 下面：外观分段（自动 / 浅色 / 深色，lib/theme.js 的 setThemePreference）和签名「热爱生活7885 · Jeremy & Cathy」。
// 每行是站内链接（<a href>）：点了换页，菜单那条历史被路由替换掉，菜单自己收回。
// 菜单项错落入场（FullscreenMenu 对带 data-ov-stagger 的元素做）。
// =====================================================================

import './overlays.css';
import { FullscreenMenu } from '../../overlay/FullscreenMenu.jsx';
import { route, href } from '../../router/index.js';
import { useMyTrips, syncStatus } from '../../data/index.js';
import { themePreference, setThemePreference } from '../../lib/theme.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { CoverDot } from '../CoverDot.jsx';
import { tripInfo, tripStore } from '../trip-state.js';
import { menuStatuses } from '../view-rules.js';
import { translateLang, translateDetail } from '../../lib/translate/text.js';
import { local } from '../../lib/storage.js';

const THEME_OPTIONS = [
  { value: 'system', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const TILES = [
  { name: 'bookings', title: '预订' },
  { name: 'lists', title: '清单' },
  { name: 'journal', title: '日记相册' },
  { name: 'places', title: '地点与评级' },
  { name: 'tips', title: '贴士与常用语' },
  { name: 'contacts', title: '联系人' },
];

function Tile({ to, title, detail, current, testId, children }) {
  return (
    <a
      href={href(to)}
      class="more-tile"
      data-press="scale"
      data-ov-stagger=""
      aria-current={current ? 'page' : undefined}
      data-testid={testId}
    >
      <span class="more-tile__text">
        <b>{title}</b>
        <i>{detail}</i>
      </span>
      {children}
    </a>
  );
}

export default function MoreMenu() {
  const r = route.value;
  const info = tripInfo.value;
  const store = tripStore.value;
  const tripId = r?.params?.tripId || info?.id || null;
  const list = useMyTrips();
  const trips = list.entries || [];
  const v = store?.view;
  const statuses = v
    ? menuStatuses({
      bookings: v.bookings.value,
      todos: v.todoProgress.value,
      journal: [...v.journalByDay.value.values()].flat(),
      places: v.places.value.length,
      reviews: [...v.reviewsByPlace.value.values()].reduce((n, x) => n + x.length, 0),
      tips: v.tips.value,
      contacts: v.contacts.value,
    })
    : null;
  const sync = syncStatus.value;
  const settingsText = sync && sync.state !== 'synced' ? sync.message : '外观、每趟行程和成员';
  const eyebrow = info?.trip?.title || '热爱生活7885';
  // 翻译：只在要翻译、语言包测过了的外语行程里有（目的地档案），排第一行（在当地最常用）
  const translate = tripId && translateLang(store?.trip?.value || info?.trip);
  const starList = translate ? local.getJSON('translate:star', []) : null;
  const starredN = Array.isArray(starList) ? starList.length : 0;

  return (
    <FullscreenMenu
      sheetId="menu"
      title="更多"
      subtitle={eyebrow}
      class="shell-more"
      testId="more-menu"
      footer={(
        <div class="more-foot">
          <div class="more-theme" data-ov-stagger="">
            <b>外观</b>
            <SegmentedControl
              label="外观"
              size="lg"
              block={false}
              class="more-theme__seg"
              options={THEME_OPTIONS}
              value={themePreference.value}
              onChange={(v2) => setThemePreference(v2)}
            />
          </div>
          <p class="more-sign" data-ov-stagger="">热爱生活7885 · Jeremy &amp; Cathy</p>
        </div>
      )}
    >
      <nav class="more-grid" aria-label="更多页面">
        {translate && (
          <Tile
            to={{ name: 'translate', params: { tripId } }}
            title="翻译"
            detail={starredN ? `收藏了 ${starredN} 句 · 没网也能看` : translateDetail(translate)}
            current={r?.name === 'translate'}
            testId="more-translate"
          />
        )}
        {tripId && TILES.map((t) => (
          <Tile
            key={t.name}
            to={{ name: t.name, params: { tripId } }}
            title={t.title}
            detail={statuses ? statuses[t.name] : ' '}
            current={r?.name === t.name}
            testId={`more-${t.name}`}
          />
        ))}
        <Tile
          to={{ name: 'trips' }}
          title="全部行程"
          detail={trips.length ? `${trips.length} 趟 · 切换或新建` : '切换或新建'}
          current={r?.name === 'trips'}
          testId="more-trips"
        >
          <span class="more-covers" aria-hidden="true">
            {trips.slice(0, 3).map((e) => <CoverDot key={e.id} trip={e.trip} shape="tile" />)}
          </span>
        </Tile>
        <Tile to={{ name: 'settings' }} title="设置" detail={settingsText} current={r?.name === 'settings'} testId="more-settings" />
      </nav>
    </FullscreenMenu>
  );
}
