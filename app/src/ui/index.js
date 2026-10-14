// =====================================================================
// ui/index.js：组件库统一出口（页面、弹层从这里拿）。
//
//   import { Button, IconButton, MorphIcon, SegmentedControl, Stepper } from '../ui/index.js';
//
// 也可以按文件单独引（例如 '../ui/Button.jsx'），打包结果一样（esbuild 会摇树）。
// 每个组件的用法写在各自文件开头的注释里；总览见 ui/README.md，所有状态的现场演示在 #/dev/primitives。
// 轻提示（Toast）不在这里：全站只有一套，调用 overlay/ 的 toast()（排队、堆叠、撤销、甩掉都在那边）。
// =====================================================================

export { Pressable } from './Pressable.jsx';
export { Button } from './Button.jsx';
export { IconButton } from './IconButton.jsx';
export { Spinner } from './Spinner.jsx';
export { MorphIcon } from './MorphIcon.jsx';
export { MORPHS, MORPH_KINDS } from './morph-shapes.js';
export { SubmitButton } from './SubmitButton.jsx';
export { SegmentedControl } from './SegmentedControl.jsx';
export { Tabs, tabId, tabPanelId } from './Tabs.jsx';
export { Stepper } from './Stepper.jsx';
export { RollingNumber } from './RollingNumber.jsx';
export { ExpandableCard, useAccordion } from './ExpandableCard.jsx';
export { FlipGroup } from './FlipGroup.jsx';
export { ViewSwitch, ViewToggle, ViewCard } from './ViewSwitch.jsx';
export { CollapsingHeader } from './CollapsingHeader.jsx';
export { SearchExpand } from './SearchExpand.jsx';
export { Checkbox } from './Checkbox.jsx';
export { Chip } from './Chip.jsx';
export { Badge, CountBadge, DotBadge, RatingBadge } from './Badge.jsx';
export { Skeleton, SkeletonCard, Reveal } from './Skeleton.jsx';
export { Avatar, AvatarGroup, avatarColorIndex, initialsOf } from './Avatar.jsx';
export { EmptyState } from './EmptyState.jsx';
export { cx, renderIcon, useId } from './util.js';
