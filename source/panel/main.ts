import { applyContext } from './host/context.ts';
import type {
  BootData,
  Camera,
  ExpandedContent,
  Instance,
  Lattice,
  LatticeSettings,
  LyricsTimeline,
  Point,
  RequiredCapability,
  Tile,
} from './types.ts';
import { createHostBridge } from './host/bridge.ts';
import { createPlaybackClock } from './host/clock.ts';
import {
  createLibraryTrackLoader,
  currentLibraryIndex,
  libraryPageNotice,
  libraryTrackTiles,
  playContextIds,
} from './host/libraryModel.ts';
import { applyAppearance, cellMetricsFor, resolveSettings, SETTING_IDS, settingEntries, wallExpandedScale, wallOverviewScale, wallVisualsFromSettings } from './host/settings.ts';
import { createControlPanel } from './controlPanel.ts';
import { createLattice } from './geometry/lattice.ts';
import { createSpreadLattice, reseatPlayingToSquare } from './geometry/tileSpread.ts';
import { createCamera } from './wall/camera.ts';
import { attachPointerPan } from './wall/pointerPan.ts';
import { attachKeyboardNav } from './wall/keyboardNav.ts';
import { createPosterWall } from './wall/posterWall.ts';
import { createWallControls } from './wall/controls.ts';
import { buildLyricsTimeline } from './lyrics/lyricsModel.ts';
import {
  lyricsContentReady,
  measureLyricsOpenHeight,
} from './lyrics/lyricsSlot.ts';
import { createLyricsTransition } from './lyrics/lyricsTransition.ts';
import { createLyricsView } from './lyrics/lyricsView.ts';
import { createStateOverlay } from './stateOverlay.ts';

const PANEL_TITLE = 'Lattice · 曲库拼贴墙';
const FLY_MS = 420;
const FOLLOW_FLY_MS = 520;
const FOCUS_MARGIN_PX = 40;
/** Hosts without vsync throttling fire rAF at several hundred Hz; skip frames closer than this (keeps 144 Hz intact). */
const MIN_FRAME_MS = 6.5;

type PanelState = 'booting' | 'ready' | 'empty' | 'denied';

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
};


