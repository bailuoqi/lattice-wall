/**
 * Shared contracts for the Lattice Wall panel.
 *
 * Every module exposes a `create*()` factory that returns one of the interfaces below; `main.ts` only
 * composes these interfaces. Keep this file free of runtime code so parallel modules never depend on
 * each other's implementation details. Host API types (`EchoWorkshop*`) come from the global SDK
 * declaration file `.echo-sdk/echo-workshop-plugin.d.ts`, which `tsconfig.json` includes.
 *
 * Node runs these sources directly for tests (type stripping), so: no `enum`, no `namespace`, no
 * constructor parameter properties, and always import with explicit `.ts` extensions.
 */

// ---------------------------------------------------------------------------------------------------
// Queue model
// ---------------------------------------------------------------------------------------------------

/** One queue entry, already sanitized by the host and reduced to what the wall renders. */
export type Tile = {
  /** 0-based position in the (possibly host-truncated) queue. */
  index: number;
  queueId: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  /** `echo-cover:` URL or null; null renders the hashed two-colour fallback. */
  coverUrl: string | null;
  durationSeconds: number;
  /** Present for library album cards; queue cards keep their queueId playback identity. */
  albumId?: string;
};

export type QueueModel = {
  tiles: Tile[];
  /** Index into `tiles` of the item matching `currentQueueId`, or null. */
  currentIndex: number | null;
  currentQueueId: string | null;
  /** True when the host handed us its 500-item cap; the wall shows the truncation hint. */
  truncated: boolean;
};

/** What changed between two queue snapshots; drives follow-current and re-layout decisions. */
export type QueueDiff = {
  /** Tile ids or order changed, so the lattice must be rebuilt with the new tile count/order. */
  tilesChanged: boolean;
  /** `currentIndex` changed (including null transitions). */
  currentChanged: boolean;
};

// ---------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------

export const BLOCK_COLS = 12;
export const BLOCK_ROWS = 8;
export const SLOTS_PER_BLOCK = 12;
export const EXPANDED_SIZE = 6;
export const TEMPLATE_COUNT = 5;

/** Rectangle in grid units. `col`/`row` may be negative in world space. */
export type GridRect = { col: number; row: number; w: number; h: number };
/** Rectangle in world pixels. */
export type PixelRect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
/** Pixel metrics: side of one grid cell and the gap between cells. */
export type Metrics = { cell: number; gap: number };
/** Block mirror: 0 = as designed, 1 = horizontal flip, 2 = vertical flip, 3 = both. */
export type Mirror = 0 | 1 | 2 | 3;
export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * A rendered occurrence of a tile. The plane is tiled periodically by a "cell": a full rectangle of
 * `blocksPerCell = cellCols × cellRows` blocks where `cellCols = ceil(sqrt(ceil(tileCount / 12)))` and
 * `cellRows = ceil(ceil(tileCount / 12) / cellCols)`. By default block `b` shows tiles
 * `(12·b + slot) mod tileCount`. The library wall replaces that identity map with a cover-aware
 * spread so identical artwork is not packed into neighbouring slots; leftover slots in the cell
 * still become extra copies, and the same assignment repeats in every periodic cell.
 */
export type Instance = {
  /** `${cellSlot}:${repeatX}:${repeatY}` — stable identity of this occurrence. */
  id: string;
  /** `blockInCell * 12 + slot`. */
  cellSlot: number;
  blockInCell: number;
  /** 0..11 slot inside the block template. */
  slot: number;
  /** Which periodic copy of the cell this instance belongs to (any integer). */
  repeatX: number;
  repeatY: number;
  /** World block coordinates: `bc = repeatX * cellCols + blockInCell % cellCols`, likewise `br`. */
  bc: number;
  br: number;
  /** Index into `QueueModel.tiles`. */
  tileIndex: number;
  /** World grid rect (already includes the block offset `bc * 12`, `br * 8`). */
  rect: GridRect;
};

