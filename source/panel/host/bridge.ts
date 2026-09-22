import type { BootData, HostBridge, Point, RequiredCapability, SettingValues } from '../types.ts';

export type HostBridgeOptions = {
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  probes?: ReadonlyArray<readonly [RequiredCapability, string]>;
};

/** Minimum spacing between `playback:seek` requests (≤ 4 per second). */
export const SEEK_THROTTLE_MS = 250;
/** Quiet period before the camera centre is persisted. */
export const CAMERA_SAVE_DEBOUNCE_MS = 2000;
/** Error messages handed to `onError` are cut to the host's own error-length limit. */
export const ERROR_MESSAGE_LIMIT = 160;

const MAX_ERROR_HANDLERS = 16;
const MAX_TRACKED_SUBSCRIPTIONS = 64;
const CAMERA_STORAGE_KEY = 'camera';

/**
 * Representative action per required permission; a permission counts as missing when the host does
 * not report this action as `granted && available` (feature ids are action ids, see plugin-api.json).
 */
export const CAPABILITY_PROBES: ReadonlyArray<readonly [RequiredCapability, string]> = [
  ['library:read', 'library:getTracks'],
  ['playback:read', 'playback:getStatus'],
  ['playback:control', 'playback:play'],
  ['queue:control', 'queue:playTrack'],
  ['lyrics:read', 'lyrics:get'],
  ['fs:plugin', 'settings:get'],
];

// The SDK declaration may not list `immersive` yet; the host rejects it with `invalid-payload` when unsupported.
const IMMERSIVE_SIZE = 'immersive' as string as EchoWorkshopPanelSize;

type TimerHandle = ReturnType<typeof setTimeout>;
type Unsubscribe = () => void;
type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isQueueSnapshot = (value: unknown): value is EchoWorkshopQueueSnapshot =>
  isRecord(value) && Array.isArray(value.items);

const isPlaybackStatus = (value: unknown): value is EchoWorkshopPlaybackStatus =>
  isRecord(value) && isFiniteNumber(value.positionSeconds);

const isUiContext = (value: unknown): value is EchoWorkshopUiContext => isRecord(value);

const isSettingValues = (value: unknown): value is SettingValues => isRecord(value);

const isLyrics = (value: unknown): value is EchoWorkshopSandboxLyrics =>
  isRecord(value) && typeof value.kind === 'string';

const toCamera = (value: unknown): Point | null =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) ? { x: value.x, y: value.y } : null;

const describeError = (error: unknown): string => {
  if (isRecord(error) && typeof error.message === 'string' && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return 'unknown-error';
};

/** Invokes a host method so that synchronous throws surface as rejections instead of escaping. */
const invoke = <T>(fn: () => Promise<T> | T): Promise<T> => {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
};

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ ok: true, value }) as Settled<T>,
    (error) => ({ ok: false, error }) as Settled<T>,
  );

export function deriveMissingCapabilities(capabilities: unknown, probes = CAPABILITY_PROBES): RequiredCapability[] {
  if (!isRecord(capabilities) || !isRecord(capabilities.features)) return [];
  const features = capabilities.features;
  const missing: RequiredCapability[] = [];
  for (const [capability, action] of probes) {
    const feature = features[action];
    if (!isRecord(feature) || feature.granted !== true || feature.available !== true) missing.push(capability);
  }
  return missing;
}

