// =====================================================================
// motion/index.js：动效原语的统一出口。
//
//   import { animateSpring, playFlip, morphFrom, usePress } from '../motion/index.js';
//
// 各文件职责见 motion/README.md。按压样式（press.css）由 ui/Pressable.jsx 引入；
// 只用 attachPress 而不用 ui 组件时，自己 import '../motion/press.css'。
// =====================================================================

export { SPRINGS, SPRING_NAMES, spring, solveSpring, springToLinear, supportsLinearEasing, SPRING_FALLBACKS } from './springs.js';
export { prefersReducedMotion } from './reduced-motion.js';
export {
  resolveSpring, springMotion, springGroup, deriveGroup, sampleFrames, rubberBand, projectMomentum, VelocityTracker,
  cubicBezier, parseCubicBezier, lerp, clamp, stage, num, resolveRadius,
} from './physics.js';
export { timeScale, getTimeScale, setTimeScale, cssDuration, cssEasing } from './time.js';
export {
  animateSpring, animateSpringGroup, springValue, animateTween, getAnimation, stopAnimation, stopAll, applyStyle, clearStyle, nextFrame,
  SpringAnimation, SpringDriver,
} from './animate.js';
export { captureLayout, playFlip, flip, invertFor, flipRenderer, plainRect, captureHeight, playHeight, needsRadiusCorrection } from './flip.js';
export {
  measure, morphFrom, morphTo, revealCircle, coverRadius, clipMorphStart, clipMorphEnd, transformMorphStart, clipFollower,
} from './morph.js';
export { shapeProgress, morphTintAt, morphContentAt, MORPH_TINT_RANGE, MORPH_CONTENT_RANGE } from './morph-shape.js';
export { attachPress, delegatePress, autoPressScale, suppressNextClick } from './press.js';
export { trackDrag, momentumScroll, MOMENTUM_DECELERATION } from './gesture.js';
export {
  LIQUID_STRETCH, liquidStretch, stretchSpring, followSpring, slotPosition, nearestSelectable, rubberClamp, trackSlideSelect,
} from './liquid.js';
export { usePress, useFlip, useHeightFlip, useReducedMotion, usePrevious, useResizeObserver, useLatest } from './hooks.js';
export { holdPosition } from './anchor.js';
export { inheritPressScale, pressScaleOf, continuePressFrom } from './press-handoff.js';