/**
 * Pure geometry of the infinite wall for a fixed tile count and pixel metrics. Implemented in
 * `geometry/lattice.ts` (`createLattice`). All methods are deterministic and allocation-light; the
 * wall calls `cull` at most once per re-cull, never per frame.
 */
export type Lattice = {
  readonly tileCount: number;
  readonly metrics: Metrics;
  readonly blocksPerCell: number;
  readonly cellCols: number;
  readonly cellRows: number;
  /** World pixel size of one periodic cell. */
  readonly cellPixelSize: { w: number; h: number };
  /** Grid unit in pixels: `cell + gap`. */
  readonly unit: number;
  /** Pixel rect of a grid rect: `x = col·unit`, `w = w·cell + (w − 1)·gap`. */
  toPixels(rect: GridRect): PixelRect;
  /** Pixel centre of a grid rect. */
  centerOf(rect: GridRect): Point;
  /**
   * All 12 instances of world block `(bc, br)`. When `expanded` lies in this block, the block uses the
   * pre-solved reflow table so `expanded.slot` becomes 6×6 and the other 11 cards move; otherwise the
   * hashed template + mirror layout applies. Slot order is preserved in both cases.
   */
  blockInstances(bc: number, br: number, expanded: Instance | null): Instance[];
  /** Single instance of a block slot (same layout rules as `blockInstances`). */
  instanceAt(bc: number, br: number, slot: number, expanded: Instance | null): Instance;
  /**
   * Instances whose pixel rect intersects `bounds` grown by `overscan` px on every side, ordered
   * nearest-to-bounds-centre first and capped at `limit` (default 250).
   */
  cull(bounds: PixelRect, overscan: number, expanded: Instance | null, limit?: number): Instance[];
  /** The occurrence of `tileIndex` whose centre is closest to `point` (world px). */
  nearestInstance(tileIndex: number, point: Point, expanded: Instance | null): Instance;
  /** Rebuild an instance from its id (layout may differ depending on `expanded`); null if malformed. */
  fromId(id: string, expanded: Instance | null): Instance | null;
  /**
   * Keyboard neighbour: the instance in the same or an adjacent block whose centre lies in
   * `direction` from `from` and minimises a direction-weighted distance. Never returns `from`.
   */
  neighbor(from: Instance, direction: Direction, expanded: Instance | null): Instance;
  /** Convenience: does `instance` belong to the block that hosts `expanded`? */
  sameBlock(a: Instance, b: Instance): boolean;
};

// ---------------------------------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------------------------------

/** World-pixel point shown at the viewport centre plus zoom. */
export type CameraState = { x: number; y: number; scale: number };

/** Implemented in `wall/camera.ts` (`createCamera`). Owns pan/fling/fly animation; no DOM. */
export type Camera = {
  readonly state: Readonly<CameraState>;
  /** Viewport size in CSS px; main updates it on resize. */
  setViewport(width: number, height: number): void;
  readonly viewport: Readonly<{ width: number; height: number }>;
  /** Instant moves; cancel any animation. */
  setCenter(x: number, y: number): void;
  setScale(scale: number): void;
  /** Eased flight (ease-out cubic) to a target centre and optional scale. `durationMs` 0 = instant. */
  flyTo(target: { x: number; y: number; scale?: number }, durationMs: number): void;
  /** Pan by screen pixels (divides by scale internally); cancels flight and inertia. */
  panBy(dx: number, dy: number): void;
  /** Start inertia with a screen-space velocity in px/s; exponential decay, stops below 5 px/s. */
  fling(vx: number, vy: number): void;
  stop(): void;
  /** Advance flight/inertia. Returns true when the state changed this frame. */
  tick(nowMs: number): boolean;
  readonly animating: boolean;
  /** Visible world rect (px) for the current state. */
  bounds(): PixelRect;
  screenToWorld(px: number, py: number): Point;
  worldToScreen(x: number, y: number): Point;
  /** CSS transform for `.world` with `transform-origin: 0 0`. */
  transform(): string;
};

// ---------------------------------------------------------------------------------------------------
// Pointer input
// ---------------------------------------------------------------------------------------------------

