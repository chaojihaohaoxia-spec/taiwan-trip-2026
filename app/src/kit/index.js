// =====================================================================
// kit/index.js：页面之间共用的展示组件（SPEC §9.1）。页面、弹层、外壳的搜索层从这里引。
//
//   import { Card, SectionHeader, ListRow, InfoRow, Divider, MoneyText, KindIcon, StatusChip, PhaseChip, PersonChip,
//            CountdownText, DateLabel, CopyText, PlaceActions, PageEmptyState, ErrorState, InlineAdd, SwipeRow, Glyph } from '../kit/index.js';
//   import { searchTrip } from '../kit/search/engine.js';        // 搜索引擎（纯函数）
//   import { SearchResults } from '../kit/search/SearchResults.jsx';
//
// 说明和每个组件的参数见 kit/README.md；现场演示 #/dev/kit（浅色 / 深色）。
// kit 只给按需加载的页面和弹层用：外壳、首屏代码不要引（会把这些组件拖进首屏包）。
// =====================================================================

export { Card } from './Card.jsx';
export { SectionHeader } from './SectionHeader.jsx';
export { ListRow, InfoRow, Divider } from './ListRow.jsx';
export { MoneyText } from './MoneyText.jsx';
export { KindIcon } from './KindIcon.jsx';
export { Glyph } from './Glyph.jsx';
export { StatusChip, PhaseChip, PersonChip, CountdownText, DateLabel } from './Chips.jsx';
export { CopyText } from './CopyText.jsx';
export { PlaceActions, callGrab, callRide } from './PlaceActions.jsx';
export { PageEmptyState, ErrorState, Illustration, PRESETS as EMPTY_PRESETS } from './States.jsx';
export { InlineAdd } from './InlineAdd.jsx';
export { SwipeRow } from './SwipeRow.jsx';
export { useNow } from './useNow.js';
export { kindLabel, kindGlyph, KIND_LABELS, KIND_GLYPHS } from './kinds.js';
export { statusInfo, freeCancelInfo, phaseInfo, formatLeft, STATUS } from './status.js';
export { placeActionModel, telHref, ACTION_LABELS, rideHintFor, rideHintOfMode } from './place-actions.js';
export { itemClock, itemTimeText, flightLeg } from './item-clock.js';
export { DayBadge } from './DayBadge.jsx';
export { dayTone, dayToneDeep, dayToneIndex } from './day-tone.js';
export { GLYPHS, GLYPH_NAMES } from './glyphs.js';
export { searchTrip, flattenResults, moveActive, SEARCH_GROUPS, SEARCH_GROUP_LABELS } from './search/engine.js';
export { SearchResults, Highlight, optionId } from './search/SearchResults.jsx';