const start = async (): Promise<void> => {
  const field = byId<HTMLDivElement>('field');
  const world = byId<HTMLDivElement>('world');
  const locate = byId<HTMLButtonElement>('locate');
  const stateEl = byId<HTMLElement>('state');
  const overlay = createStateOverlay(stateEl, byId<HTMLElement>('lattice'));
  const bridge = createHostBridge(echo);
  bridge.onError((message) => console.warn('[lattice-wall]', message));

  let state: PanelState = 'booting';
  const setState = (next: PanelState, detail?: { missing?: RequiredCapability[] }): void => {
    state = next;
    document.body.dataset.state = next;
    overlay.show(next, detail);
  };

  let boot: BootData;
  try {
    boot = await bridge.boot();
  } catch {
    setState('denied', { missing: [] });
    return;
  }

  applyContext(boot.context);
  let context = boot.context;
  let settings: LatticeSettings = resolveSettings(boot.settings);
  applyAppearance(settings);
  let tiles: Tile[] = [];
  let currentIndex: number | null = null;
  let playingTrackId: string | null = boot.status?.currentTrackId ?? null;
  let pageLoaded = false;

  if (boot.missing.length > 0) {
    setState('denied', { missing: boot.missing });
    return;
  }

  void bridge.requestPresentation(PANEL_TITLE, settings.immersive);

  // ---- long-lived collaborators -------------------------------------------------------------------
  const camera: Camera = createCamera();
  const clock = createPlaybackClock();
  const lyricsView = createLyricsView();
  let lattice: Lattice | null = null;
  let wallReady = false;
  let viewportReady = false;
  let expandedUiFor: string | null = null;
  let lyricsMountedFor: string | null = null;
  const lyricsTransition = createLyricsTransition();
  let lyricsCache: { trackId: string; timeline: LyricsTimeline } | null = null;
  let lyricsRequest: string | null = null;
  let focused: Instance | null = null;
  let locateVisible = false;

  const now = (): number => performance.now();
  const currentTile = () => (currentIndex === null ? null : tiles[currentIndex] ?? null);
  const currentTrackId = (): string | null => clock.read(now()).trackId ?? currentTile()?.trackId ?? playingTrackId;
  const playTile = (tile: Tile): void => {
    const wallIndex = tiles.indexOf(tile);
    void bridge.playTrack(tile.trackId, wallIndex >= 0 ? playContextIds(tiles, wallIndex) : undefined);
  };

  // ---- frame loop --------------------------------------------------------------------------------
  let frameId = 0;
  const requestFrame = (): void => {
    if (frameId !== 0 || !context.visible) return;
    frameId = requestAnimationFrame(frame);
  };

  const setLocateVisible = (visible: boolean): void => {
    if (visible === locateVisible) return;
    locateVisible = visible;
    locate.dataset.visible = String(visible);
  };

  /** The locate button is offered whenever the current track's expanded card is not on screen. */
  const updateLocate = (): void => {
    const expanded = wall.expanded;
    const currentOnScreen = expanded !== null
      && expanded.tileIndex === currentIndex
      && wall.expandedVisible(camera);
    setLocateVisible(state === 'ready' && currentIndex !== null && !currentOnScreen);
  };

  let lastFrameAt = 0;
  const frame = (time: number): void => {
    frameId = 0;
    if (!wallReady) return;
    if (time - lastFrameAt < MIN_FRAME_MS) {
      requestFrame();
      return;
    }
    lastFrameAt = time;
    const cameraChanged = camera.tick(time);
    if (cameraChanged) {
      world.style.transform = camera.transform();
      bridge.saveCamera({ x: camera.state.x, y: camera.state.y });
    }
    const wallAnimating = wall.render(camera, time);
    const snapshot = clock.read(time);
    controls.update(snapshot);
    if (lyricsMountedFor !== null && lyricsView.needsFrames) {
      const rowsChanged = lyricsView.update(snapshot.positionSeconds * 1000);
      if (rowsChanged) {
        const content = wall.expandedContent();
        if (content) fitLyricsSlot(content);
      }
    }
    updateLocate();
    if (camera.animating || wallAnimating || (clock.running && context.visible)) requestFrame();
  };

  // ---- lyrics ------------------------------------------------------------------------------------
  const expectFollowingLyric = (): boolean => lyricsView.hasFollowingLine();

  const fitLyricsSlot = (content: ExpandedContent): void => {
    const card = content.root.closest<HTMLElement>('.poster');
    if (!card || card.dataset.lyrics !== 'true' || lyricsTransition.running) return;
    lyricsTransition.fit(content, measureLyricsOpenHeight(card, content.lyrics, expectFollowingLyric()));
  };

  const unmountLyrics = (animate = false): void => {
    const content = wall.expandedContent();
    const card = content?.root.closest<HTMLElement>('.poster');
    if (animate && content && card) {
      card.dataset.lyrics = 'false';
      // Keep the mounted timeline and nodes through a reversal. Closing must not restart
      // the current line's entrance, replace its words, or stop its playback clock.
      lyricsTransition.toggle(content, false, context.reducedMotion, () => {
        lyricsMountedFor = null;
        lyricsView.element.remove();
      });
      return;
    }
    lyricsTransition.reset();
    lyricsMountedFor = null;
    lyricsView.setTimeline(null);
    lyricsView.element.remove();
    card?.removeAttribute('data-lyrics');
  };

  const setLyricsOpen = (content: ExpandedContent, open: boolean): void => {
    const card = content.root.closest<HTMLElement>('.poster');
    if (!card) return;
    if (card.dataset.lyrics === String(open)) {
      if (open) fitLyricsSlot(content);
      return;
    }
    lyricsView.update(clock.read(now()).positionSeconds * 1000);
    if (open) lyricsTransition.fit(content, measureLyricsOpenHeight(card, content.lyrics, expectFollowingLyric()));
    card.dataset.lyrics = String(open);
    lyricsTransition.toggle(content, open, context.reducedMotion, () => {
      if (open) fitLyricsSlot(content);
    });
  };

  const mountLyricsIfReady = (): void => {
    const expanded = wall.expanded;
    const tile = currentTile();
    if (!expanded || !tile || expanded.tileIndex !== currentIndex || !settings.showLyrics) return;
    if (expandedUiFor !== expanded.id) return;
    const content = wall.expandedContent();
    if (!content || !lyricsCache || lyricsCache.trackId !== tile.trackId) return;
    const hasLines = lyricsCache.timeline.kind !== 'empty';
    const card = content.root.closest<HTMLElement>('.poster');
    const settled = card?.dataset.settled === 'true';
    const openWhenLaidOut = (): void => {
      const tryOpen = (attempts: number): void => {
        requestAnimationFrame(() => {
          if (lyricsMountedFor !== expanded.id || !settings.showLyrics) return;
          if (wall.expandedContent() !== content) return;
          lyricsView.update(clock.read(now()).positionSeconds * 1000);
          if (!lyricsContentReady(content.lyrics, expectFollowingLyric()) && attempts < 24) {
            tryOpen(attempts + 1);
            return;
          }
          setLyricsOpen(content, true);
        });
      };
      tryOpen(0);
    };
    if (lyricsMountedFor === expanded.id) {
      if (!hasLines) setLyricsOpen(content, false);
      else if (settled && card?.dataset.lyrics !== 'true') openWhenLaidOut();
      return;
    }
    if (!hasLines) {
      setLyricsOpen(content, false);
      return;
    }
    lyricsMountedFor = expanded.id;
    lyricsView.setOptions({ showTranslation: settings.showTranslation, reducedMotion: context.reducedMotion });
    lyricsView.setTimeline(lyricsCache.timeline);
    content.lyrics.replaceChildren(lyricsView.element);
    lyricsView.update(clock.read(now()).positionSeconds * 1000);
    if (settled) openWhenLaidOut();
    requestFrame();
  };

  const ensureLyrics = (trackId: string): void => {
    if (lyricsCache?.trackId === trackId || lyricsRequest === trackId) return;
    lyricsRequest = trackId;
    void bridge.getLyrics(trackId).then((lyrics) => {
      if (lyricsRequest !== trackId) return;
      lyricsRequest = null;
      if (currentTrackId() !== trackId && currentTile()?.trackId !== trackId) return;
      lyricsCache = { trackId, timeline: buildLyricsTimeline(lyrics) };
      mountLyricsIfReady();
    });
  };

  // ---- expansion ---------------------------------------------------------------------------------
  const expandedRectOf = (instance: Instance): Instance =>
    lattice!.instanceAt(instance.bc, instance.br, instance.slot, instance);

  const overviewScale = (): number => wallOverviewScale(camera.viewport.width);
  const expandedScale = (): number => wallExpandedScale(camera.viewport.width);
  const cameraScale = (): number => (wall.expanded ? expandedScale() : overviewScale());

  const mountExpandedUi = (): void => {
    const expanded = wall.expanded;
    if (!expanded) return;
    const content: ExpandedContent | null = wall.expandedContent();
    if (!content) return;
    const isCurrent = expanded.tileIndex === currentIndex;
    if (expandedUiFor !== expanded.id) {
      expandedUiFor = expanded.id;
      controls.setControlsHidden(false);
    }
    controls.mountExpanded(content.controls, isCurrent ? 'current' : 'other');
    if (isCurrent) {
      const tile = currentTile();
      if (tile && settings.showLyrics) {
        ensureLyrics(tile.trackId);
        mountLyricsIfReady();
      }
    } else {
      unmountLyrics();
    }
  };

  const reseatPlayingNear = (near: Point): void => {
    if (!lattice || currentIndex === null || tiles.length === 0) return;
    const playingAt = lattice.nearestInstance(currentIndex, near, null);
    lattice = createLattice(tiles.length, lattice.metrics, reseatPlayingToSquare(lattice, playingAt, currentIndex));
    wall.setLattice(lattice, tiles, { followTiles: true });
    wall.setCurrent(currentIndex);
  };

  const expand = (instance: Instance, flyMs = FLY_MS): void => {
    if (!lattice) return;
    const same = wall.expanded?.id === instance.id;
    if (!same) {
      const previous = wall.expanded;
      const targetTile = instance.tileIndex;
      const targetNear = lattice.centerOf(instance.rect);
      unmountLyrics();
      controls.unmountExpanded();
      expandedUiFor = null;
      if (currentIndex !== null && targetTile !== currentIndex) {
        reseatPlayingNear(previous ? lattice.centerOf(previous.rect) : { x: camera.state.x, y: camera.state.y });
        instance = lattice.nearestInstance(targetTile, targetNear, null);
      }
      wall.setExpanded(instance);
    }
    focused = wall.expanded ?? instance;
    wall.setFocus(focused);
    const target = lattice.centerOf(expandedRectOf(instance).rect);
    camera.flyTo({ x: target.x, y: target.y, scale: expandedScale() }, context.reducedMotion ? 0 : flyMs);
    mountExpandedUi();
    requestFrame();
  };

  const collapse = (options?: { reshuffle?: boolean }): void => {
    if (!wall.expanded || !lattice) return;
    const expanded = wall.expanded;
    const playing = currentIndex !== null && expanded.tileIndex === currentIndex;
    const near = lattice.centerOf(expanded.rect);
    unmountLyrics();
    controls.unmountExpanded();
    expandedUiFor = null;
    wall.setExpanded(null);
    wall.setFocus(null);
    focused = null;
    field.focus({ preventScroll: true });
    const overview = overviewScale();
    if (options?.reshuffle !== false && currentIndex !== null && tiles.length > 0) {
      const playingAt = lattice.nearestInstance(currentIndex, near, null);
      reseatPlayingNear(near);
      const landed = lattice.nearestInstance(currentIndex, lattice.centerOf(playingAt.rect), null);
      if (playing) {
        camera.flyTo(
          { x: lattice.centerOf(landed.rect).x, y: lattice.centerOf(landed.rect).y, scale: overview },
          context.reducedMotion ? 0 : 300,
        );
      } else if (Math.abs(camera.state.scale - overview) > 0.01) {
        camera.flyTo({ x: camera.state.x, y: camera.state.y, scale: overview }, context.reducedMotion ? 0 : 300);
      }
    } else if (Math.abs(camera.state.scale - overview) > 0.01) {
      camera.flyTo({ x: camera.state.x, y: camera.state.y, scale: overview }, context.reducedMotion ? 0 : 300);
    }
    requestFrame();
  };

  const revealInstance = (instance: Instance, durationMs: number): void => {
    if (!lattice) return;
    const rect = lattice.toPixels(instance.rect);
    const bounds = camera.bounds();
    const margin = FOCUS_MARGIN_PX / camera.state.scale;
    let dx = 0;
    let dy = 0;
    if (rect.x - margin < bounds.x) dx = rect.x - margin - bounds.x;
    else if (rect.x + rect.w + margin > bounds.x + bounds.w) dx = rect.x + rect.w + margin - (bounds.x + bounds.w);
    if (rect.y - margin < bounds.y) dy = rect.y - margin - bounds.y;
    else if (rect.y + rect.h + margin > bounds.y + bounds.h) dy = rect.y + rect.h + margin - (bounds.y + bounds.h);
    if (dx !== 0 || dy !== 0) {
      camera.flyTo({ x: camera.state.x + dx, y: camera.state.y + dy }, context.reducedMotion ? 0 : durationMs);
      requestFrame();
    }
  };

  const focusCurrent = (flyMs: number): void => {
    if (!lattice || currentIndex === null) return;
    const instance = lattice.nearestInstance(currentIndex, camera.state, wall.expanded);
    expand(instance, flyMs);
  };

  // ---- wall / controls ---------------------------------------------------------------------------
  const wall = createPosterWall(world, {
    onActivate: (instance) => expand(instance),
    onFocusChange: (instance) => { focused = instance; },
    onExpandSettled: () => mountExpandedUi(),
    onHoverCurrent: () => {
      const tile = currentTile();
      if (tile && settings.showLyrics) ensureLyrics(tile.trackId);
    },
    onExpandedTap: () => controls.setControlsHidden(!controls.controlsHidden),
  });

  let shuffleEnabled = boot.status?.shuffleEnabled === true || boot.queue?.shuffleEnabled === true;
  let repeatOne = boot.status?.repeatMode === 'one' || boot.queue?.repeatMode === 'one';
  const controls = createWallControls({
    play: () => void bridge.play(),
    pause: () => void bridge.pause(),
    next: () => void bridge.next(),
    previous: () => void bridge.previous(),
    seek: (seconds) => {
      clock.seek(seconds, now());
      void bridge.seek(seconds);
      requestFrame();
    },
    playThis: () => {
      const expanded = wall.expanded;
      const tile = expanded ? tiles[expanded.tileIndex] : null;
      if (tile) playTile(tile);
    },
    toggleLyrics: () => {
      const next = !settings.showLyrics;
      settings = { ...settings, showLyrics: next };
      controls.setLyricsVisible(next);
      void bridge.setSetting(SETTING_IDS.showLyrics, next);
      if (!next) unmountLyrics(true);
      else mountExpandedUi();
    },
    toggleShuffle: () => {
      shuffleEnabled = !shuffleEnabled;
      controls.setShuffleEnabled(shuffleEnabled);
      void bridge.toggleShuffle();
    },
    toggleRepeatOne: () => {
      repeatOne = !repeatOne;
      controls.setRepeatOne(repeatOne);
      void bridge.setRepeat(repeatOne ? 'one' : 'off');
    },
  });
  controls.setLyricsVisible(settings.showLyrics);
  controls.setShuffleEnabled(shuffleEnabled);
  controls.setRepeatOne(repeatOne);

  const applyVisuals = (): void => {
    applyAppearance(settings);
    wall.setVisualOptions(wallVisualsFromSettings(settings, context.reducedMotion));
    lyricsView.setOptions({ showTranslation: settings.showTranslation, reducedMotion: context.reducedMotion });
    if (context.reducedMotion) lyricsTransition.finish();
  };

  // ---- lattice lifecycle -------------------------------------------------------------------------
  const rebuildLattice = (): void => {
    if (tiles.length === 0) return;
    const previousUnit = lattice?.unit ?? null;
    lattice = createSpreadLattice(tiles, cellMetricsFor(settings.cellSize));
    if (previousUnit !== null && previousUnit !== lattice.unit) {
      const ratio = lattice.unit / previousUnit;
      camera.setCenter(camera.state.x * ratio, camera.state.y * ratio);
      world.style.transform = camera.transform();
    }
    const hadExpanded = wall.expanded;
    wall.setLattice(lattice, tiles);
    wall.setCurrent(currentIndex);
    if (hadExpanded && !wall.expanded) {
      unmountLyrics();
      controls.unmountExpanded();
      expandedUiFor = null;
    }
    requestFrame();
  };

  const initialCamera = (): void => {
    if (!lattice) return;
    if (currentIndex !== null) {
      const instance = lattice.nearestInstance(currentIndex, { x: 0, y: 0 }, null);
      const centre = lattice.centerOf(expandedRectOf(instance).rect);
      camera.setCenter(centre.x, centre.y);
      camera.setScale(expandedScale());
      world.style.transform = camera.transform();
      wall.setExpanded(instance);
      focused = wall.expanded;
      wall.setFocus(focused);
      mountExpandedUi();
      return;
    }
    const first = lattice.nearestInstance(0, boot.camera ?? { x: 0, y: 0 }, null);
    const centre = lattice.centerOf(first.rect);
    camera.setCenter(centre.x, centre.y);
    camera.setScale(overviewScale());
    world.style.transform = camera.transform();
    focused = first;
    wall.setFocus(first);
  };

  const enterReady = (): void => {
    if (!viewportReady || !pageLoaded || tiles.length === 0) return;
    setState('ready');
    rebuildLattice();
    applyVisuals();
    initialCamera();
    wallReady = true;
    wall.playEntrance(now());
    requestFrame();
  };

  const applyPlayingTrack = (trackId: string | null, follow: boolean): void => {
    playingTrackId = trackId;
    const nextIndex = currentLibraryIndex(tiles, trackId);
    const changed = nextIndex !== currentIndex;
    currentIndex = nextIndex;
    if (wallReady) wall.setCurrent(currentIndex);
    if (!changed) {
      mountExpandedUi();
      return;
    }
    if (lyricsCache && lyricsCache.trackId !== currentTile()?.trackId) {
      lyricsCache = null;
      unmountLyrics();
    }
    if (follow && settings.autoFocus && currentIndex !== null) focusCurrent(FOLLOW_FLY_MS);
    else mountExpandedUi();
  };

  const overlayCopy = (title: string, body: string): void => {
    const heading = stateEl.querySelector('h2');
    const paragraph = stateEl.querySelector('p');
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = body;
  };

  const loader = createLibraryTrackLoader((query) => echo.library.getTracks(query));
  const loadPage = async (page: number, search: string): Promise<void> => {
    collapse({ reshuffle: false });
    wallReady = false;
    pageLoaded = false;
    tiles = [];
    currentIndex = null;
    wall.clear();
    lattice = null;
    setLocateVisible(false);
    browser.loading(page);
    overlay.setNotice(null);
    setState('booting');
    overlayCopy('正在读取曲库', '从 ECHO 曲库加载歌曲…');
    try {
      const result = await loader.load(page, search);
      if (!result) return;
      browser.update(result);
      tiles = libraryTrackTiles(result.items, result.page);
      currentIndex = currentLibraryIndex(tiles, playingTrackId);
      if (tiles.length === 0) {
        setState('empty');
        overlayCopy(
          search ? '没有找到歌曲' : '曲库中还没有歌曲',
          search ? '按 Ctrl + Space 修改关键词，或清空搜索。' : '在 ECHO 中导入音乐后，按 Ctrl + Space 打开功能面板并刷新。',
        );
        return;
      }
      pageLoaded = true;
      if (viewportReady) enterReady();
      overlay.setNotice(libraryPageNotice(result));
    } catch {
      browser.error();
      setState('empty');
      overlayCopy('暂时无法读取曲库', '按 Ctrl + Space 打开功能面板并刷新重试；如尚未授权，请在 Workshop → 已安装 中确认读取曲库权限。');
    }
  };
  const commitSettings = (previous: LatticeSettings, persist: Partial<LatticeSettings> | null): void => {
    if (settings.cellSize !== previous.cellSize && state === 'ready') rebuildLattice();
    if (settings.immersive !== previous.immersive) void bridge.requestPresentation(PANEL_TITLE, settings.immersive);
    applyVisuals();
    if (settings.showLyrics !== previous.showLyrics) {
      if (settings.showLyrics) mountExpandedUi();
      else unmountLyrics(true);
    }
    controls.setLyricsVisible(settings.showLyrics);
    browser.syncSettings(settings);
    if (persist) {
      for (const [id, value] of settingEntries(persist)) void bridge.setSetting(id, value);
    }
  };
  const patchSettings = (patch: Partial<LatticeSettings>): void => {
    const previous = settings;
    settings = { ...settings, ...patch };
    commitSettings(previous, patch);
  };
  const browser = createControlPanel(byId<HTMLElement>('lattice'), {
    wall: 'library',
    settings,
    lyrics: true,
    search: {
      placeholder: '输入歌曲或艺术家',
      searchLabel: '搜索歌曲',
      unit: '首',
    },
    onLoad: (page, search) => { void loadPage(page, search); },
    onSwitchWall: (target) => {
      if (target !== 'albums') return;
      void bridge.openPanel('albums');
    },
    onPatchSettings: patchSettings,
  });

  // ---- input -------------------------------------------------------------------------------------
  const onLocate = (): void => focusCurrent(FLY_MS);
  locate.addEventListener('click', onLocate);

  const pointer = attachPointerPan(field, {
    onPan: (dx, dy) => { camera.panBy(dx, dy); requestFrame(); },
    onFling: (vx, vy) => { camera.fling(vx, vy); requestFrame(); },
    onTap: () => undefined,
    onWheel: (dx, dy) => { camera.panBy(-dx, -dy); requestFrame(); },
    onDragStart: () => { document.body.dataset.dragging = 'true'; },
    onDragEnd: () => { delete document.body.dataset.dragging; },
  });

  const keyboard = attachKeyboardNav(document.body, {
    move: (direction) => {
      if (!lattice || !wallReady) return;
      const from = focused ?? lattice.cull(camera.bounds(), 0, wall.expanded, 1)[0];
      if (!from) return;
      const next = lattice.neighbor(from, direction, wall.expanded);
      focused = next;
      wall.setFocus(next);
      revealInstance(next, 260);
    },
    activate: () => {
      if (!focused) { focusCurrent(FLY_MS); return; }
      if (wall.expanded && wall.expanded.id === focused.id) {
        if (focused.tileIndex === currentIndex) {
          if (clock.read(now()).state === 'playing') void bridge.pause(); else void bridge.play();
        } else {
          const tile = tiles[focused.tileIndex];
          if (tile) playTile(tile);
        }
        return;
      }
      expand(focused);
    },
    secondary: () => {
      if (!focused) { focusCurrent(FLY_MS); return; }
      if (wall.expanded && wall.expanded.id === focused.id) controls.setControlsHidden(!controls.controlsHidden);
      else expand(focused);
    },
    escape: () => {
      if (wall.expanded) collapse();
      else void bridge.closePanel();
    },
    focusCurrent: () => focusCurrent(FLY_MS),
    toggle: (setting) => {
      const patch: Partial<LatticeSettings> = {};
      if (settings.lightingMode === 'daytime') patch.lightingMode = 'spotlight';
      if (setting === 'lights-out') patch.lightsOut = !settings.lightsOut;
      if (setting === 'vignette') patch.vignette = !settings.vignette;
      if (setting === 'tint') patch.posterTint = !settings.posterTint;
      patchSettings(patch);
    },
    seekBy: (delta) => {
      if (!controls.seekFocused) return false;
      const snapshot = clock.read(now());
      const limit = snapshot.durationSeconds > 0 ? snapshot.durationSeconds : Number.POSITIVE_INFINITY;
      const target = Math.max(0, Math.min(limit, snapshot.positionSeconds + delta));
      clock.seek(target, now());
      void bridge.seek(target);
      requestFrame();
      return true;
    },
  });

  // ---- host events -------------------------------------------------------------------------------
  if (boot.status) clock.ingest(boot.status, now());

  const unsubscribe = [
    bridge.onPlaybackStatus((status) => {
      const before = clock.read(now()).trackId;
      clock.ingest(status, now());
      if (status.currentTrackId !== before) applyPlayingTrack(status.currentTrackId ?? null, true);
      if (status.currentTrackId !== before && status.currentTrackId && settings.showLyrics && wall.expanded?.tileIndex === currentIndex) {
        ensureLyrics(status.currentTrackId);
      }
      if (status.shuffleEnabled === true || status.shuffleEnabled === false) {
        shuffleEnabled = status.shuffleEnabled;
        controls.setShuffleEnabled(shuffleEnabled);
      }
      if (status.repeatMode === 'off' || status.repeatMode === 'one' || status.repeatMode === 'all') {
        repeatOne = status.repeatMode === 'one';
        controls.setRepeatOne(repeatOne);
      }
      requestFrame();
    }),
    echo.events.on('library:changed', () => {
      overlay.setNotice('曲库已更新，按 Ctrl + Space 打开功能面板并刷新');
    }),
    bridge.onContextChanged((next) => {
      const wasVisible = context.visible;
      const reducedChanged = next.reducedMotion !== context.reducedMotion;
      context = next;
      applyContext(next);
      if (reducedChanged) applyVisuals();
      if (!wasVisible && next.visible) requestFrame();
    }),
    bridge.onSettingsChanged((values) => {
      const previous = settings;
      settings = resolveSettings(values);
      commitSettings(previous, null);
    }),
  ];

  // ---- viewport ----------------------------------------------------------------------------------
  const resize = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    if (width < 1 || height < 1) return;
    camera.setViewport(width, height);
    world.style.transform = camera.transform();
    if (!viewportReady) {
      viewportReady = true;
      if (pageLoaded) enterReady();
    } else if (state === 'ready' && !camera.animating) {
      camera.setScale(cameraScale());
      world.style.transform = camera.transform();
    }
    requestFrame();
  });
  resize.observe(field);
  void loadPage(1, '');

  window.addEventListener('pagehide', () => {
    for (const stop of unsubscribe) stop();
    locate.removeEventListener('click', onLocate);
    pointer.dispose();
    keyboard.dispose();
    browser.dispose();
    loader.cancel();
    resize.disconnect();
    wall.dispose();
    controls.dispose();
    lyricsTransition.reset();
    lyricsView.dispose();
    bridge.dispose();
    tiles = [];
  }, { once: true });
};

void start();