export type PointerPanHandlers = {
  /** Drag movement in screen px since last event (only after the 7 px threshold). */
  onPan(dx: number, dy: number): void;
  /** Pointer released after a drag with a screen-space velocity in px/s (already smoothed). */
  onFling(vx: number, vy: number): void;
  /** Pointer released without exceeding the drag threshold. */
  onTap(target: EventTarget | null, clientX: number, clientY: number): void;
  /** Wheel / trackpad scroll translated to a pan in screen px (Shift + wheel becomes horizontal). */
  onWheel(dx: number, dy: number): void;
  /** Drag started (the wall suppresses hover while dragging). */
  onDragStart(): void;
  onDragEnd(): void;
};

/** Implemented in `wall/pointerPan.ts` (`attachPointerPan(field, handlers)`). */
export type PointerPan = { dispose(): void };

// ---------------------------------------------------------------------------------------------------
// Playback clock (SPEC §8)
// ---------------------------------------------------------------------------------------------------

export type ClockSnapshot = {
  positionSeconds: number;
  durationSeconds: number;
  /** Host state string as received (`playing`, `paused`, `stopped`, `ended`, ...). */
  state: string;
  trackId: string | null;
  /** True while position advances between host samples. */
  running: boolean;
};

/** Implemented in `host/clock.ts` (`createPlaybackClock`). Pure; time is always passed in. */
export type PlaybackClock = {
  /** Feed a `playback:status` sample (1 Hz). Applies hard/soft correction rules from SPEC §8. */
  ingest(status: EchoWorkshopPlaybackStatus, nowMs: number): void;
  /** Optimistic local seek; the next two host samples may override it. */
  seek(positionSeconds: number, nowMs: number): void;
  /** Interpolated snapshot for `nowMs`. */
  read(nowMs: number): ClockSnapshot;
  /** True when `state === 'playing'` and a rAF loop is needed to advance position. */
  readonly running: boolean;
};

// ---------------------------------------------------------------------------------------------------
// Host bridge (SPEC §4, §11)
// ---------------------------------------------------------------------------------------------------

export type RequiredCapability =
  | 'library:read'
  | 'playback:read'
  | 'playback:control'
  | 'queue:read'
  | 'queue:control'
  | 'lyrics:read'
  | 'fs:plugin';

export type SettingValues = Record<string, string | number | boolean | null>;

export type BootData = {
  /** Capabilities from `host.getCapabilities()` that are granted and available. */
  missing: RequiredCapability[];
  context: EchoWorkshopUiContext;
  settings: SettingValues;
  /** Null when `queue:read` is missing or the call failed. */
  queue: EchoWorkshopQueueSnapshot | null;
  /** Null when `playback:read` is missing or the call failed. */
  status: EchoWorkshopPlaybackStatus | null;
  /** Persisted camera centre (world px) from `echo.storage`, or null. */
  camera: Point | null;
};

/**
 * Implemented in `host/bridge.ts` (`createHostBridge`). Wraps the global `echo` API, enforces the
 * startup burst budget (≤ 6 requests), throttles seek to ≤ 4/s with a guaranteed trailing call, and
 * debounces camera persistence by 2 s. All control methods resolve `void` and swallow host errors
 * after reporting them through `onError`.
 */
