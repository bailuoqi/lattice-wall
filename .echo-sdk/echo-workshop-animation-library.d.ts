export type EchoWorkshopAnimationTrigger =
  | 'scene-enter'
  | 'track-change'
  | 'line-change'
  | 'ambient';

export type EchoWorkshopAnimationEasing =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'echo-spring'
  | 'echo-snappy'
  | 'echo-gentle'
  | 'echo-elastic';

export type EchoWorkshopAnimationDirection =
  | 'normal'
  | 'reverse'
  | 'alternate'
  | 'alternate-reverse';

export type EchoWorkshopAnimationOrigin =
  | 'center'
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left';

export type EchoWorkshopAnimationClipDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'top-to-bottom'
  | 'bottom-to-top'
  | 'center-out-x'
  | 'center-out-y';

export type EchoWorkshopAnimationStaggerOrigin = 'first' | 'center' | 'last' | 'edges';

export type EchoWorkshopAnimationStagger = {
  stepMs: number;
  maxDelayMs?: number;
  from?: EchoWorkshopAnimationStaggerOrigin;
};

export type EchoWorkshopAnimationKeyframe = {
  offset: number;
  opacity?: number;
  translateX?: number;
  translateY?: number;
  translateZ?: number;
  scale?: number;
  rotateXDeg?: number;
  rotateYDeg?: number;
  rotateDeg?: number;
  skewXDeg?: number;
  skewYDeg?: number;
  clipProgress?: number;
};

export type EchoWorkshopAnimationDefinition = {
  id: string;
  title: string;
  description?: string;
  trigger?: EchoWorkshopAnimationTrigger;
  durationMs?: number;
  delayMs?: number;
  easing?: EchoWorkshopAnimationEasing;
  loop?: boolean;
  direction?: EchoWorkshopAnimationDirection;
  origin?: EchoWorkshopAnimationOrigin;
  clipDirection?: EchoWorkshopAnimationClipDirection;
  stagger?: EchoWorkshopAnimationStagger;
  keyframes: EchoWorkshopAnimationKeyframe[];
};

export type EchoWorkshopAnimationLibrary = {
  type: 'echo-workshop-animation-library';
  schemaVersion: 1;
  id: string;
  title: string;
  description?: string;
  animations: EchoWorkshopAnimationDefinition[];
};

export type EchoWorkshopAnimationReference = {
  itemId: string;
  animationId: string;
};

export type EchoWorkshopAnimationSequence = {
  index: number;
  count: number;
};
