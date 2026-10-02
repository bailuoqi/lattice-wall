/** Shared, narrow surface supplied by either the plug-in SDK or the theme bridge. */
export type SettingValue = string | number | boolean | null;
export type SpeedControl = {
  get(): Promise<number>;
  set(rate: number): Promise<number>;
  onChanged(handler: (rate: number) => void): () => void;
};

export type DesktopState = { supported: boolean; enabled: boolean };
export type DesktopControl = {
  get(): Promise<DesktopState>;
  set(enabled: boolean): Promise<DesktopState>;
};

export type WallPlaybackStatus = EchoWorkshopPlaybackStatus & { playbackRate?: number };
export type WallHostApi = {
  host: Pick<EchoWorkshopApi['host'], 'getCapabilities'>;
  ui: Pick<EchoWorkshopApi['ui'], 'getContext' | 'onContextChanged' | 'setPanelPresentation' | 'openPanel' | 'closePanel'>;
  events: EchoWorkshopApi['events'];
  settings: {
    get(): Promise<Record<string, SettingValue>>;
    set(id: string, value: SettingValue): Promise<unknown>;
    onChanged(handler: (values: Record<string, SettingValue>) => unknown): () => void;
  };
  storage: Pick<EchoWorkshopApi['storage'], 'get' | 'set'>;
  library: Pick<EchoWorkshopApi['library'], 'getTracks' | 'getAlbums' | 'getAlbumTracks'>;
  queue: Pick<EchoWorkshopApi['queue'], 'get' | 'playItem' | 'playTrack' | 'playAlbum'>;
  playback: Pick<EchoWorkshopApi['playback'], 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'toggleShuffle' | 'setRepeat'> & {
    getStatus(): Promise<WallPlaybackStatus>;
  };
  lyrics: Pick<EchoWorkshopApi['lyrics'], 'get'>;
  speed?: SpeedControl;
  desktop?: DesktopControl;
};