export type HostBridge = {
  boot(): Promise<BootData>;
  /** Requests `immersive`; on rejection retries with `full`. Returns what the host accepted. */
  requestPresentation(title: string, immersive: boolean): Promise<'immersive' | 'full' | 'unchanged'>;
  onQueueChanged(handler: (snapshot: EchoWorkshopQueueSnapshot) => void): () => void;
  onPlaybackStatus(handler: (status: EchoWorkshopPlaybackStatus) => void): () => void;
  onContextChanged(handler: (context: EchoWorkshopUiContext) => void): () => void;
  onSettingsChanged(handler: (values: SettingValues) => void): () => void;
  onError(handler: (message: string) => void): () => void;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  toggleShuffle(): Promise<void>;
  setRepeat(mode: 'off' | 'one' | 'all'): Promise<void>;
  seek(positionSeconds: number): Promise<void>;
  playItem(queueId: string): Promise<void>;
  playTrack(trackId: string, queueTrackIds?: string[]): Promise<void>;
  getLyrics(trackId: string): Promise<EchoWorkshopSandboxLyrics | null>;
  setSetting(id: string, value: string | number | boolean | null): Promise<void>;
  saveCamera(camera: Point): void;
  closePanel(): Promise<void>;
  /** Open another declared panel of this plugin (`wall` / `albums`). */
  openPanel(panelId: string): Promise<void>;
  /** Cancel timers (debounced camera save, seek throttle). */
  dispose(): void;
};

// ---------------------------------------------------------------------------------------------------
// Settings (SPEC §10)
// ---------------------------------------------------------------------------------------------------

export type CellSizeId = 'S' | 'M' | 'L';
export type LightingMode = 'spotlight' | 'daytime';

export type LatticeSettings = {
  immersive: boolean;
  autoFocus: boolean;
  lightingMode: LightingMode;
  vignette: boolean;
  lightsOut: boolean;
  posterTint: boolean;
  posterTintCustom: boolean;
  /** `#rrggbb` */
  posterTintColor: string;
  /** 0..1 */
  posterTintIntensity: number;
  cellSize: CellSizeId;
  showLyrics: boolean;
  showTranslation: boolean;
  /** Sanitized CSS font-family stack; empty keeps the system stack. */
  uiFont: string;
};

// ---------------------------------------------------------------------------------------------------
// Lyrics (SPEC §9)
// ---------------------------------------------------------------------------------------------------

export type LyricsWord = { text: string; startMs: number; endMs: number | null };

export type LyricsLine = {
  startMs: number;
  /** Start of the next line, or `startMs + 5000` for the last line. */
  endMs: number;
  text: string;
  translation: string | null;
  words: LyricsWord[];
};

export type LyricsTimeline =
  | { kind: 'synced'; lines: LyricsLine[]; offsetMs: number }
  | { kind: 'plain'; text: string }
  | { kind: 'instrumental' }
  | { kind: 'empty' };

export type LyricsViewOptions = { showTranslation: boolean; reducedMotion: boolean };

/** Implemented in `lyrics/lyricsView.ts` (`createLyricsView`). Mounts into the expanded card. */
export type LyricsView = {
  readonly element: HTMLElement;
  setTimeline(timeline: LyricsTimeline | null): void;
  setOptions(options: LyricsViewOptions): void;
  /** Per-frame update with the clock position (ms, before offset). Cheap when nothing changed. */
  update(positionMs: number): boolean;
  /** Synced lyrics still have a line after the current (or first upcoming) row. */
  hasFollowingLine(): boolean;
  /** True when a synced timeline is active (main keeps the rAF loop alive while playing). */
  readonly needsFrames: boolean;
  dispose(): void;
};

// ---------------------------------------------------------------------------------------------------
// Wall renderer (SPEC §2.2, §2.3, §6)
// ---------------------------------------------------------------------------------------------------

export type WallVisualOptions = {
  lightsOut: boolean;
  vignette: boolean;
  tint: boolean;
  /** Resolved tint colour (`#rrggbb`), black unless explicitly customized. */
  tintColor: string;
  tintIntensity: number;
  reducedMotion: boolean;
};

export type PosterWallHandlers = {
  /** Card activated by click / Enter / Space. */
  onActivate(instance: Instance): void;
  /** Focus moved (keyboard or programmatic). */
  onFocusChange(instance: Instance | null): void;
  /** Expansion spring for `instance` has settled (mount lyrics now). */
  onExpandSettled(instance: Instance): void;
  /** Pointer hovered the current track's card (prefetch lyrics). */
  onHoverCurrent(instance: Instance): void;
  /** Tap on the expanded card's blank area (toggle controls visibility). */
  onExpandedTap(instance: Instance): void;
};

