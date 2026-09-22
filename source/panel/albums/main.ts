import type { Instance, Lattice, LatticeSettings, Point, Tile } from '../types.ts';
import { createHostBridge } from '../host/bridge.ts';
import { applyContext } from '../host/context.ts';
import { createPlaybackClock } from '../host/clock.ts';
import { applyAppearance, cellMetricsFor, resolveSettings, settingEntries, wallExpandedScale, wallOverviewScale, wallVisualsFromSettings } from '../host/settings.ts';
import { createLattice } from '../geometry/lattice.ts';
import { reseatPlayingToSquare } from '../geometry/tileSpread.ts';
import { createCamera } from '../wall/camera.ts';
import { createPosterWall } from '../wall/posterWall.ts';
import { attachPointerPan } from '../wall/pointerPan.ts';
import { attachKeyboardNav } from '../wall/keyboardNav.ts';
import { createStateOverlay } from '../stateOverlay.ts';
import { ALBUM_PAGE_SIZE, ALBUM_PROBES, albumTiles, createPageLoader, currentAlbumIndex } from './albumModel.ts';
import { createControlPanel } from '../controlPanel.ts';
import { createAlbumDetails } from './albumDetails.ts';

const TITLE = 'Lattice · 专辑拼贴墙';

async function start(): Promise<void> {
  const field = document.getElementById('field')!;
  const world = document.getElementById('world')!;
  const state = document.getElementById('state')!;
  const root = document.getElementById('lattice')!;
  const locate = document.getElementById('locate') as HTMLButtonElement;
  const overlay = createStateOverlay(state, root);
  const bridge = createHostBridge(echo, { probes: ALBUM_PROBES });
  // Exit is available even if the host refuses library access or boot fails.
  const earlyExit = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey) void bridge.closePanel();
  };
  document.addEventListener('keydown', earlyExit);
  const boot = await bridge.boot().catch(() => null);
  if (!boot) { overlay.show('denied'); return; }
  applyContext(boot.context);
  if (boot.missing.length) { overlay.show('denied', { missing: [...new Set(boot.missing)] }); return; }
  document.removeEventListener('keydown', earlyExit);
  let context = boot.context;
  let settings = resolveSettings(boot.settings);
  applyAppearance(settings);
  void bridge.requestPresentation(TITLE, settings.immersive);
  let albums: EchoWorkshopAlbum[] = [];
  let tiles: Tile[] = [];
  let track = boot.queue?.currentTrack ?? null;
  let current: number | null = null;
  let lattice: Lattice | null = null;
  let ready = false, disposed = false;
  let mounted: string | null = null;
  let frameId = 0, lastFrame = 0;
  let shuffleEnabled = boot.status?.shuffleEnabled === true || boot.queue?.shuffleEnabled === true;
  let repeatOne = boot.status?.repeatMode === 'one' || boot.queue?.repeatMode === 'one';
  const camera = createCamera();
  const clock = createPlaybackClock();
  const now = () => performance.now();
  const isExpandedCurrent = () => wall.expanded !== null && current !== null && wall.expanded.tileIndex === current;
  const togglePlay = () => {
    if (clock.read(now()).state === 'playing') void bridge.pause();
    else void bridge.play();
  };
  const details = createAlbumDetails(echo, {
    playAlbum: () => undefined,
    play: () => void bridge.play(),
    pause: () => void bridge.pause(),
    togglePlay,
    previous: () => void bridge.previous(),
    next: () => void bridge.next(),
    seek: (position) => {
      clock.seek(position, now());
      void bridge.seek(position);
    },
    toggleShuffle: () => {
      shuffleEnabled = !shuffleEnabled;
      details.setShuffleEnabled(shuffleEnabled);
      void bridge.toggleShuffle();
    },
    toggleRepeatOne: () => {
      repeatOne = !repeatOne;
      details.setRepeatOne(repeatOne);
      void bridge.setRepeat(repeatOne ? 'one' : 'off');
    },
  });
  details.setShuffleEnabled(shuffleEnabled);
  details.setRepeatOne(repeatOne);
  const loader = createPageLoader(query => echo.library.getAlbums(query), ALBUM_PAGE_SIZE);
  const requestFrame = () => {
    if (!frameId && !disposed && context.visible) frameId = requestAnimationFrame(frame);
  };
  const updateLocate = () => {
    locate.dataset.visible = String(ready && current !== null && (wall.expanded?.tileIndex !== current || !wall.expandedVisible(camera)));
  };
  function frame(time: number) {
    frameId = 0;
    if (!ready || disposed || !context.visible) return;
    if (time - lastFrame < 6.5) { requestFrame(); return; }
    lastFrame = time;
    if (camera.tick(time)) world.style.transform = camera.transform();
    const moving = wall.render(camera, time);
    mountDetails();
    if (isExpandedCurrent()) details.updateClock(clock.read(time));
    updateLocate();
    if (moving || camera.animating || clock.running) requestFrame();
  }
  function mountDetails() {
    const instance = wall.expanded;
    const content = wall.expandedContent();
    const album = instance ? albums[instance.tileIndex] : null;
    if (!content || !instance || !album || mounted === instance.id) return;
    mounted = instance.id;
    const currentAlbum = current !== null && instance.tileIndex === current;
    details.mount(content, album, currentAlbum);
    details.updateCurrent(track?.id ?? null, currentAlbum);
    content.root.style.setProperty('--album-scale', String(fitScale()));
  }
  const fitScale = () => Math.min(1, Math.min(camera.viewport.width, camera.viewport.height) * .94 / (6 * lattice!.unit - lattice!.metrics.gap));
  function reseatPlayingNear(near: Point): void {
    if (!lattice || current === null || tiles.length === 0) return;
    const playingAt = lattice.nearestInstance(current, near, null);
    lattice = createLattice(tiles.length, lattice.metrics, reseatPlayingToSquare(lattice, playingAt, current));
    wall.setLattice(lattice, tiles, { followTiles: true });
    wall.setCurrent(current);
  }
  function expand(instance: Instance, flyMs = 420) {
    if (!lattice || !ready) return;
    const same = wall.expanded?.id === instance.id;
    if (!same) {
      const previous = wall.expanded;
      const targetTile = instance.tileIndex;
      const targetNear = lattice.centerOf(instance.rect);
      details.clear();
      mounted = null;
      if (current !== null && targetTile !== current) {
        reseatPlayingNear(previous ? lattice.centerOf(previous.rect) : { x: camera.state.x, y: camera.state.y });
        instance = lattice.nearestInstance(targetTile, targetNear, null);
      }
    }
    wall.setExpanded(instance);
    wall.setFocus(wall.expanded);
    const expanded = wall.expanded!;
    const center = lattice.centerOf(expanded.rect);
    const duration = context.reducedMotion ? 0 : flyMs;
    if (duration <= 0) {
      camera.setCenter(center.x, center.y);
      camera.setScale(wallExpandedScale(camera.viewport.width));
      world.style.transform = camera.transform();
    } else {
      camera.flyTo({ ...center, scale: wallExpandedScale(camera.viewport.width) }, duration);
    }
    requestFrame();
  }
  function collapse(options?: { reshuffle?: boolean }) {
    if (!wall.expanded || !lattice) return;
    const expanded = wall.expanded;
    const playing = current !== null && expanded.tileIndex === current;
    const near = lattice.centerOf(expanded.rect);
    details.clear();
    mounted = null;
    wall.setExpanded(null);
    wall.setFocus(null);
    field.focus({ preventScroll: true });
    const overview = wallOverviewScale(camera.viewport.width);
    if (options?.reshuffle !== false && current !== null && tiles.length > 0) {
      const playingAt = lattice.nearestInstance(current, near, null);
      reseatPlayingNear(near);
      const landed = lattice.nearestInstance(current, lattice.centerOf(playingAt.rect), null);
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
  }
  const wall = createPosterWall(world, {
    onActivate: expand,
    onFocusChange: () => undefined,
    onExpandSettled: mountDetails,
    onExpandedTap: () => details.toggle(),
    onHoverCurrent: () => undefined,
  });
  const visuals = () => {
    applyAppearance(settings);
    wall.setVisualOptions(wallVisualsFromSettings(settings, context.reducedMotion));
  };
  const commitSettings = (previous: LatticeSettings, persist: Partial<LatticeSettings> | null): void => {
    visuals();
    browser.syncSettings(settings);
    if (previous.cellSize !== settings.cellSize) {
      collapse({ reshuffle: false });
      rebuild();
    }
    if (previous.immersive !== settings.immersive) void bridge.requestPresentation(TITLE, settings.immersive);
    if (persist) {
      for (const [id, value] of settingEntries(persist)) void bridge.setSetting(id, value);
    }
  };
  const patchSettings = (patch: Partial<LatticeSettings>): void => {
    const previous = settings;
    settings = { ...settings, ...patch };
    commitSettings(previous, patch);
  };
  const focusCurrent = () => {
    if (lattice && current !== null) expand(lattice.nearestInstance(current, camera.state, wall.expanded));
  };
  const rebuild = () => {
    if (!tiles.length) return;
    lattice = createLattice(tiles.length, cellMetricsFor(settings.cellSize));
    wall.setLattice(lattice, tiles); wall.setCurrent(current); visuals(); requestFrame();
  };
  // Paging reuses the renderer while dropping old tile references and mounted cards via clear().
  async function loadPage(page: number, search: string) {
    collapse({ reshuffle: false }); ready = false; camera.stop();
    albums = []; tiles = []; current = null;
    wall.clear(); lattice = null;
    updateLocate(); browser.loading(page);
    overlay.setNotice(null);
    overlay.show('booting');
    state.querySelector('h2')!.textContent = '正在读取专辑';
    state.querySelector('p')!.textContent = '从 ECHO 曲库加载…';
    try {
      const result = await loader.load(page, search);
      if (!result || disposed) return;
      browser.update(result);
      albums = result.items; tiles = albumTiles(albums, result.page);
      current = currentAlbumIndex(albums, track);
      ready = albums.length > 0;
      document.body.dataset.state = ready ? 'ready' : 'empty';
      overlay.show(ready ? 'ready' : 'empty');
      if (!ready) {
        state.querySelector('h2')!.textContent = search ? '没有找到专辑' : '曲库中还没有专辑';
        state.querySelector('p')!.textContent = search ? '按 Ctrl + Space 修改关键词，或清空搜索。' : '在 ECHO 中导入音乐后，按 Ctrl + Space 打开功能面板并刷新。';
        return;
      }
      rebuild();
      const instance = lattice!.nearestInstance(current ?? 0, { x: 0, y: 0 }, null);
      if (current !== null) expand(instance, 0);
      else {
        const center = lattice!.centerOf(instance.rect);
        camera.setCenter(center.x, center.y);
        camera.setScale(wallOverviewScale(camera.viewport.width));
        world.style.transform = camera.transform();
        wall.setFocus(instance);
      }
      wall.playEntrance(performance.now());
      requestFrame();
    } catch {
      if (disposed) return;
      browser.error(); overlay.show('empty');
      state.querySelector('h2')!.textContent = '暂时无法读取专辑';
      state.querySelector('p')!.textContent = '按 Ctrl + Space 打开功能面板并刷新重试；如尚未授权，请在 Workshop → 已安装 中确认读取曲库权限。';
    }
  }
  const browser = createControlPanel(root, {
    wall: 'albums',
    settings,
    search: {
      placeholder: '输入专辑关键词',
      searchLabel: '搜索专辑',
      unit: '张',
    },
    onLoad: (page, search) => { void loadPage(page, search); },
    onSwitchWall: (target) => {
      if (target !== 'library') return;
      void bridge.openPanel('wall');
    },
    onPatchSettings: patchSettings,
  });
  const pointer = attachPointerPan(field, {
    onPan: (x, y) => { camera.panBy(x, y); requestFrame(); },
    onFling: (x, y) => { camera.fling(x, y); requestFrame(); },
    onWheel: (x, y) => { camera.panBy(-x, -y); requestFrame(); },
    onTap: () => undefined,
    onDragStart: () => { document.body.dataset.dragging = 'true'; },
    onDragEnd: () => { delete document.body.dataset.dragging; },
  });
  const keyboard = attachKeyboardNav(document.body, {
    move: direction => {
      if (!lattice || !ready) return;
      const from = wall.focused ?? lattice.nearestInstance(current ?? 0, camera.state, wall.expanded);
      const to = lattice.neighbor(from, direction, wall.expanded);
      wall.setFocus(to);
      camera.flyTo(lattice.centerOf(to.rect), context.reducedMotion ? 0 : 260); requestFrame();
    },
    activate: () => {
      if (!wall.focused) return;
      if (wall.expanded?.id !== wall.focused.id) {
        expand(wall.focused);
        return;
      }
      if (isExpandedCurrent()) togglePlay();
      else details.play();
    },
    secondary: () => {
      if (!wall.expanded) {
        if (wall.focused) expand(wall.focused);
        return;
      }
      if (isExpandedCurrent()) togglePlay();
      else details.toggle();
    },
    escape: () => { if (wall.expanded) collapse(); else void bridge.closePanel(); },
    focusCurrent,
    toggle: setting => {
      const patch: Partial<LatticeSettings> = {};
      if (settings.lightingMode === 'daytime') patch.lightingMode = 'spotlight';
      if (setting === 'lights-out') patch.lightsOut = !settings.lightsOut;
      if (setting === 'vignette') patch.vignette = !settings.vignette;
      if (setting === 'tint') patch.posterTint = !settings.posterTint;
      patchSettings(patch);
    },
    seekBy: (delta) => {
      if (!details.seekFocused) return false;
      const snapshot = clock.read(now());
      const next = Math.max(0, snapshot.positionSeconds + delta);
      clock.seek(next, now());
      void bridge.seek(next);
      requestFrame();
      return true;
    },
  });
  locate.addEventListener('click', focusCurrent);
  const stop = [
    bridge.onQueueChanged(snapshot => {
      const before = current;
      track = snapshot.currentTrack; current = currentAlbumIndex(albums, track);
      wall.setCurrent(current);
      details.updateCurrent(track?.id ?? null, isExpandedCurrent());
      if (settings.autoFocus && before !== current && current !== null) focusCurrent();
      requestFrame();
    }),
    bridge.onPlaybackStatus(status => {
      clock.ingest(status, now());
      details.updateStatus(status, isExpandedCurrent());
      if (status.shuffleEnabled === true || status.shuffleEnabled === false) {
        shuffleEnabled = status.shuffleEnabled;
        details.setShuffleEnabled(shuffleEnabled);
      }
      if (status.repeatMode === 'off' || status.repeatMode === 'one' || status.repeatMode === 'all') {
        repeatOne = status.repeatMode === 'one';
        details.setRepeatOne(repeatOne);
      }
      requestFrame();
    }),
    bridge.onContextChanged(next => { context = next; applyContext(next); visuals(); requestFrame(); }),
    bridge.onSettingsChanged(values => {
      const previous = settings;
      settings = resolveSettings(values);
      commitSettings(previous, null);
    }),
  ];
  stop.push(echo.events.on('library:changed', () => {
    overlay.setNotice('曲库已更新，按 Ctrl + Space 打开功能面板并刷新');
  }));
  const resize = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect;
    if (!rect || rect.width < 1 || rect.height < 1) return;
    camera.setViewport(rect.width, rect.height);
    if (!camera.animating) {
      camera.setScale((wall.expanded ? wallExpandedScale : wallOverviewScale)(rect.width));
    }
    if (wall.expanded) {
      wall.expandedContent()?.root.style.setProperty('--album-scale', String(fitScale()));
    }
    world.style.transform = camera.transform(); requestFrame();
  });
  resize.observe(field);
  if (boot.status) {
    clock.ingest(boot.status, now());
    details.updateStatus(boot.status, false);
  }
  visuals();
  void loadPage(1, '');
  window.addEventListener('pagehide', () => {
    disposed = true; cancelAnimationFrame(frameId); loader.cancel();
    for (const off of stop) off();
    locate.removeEventListener('click', focusCurrent);
    resize.disconnect(); pointer.dispose(); keyboard.dispose(); browser.dispose();
    details.dispose(); wall.dispose(); bridge.dispose(); albums = []; tiles = [];
  }, { once: true });
}

void start();
