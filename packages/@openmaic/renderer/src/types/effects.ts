export interface LaserEffectOptions {
  elementId: string;
  color?: string;
  duration?: number;
  /** Render the pointer at its final target without fly-in/pulse animation. */
  static?: boolean;
}

export interface SpotlightEffectOptions {
  elementId: string;
  /** Preferred current name for mask opacity. */
  dimOpacity?: number;
  /** Backward-compatible upstream alias for mask opacity. */
  dimness?: number;
  /** Render the final spotlight mask without transition animation. */
  static?: boolean;
}

export interface HighlightEffectOptions {
  elementId: string;
  color?: string;
  opacity?: number;
  borderWidth?: number;
  animated?: boolean;
}

export interface ZoomEffectOptions {
  elementId: string;
  scale: number;
}

export interface SlideEffects {
  laser?: LaserEffectOptions;
  spotlight?: SpotlightEffectOptions;
  highlight?: HighlightEffectOptions;
  highlights?: HighlightEffectOptions[];
  zoom?: ZoomEffectOptions;
}