/** Mount points inside the expanded card; owned by the wall, filled by controls/lyrics. */
export type ExpandedContent = {
  root: HTMLElement;
  meta: HTMLElement;
  controls: HTMLElement;
  lyrics: HTMLElement;
};

/**
 * Implemented in `wall/posterWall.ts` (`createPosterWall(world, handlers)`). Owns the `.poster` DOM
 * pool, culling, springs and the entrance wave. It never talks to the host.
 */
export type PosterWall = {
  /**
   * Replace geometry + tiles (queue changed or cell size changed). Keeps expanded/focus when ids
   * survive. `followTiles` rematches mounted cards to nearby slots of the same song.
   */
  setLattice(lattice: Lattice, tiles: Tile[], options?: { followTiles?: boolean }): void;
  setCurrent(tileIndex: number | null): void;
  setExpanded(instance: Instance | null): void;
  readonly expanded: Instance | null;
  setFocus(instance: Instance | null, options?: { scrollIntoView?: boolean }): void;
  readonly focused: Instance | null;
  setVisualOptions(options: WallVisualOptions): void;
  /**
   * Per-frame hook. Re-culls only when the camera nears the edge of the culled area, integrates
   * springs for cards whose target rect changed, and writes styles. Returns true while any card is
   * still animating (main keeps the rAF loop alive).
   */
  render(camera: Camera, nowMs: number): boolean;
  /** Play the diagonal entrance wave once (SPEC §2.1). No-op under reduced motion. */
  playEntrance(nowMs: number): void;
  /** Whether the expanded card's pixel rect intersects the camera bounds (drives the locate button). */
  expandedVisible(camera: Camera): boolean;
  /** Mount points inside the expanded card, or null when nothing is expanded / not yet mounted. */
  expandedContent(): ExpandedContent | null;
  /** Instance for a DOM node inside `.world`, or null. */
  instanceFromTarget(target: EventTarget | null): Instance | null;
  /** Release all cards and page data while retaining delegated event handlers. */
  clear(): void;
  dispose(): void;
};

// ---------------------------------------------------------------------------------------------------
// Controls (SPEC §2.3)
// ---------------------------------------------------------------------------------------------------

export type ControlHandlers = {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seek(positionSeconds: number): void;
  /** Play the expanded non-current card. */
  playThis(): void;
  /** Toggle whether lyrics render on the current expanded card. */
  toggleLyrics(): void;
  /** Toggle host shuffle. */
  toggleShuffle(): void;
  /** Toggle host single-track repeat (`one` / `off`). */
  toggleRepeatOne(): void;
};

/**
 * Implemented in `wall/controls.ts` (`createWallControls(handlers)`). Owns the expanded card control
 * cluster (mounted into `ExpandedContent.controls`).
 */
export type WallControls = {
  /**
   * Mount the control cluster for the expanded card. `mode` picks the primary action (play/pause vs
   * play this card); the seek row (slider + times) is only shown for `'current'`.
   */
  mountExpanded(container: HTMLElement, mode: 'current' | 'other'): void;
  unmountExpanded(): void;
  /** Show/hide the control cluster inside the expanded card (touch-friendly toggle). */
  setControlsHidden(hidden: boolean): void;
  readonly controlsHidden: boolean;
  /** Per-frame update of progress, times and play/pause glyphs. */
  update(clock: ClockSnapshot): void;
  /** Focus the seek slider (keyboard flows). */
  focusSeek(): boolean;
  /** True when the seek slider has focus (arrow keys seek instead of navigating). */
  readonly seekFocused: boolean;
  /** Keep the lyrics toggle in sync with the persisted `show-lyrics` setting. */
  setLyricsVisible(visible: boolean): void;
  /** Keep the shuffle toggle in sync with host `shuffleEnabled`. */
  setShuffleEnabled(enabled: boolean): void;
  /** Keep the single-track repeat toggle in sync with host `repeatMode === 'one'`. */
  setRepeatOne(enabled: boolean): void;
  dispose(): void;
};