export function createHostBridge(api: EchoWorkshopApi, options?: HostBridgeOptions): HostBridge {
  const now = options?.now ?? (() => performance.now());
  const schedule = options?.setTimeout ?? setTimeout;
  const cancel = options?.clearTimeout ?? clearTimeout;

  const errorHandlers = new Set<(message: string) => void>();
  const subscriptions = new Set<Unsubscribe>();
  let disposed = false;

  const report = (action: string, error: unknown): void => {
    const message = `${action}: ${describeError(error)}`.slice(0, ERROR_MESSAGE_LIMIT);
    for (const handler of errorHandlers) {
      try {
        handler(message);
      } catch {
        // A failing error listener must not take the bridge down with it.
      }
    }
  };

  /** Fire-and-forget control call: resolves either way and routes failures to `onError`. */
  const control = (action: string, fn: () => Promise<unknown>): Promise<void> =>
    invoke(fn).then(
      () => undefined,
      (error) => report(action, error),
    );

  /** Read that degrades to `fallback` on failure or an unexpected payload shape. */
  const degraded = <T>(action: string, fn: () => Promise<unknown>, accept: (value: unknown) => value is T, fallback: T): Promise<T> =>
    invoke(fn).then(
      (value) => {
        if (accept(value)) return value;
        report(action, 'invalid-response');
        return fallback;
      },
      (error) => {
        report(action, error);
        return fallback;
      },
    );

  const boot = async (): Promise<BootData> => {
    const missingPromise = invoke(() => api.host.getCapabilities()).then(
      (value) => deriveMissingCapabilities(value, options?.probes),
      (error) => {
        report('host:getCapabilities', error);
        return [] as RequiredCapability[];
      },
    );
    const contextPromise = settle(invoke(() => api.ui.getContext()));

    const missing = await missingPromise;
    const probes = options?.probes ?? CAPABILITY_PROBES;
    const requested = new Set(probes.map(([capability]) => capability));
    const has = (capability: RequiredCapability): boolean => requested.has(capability) && !missing.includes(capability);

    const [settings, queue, status, camera] = await Promise.all([
      has('fs:plugin')
        ? degraded<SettingValues>('settings:get', () => api.settings.get(), isSettingValues, {})
        : Promise.resolve<SettingValues>({}),
      has('queue:read')
        ? degraded<EchoWorkshopQueueSnapshot | null>('queue:get', () => api.queue.get(), isQueueSnapshot, null)
        : Promise.resolve(null),
      has('playback:read')
        ? degraded<EchoWorkshopPlaybackStatus | null>('playback:getStatus', () => api.playback.getStatus(), isPlaybackStatus, null)
        : Promise.resolve(null),
      has('fs:plugin')
        ? invoke(() => api.storage.get(CAMERA_STORAGE_KEY)).then(toCamera, (error) => {
          report('storage:get', error);
          return null;
        })
        : Promise.resolve(null),
    ]);

    const context = await contextPromise;
    if (!context.ok) throw context.error instanceof Error ? context.error : new Error(`ui:getContext: ${describeError(context.error)}`);
    if (!isUiContext(context.value)) throw new Error('ui:getContext: invalid-response');

    return { missing, context: context.value, settings, queue, status, camera };
  };

  const requestPresentation = async (title: string, immersive: boolean): Promise<'immersive' | 'full' | 'unchanged'> => {
    const apply = async (size: EchoWorkshopPanelSize): Promise<boolean> => {
      const result = await invoke(() => api.ui.setPanelPresentation({ size, title }));
      return !isRecord(result) || typeof result.size !== 'string' || result.size === size;
    };
    if (immersive) {
      try {
        if (await apply(IMMERSIVE_SIZE)) return 'immersive';
      } catch {
        // Older hosts reject the size with `invalid-payload`; `full` is the documented fallback.
      }
    }
    try {
      if (await apply('full')) return 'full';
    } catch (error) {
      report('ui:setPanelPresentation', error);
    }
    return 'unchanged';
  };

  const listen = <T>(
    name: string,
    source: (handler: (payload: unknown) => void) => unknown,
    accept: (value: unknown) => value is T,
    handler: (value: T) => void,
  ): Unsubscribe => {
    const wrapped = (payload: unknown): void => {
      if (!accept(payload)) return;
      try {
        handler(payload);
      } catch (error) {
        report(`event:${name}`, error);
      }
    };
    let raw: unknown;
    try {
      raw = source(wrapped);
    } catch (error) {
      report(`event:${name}`, error);
      return () => undefined;
    }
    const off: Unsubscribe = () => {
      subscriptions.delete(off);
      if (typeof raw !== 'function') return;
      try {
        (raw as () => void)();
      } catch {
        // Unsubscribing from a torn-down host must stay silent.
      }
    };
    if (subscriptions.size < MAX_TRACKED_SUBSCRIPTIONS) subscriptions.add(off);
    return off;
  };

  let seekTimer: TimerHandle | null = null;
  let seekPending: number | null = null;
  let lastSeekAt = Number.NEGATIVE_INFINITY;

  const sendSeek = (positionSeconds: number): Promise<void> => {
    lastSeekAt = now();
    return control('playback:seek', () => api.playback.seek(positionSeconds));
  };

  const flushSeek = (): void => {
    seekTimer = null;
    if (seekPending === null) return;
    const value = seekPending;
    seekPending = null;
    void sendSeek(value);
  };

  const seek = (positionSeconds: number): Promise<void> => {
    if (disposed || !Number.isFinite(positionSeconds)) return Promise.resolve();
    const value = Math.max(0, positionSeconds);
    const elapsed = now() - lastSeekAt;
    if (seekTimer === null && elapsed >= SEEK_THROTTLE_MS) return sendSeek(value);
    seekPending = value;
    if (seekTimer === null) seekTimer = schedule(flushSeek, Math.max(0, SEEK_THROTTLE_MS - elapsed));
    return Promise.resolve();
  };

  let cameraTimer: TimerHandle | null = null;
  let cameraPending: Point | null = null;

  const flushCamera = (): void => {
    cameraTimer = null;
    const value = cameraPending;
    cameraPending = null;
    if (!value) return;
    void control('storage:set', () => api.storage.set(CAMERA_STORAGE_KEY, value));
  };

  const saveCamera = (camera: Point): void => {
    if (disposed || !isRecord(camera) || !isFiniteNumber(camera.x) || !isFiniteNumber(camera.y)) return;
    cameraPending = { x: Math.round(camera.x), y: Math.round(camera.y) };
    if (cameraTimer !== null) cancel(cameraTimer);
    cameraTimer = schedule(flushCamera, CAMERA_SAVE_DEBOUNCE_MS);
  };

  const dispose = (): void => {
    disposed = true;
    if (seekTimer !== null) cancel(seekTimer);
    seekTimer = null;
    seekPending = null;
    if (cameraTimer !== null) cancel(cameraTimer);
    cameraTimer = null;
    cameraPending = null;
    for (const off of Array.from(subscriptions)) off();
    subscriptions.clear();
    errorHandlers.clear();
  };

  return {
    boot,
    requestPresentation,
    onQueueChanged: (handler) =>
      listen('queue:changed', (h) => api.events.on('queue:changed', h), isQueueSnapshot, handler),
    onPlaybackStatus: (handler) =>
      listen('playback:status', (h) => api.events.on('playback:status', h), isPlaybackStatus, handler),
    onContextChanged: (handler) =>
      listen('ui:context-changed', (h) => api.ui.onContextChanged(h), isUiContext, handler),
    onSettingsChanged: (handler) =>
      listen('settings:changed', (h) => api.settings.onChanged(h), isSettingValues, handler),
    onError: (handler) => {
      if (typeof handler !== 'function' || errorHandlers.size >= MAX_ERROR_HANDLERS) return () => undefined;
      errorHandlers.add(handler);
      return () => {
        errorHandlers.delete(handler);
      };
    },
    play: () => control('playback:play', () => api.playback.play()),
    pause: () => control('playback:pause', () => api.playback.pause()),
    next: () => control('playback:next', () => api.playback.next()),
    previous: () => control('playback:previous', () => api.playback.previous()),
    toggleShuffle: () => control('playback:toggleShuffle', () => api.playback.toggleShuffle()),
    setRepeat: (mode) => control('playback:setRepeat', () => api.playback.setRepeat(mode)),
    seek,
    playItem: (queueId) => control('queue:playItem', () => api.queue.playItem(queueId)),
    playTrack: (trackId, queueTrackIds) => control('queue:playTrack', () => api.queue.playTrack(trackId, queueTrackIds)),
    getLyrics: (trackId) =>
      invoke(() => api.lyrics.get(trackId)).then(
        (value) => (isLyrics(value) ? value : null),
        (error) => {
          report('lyrics:get', error);
          return null;
        },
      ),
    setSetting: (id, value) => control('settings:set', () => api.settings.set(id, value)),
    saveCamera,
    closePanel: () => control('ui:closePanel', () => api.ui.closePanel()),
    openPanel: (panelId) => control('ui:openPanel', () => {
      const open = api.ui.openPanel;
      if (typeof open !== 'function') throw new Error('unsupported');
      return open(panelId);
    }),
    dispose,
  };
}
