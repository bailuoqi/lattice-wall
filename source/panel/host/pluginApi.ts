import type { WallHostApi } from './api.ts';

/** Keep the existing wall UI; adapt the host-owned plug-in controls at the entry point. */
export const createPluginWallApi = (sdk: EchoWorkshopApi): WallHostApi => ({
  ...sdk,
  ...(typeof sdk.playback.getRate === 'function' && typeof sdk.playback.setRate === 'function' ? { speed: {
    get: () => sdk.playback.getRate(), set: (rate: number) => sdk.playback.setRate(rate),
    onChanged: (handler: (rate: number) => void) => sdk.events.on('playback:status', value => {
      const rate = value && typeof value === 'object' ? (value as { playbackRate?: unknown }).playbackRate : undefined;
      if (typeof rate === 'number' && Number.isFinite(rate)) handler(rate);
    }),
  } } : {}),
  ...(sdk.window && typeof sdk.window.getDesktopWall === 'function' ? { desktop: {
    get: () => sdk.window.getDesktopWall(), set: (enabled: boolean) => sdk.window.setDesktopWall(enabled),
  } } : {}),
});
