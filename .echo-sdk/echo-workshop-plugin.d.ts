/** ECHO Workshop sandbox plug-in API v2. See echo-workshop-sdk.json for the version contract. */

type EchoWorkshopUnsubscribe = () => void;

interface EchoWorkshopPlaybackStatus {
  state: string;
  currentTrackId: string | null;
  positionSeconds: number;
  durationSeconds: number;
  volume: number | null;
  shuffleEnabled?: boolean;
  repeatMode?: 'off' | 'one' | 'all';
}

interface EchoWorkshopSpectrum {
  bands: number[];
  energy: number;
  transient: number;
  state: string;
}

interface EchoWorkshopOfflineAudioFormat {
  sampleRate: number;
  channels: 1 | 2;
  sampleFormat: 's16le';
}

interface EchoWorkshopOfflineAudioSession {
  sessionId: string;
  trackId: string;
  title: string;
  durationSeconds: number;
  format: EchoWorkshopOfflineAudioFormat;
}

interface EchoWorkshopOfflineAudioChunk {
  sessionId: string;
  /** Raw interleaved PCM16 LE encoded as base64. Local paths are never exposed. */
  dataBase64: string;
  byteLength: number;
  frames: number;
  eof: boolean;
}

interface EchoWorkshopFileExportResult {
  saved: boolean;
  byteLength: number;
}

type EchoWorkshopDspRackModuleId = 'equalizer' | 'convolution' | 'replayGain' | 'compressor'
  | 'crossfeed' | 'stereoField' | 'channelMatrix' | 'channelBalance';
type EchoWorkshopDspModuleId = EchoWorkshopDspRackModuleId | 'workshopAudioEffect';

type EchoWorkshopEqFilterType = 'peaking' | 'lowShelf' | 'highShelf' | 'lowPass' | 'highPass' | 'notch';

interface EchoWorkshopDspEqualizerBand {
  frequencyHz: number;
  gainDb: number;
  q: number;
  filterType?: EchoWorkshopEqFilterType;
  enabled?: boolean;
}

interface EchoWorkshopDspEqualizerState {
  enabled: boolean;
  preampDb: number;
  dspHeadroomDb?: number;
  dspSafetyLimiterEnabled?: boolean;
  bands: EchoWorkshopDspEqualizerBand[];
  presetId: string;
  presetName: string;
  clippingRisk: boolean;
}

interface EchoWorkshopDspEqualizerPatch {
  enabled?: boolean;
  preampDb?: number;
  dspHeadroomDb?: number;
  dspSafetyLimiterEnabled?: boolean;
  bands?: Array<Partial<EchoWorkshopDspEqualizerBand> & { band: number }>;
}

interface EchoWorkshopDspConvolutionState {
  enabled: boolean;
  status: 'empty' | 'loaded' | 'active' | 'error';
  irId: string | null;
  irName: string | null;
  channelMode: 'none' | 'mono' | 'stereo';
  sampleRate: number | null;
  tapCount: number;
  trimDb: number;
  latencySamples: number;
  clippingRisk: boolean;
  error?: string | null;
}

interface EchoWorkshopDspReplayGainState {
  enabled: boolean;
  mode: 'off' | 'track' | 'album';
  targetLufs: number;
  preampDb: number;
}

interface EchoWorkshopDspCompressorWritableState {
  enabled: boolean;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  kneeDb: number;
  makeupDb: number;
  mix: number;
  detectorMode: 'peak' | 'rms';
  sidechainHighpassEnabled: boolean;
  sidechainHighpassHz: number;
  autoRelease: boolean;
  rangeDb: number;
  stereoLink: number;
}

interface EchoWorkshopDspCompressorState extends EchoWorkshopDspCompressorWritableState {
  inputPeakDb: number[];
  inputRmsDb: number[];
  outputPeakDb: number[];
  outputRmsDb: number[];
  gainReductionDb: number;
  gainReductionDbByChannel: number[];
  outputHeadroomDb: number;
  clippingRisk: boolean;
}

interface EchoWorkshopDspCrossfeedState {
  enabled: boolean;
  amount: number;
  cutoffHz: number;
}

interface EchoWorkshopDspStereoFieldState {
  enabled: boolean;
  width: number;
  centerGainDb: number;
  sideGainDb: number;
  clippingRisk: boolean;
}

interface EchoWorkshopDspChannelMatrixState {
  enabled: boolean;
  leftToLeft: number;
  rightToLeft: number;
  leftToRight: number;
  rightToRight: number;
  clippingRisk: boolean;
}

interface EchoWorkshopDspChannelBalanceBandGain {
  leftGainDb: number;
  rightGainDb: number;
}

interface EchoWorkshopDspChannelBalanceState {
  enabled: boolean;
  balance: number;
  leftGainDb: number;
  rightGainDb: number;
  bandGains?: Partial<Record<'low' | 'mid' | 'high', EchoWorkshopDspChannelBalanceBandGain>>;
  leftDelayMs?: number;
  rightDelayMs?: number;
  swapLeftRight: boolean;
  monoMode: 'off' | 'sum' | 'left' | 'right';
  invertLeft: boolean;
  invertRight: boolean;
  constantPower: boolean;
  clippingRisk?: boolean;
}

interface EchoWorkshopAudioEffectState {
  enabled: boolean;
  effect: 'bitcrusher' | 'chiptune' | 'vocalCut';
  bitDepth: number;
  sampleRateHz: number;
  mix: number;
  outputGainDb: number;
  pulseMix: number;
  triangleMix: number;
  noiseMix: number;
  drive: number;
  vocalCutStrength: number;
  vocalCutBassPreserveHz: number;
}

interface EchoWorkshopDspModuleStateMap {
  equalizer: EchoWorkshopDspEqualizerState;
  convolution: EchoWorkshopDspConvolutionState;
  replayGain: EchoWorkshopDspReplayGainState;
  compressor: EchoWorkshopDspCompressorState;
  crossfeed: EchoWorkshopDspCrossfeedState;
  stereoField: EchoWorkshopDspStereoFieldState;
  channelMatrix: EchoWorkshopDspChannelMatrixState;
  channelBalance: EchoWorkshopDspChannelBalanceState;
  workshopAudioEffect: EchoWorkshopAudioEffectState;
}

interface EchoWorkshopDspWritableStateMap {
  equalizer: EchoWorkshopDspEqualizerPatch;
  convolution: Pick<EchoWorkshopDspConvolutionState, 'enabled' | 'trimDb'>;
  replayGain: EchoWorkshopDspReplayGainState;
  compressor: EchoWorkshopDspCompressorWritableState;
  crossfeed: EchoWorkshopDspCrossfeedState;
  stereoField: Omit<EchoWorkshopDspStereoFieldState, 'clippingRisk'>;
  channelMatrix: Omit<EchoWorkshopDspChannelMatrixState, 'clippingRisk'>;
  channelBalance: Omit<EchoWorkshopDspChannelBalanceState, 'clippingRisk'>;
  workshopAudioEffect: EchoWorkshopAudioEffectState;
}

interface EchoWorkshopPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

interface EchoWorkshopTrack {
  id: string;
  mediaType: 'local' | 'remote' | 'streaming';
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string | null;
  durationSeconds: number;
  codec: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrate: number | null;
  coverUrl: string | null;
  unavailable: boolean;
}

interface EchoWorkshopAlbum {
  id: string;
  mediaType: 'local' | 'remote' | 'streaming';
  title: string;
  albumArtist: string;
  year: number | null;
  trackCount: number;
  durationSeconds: number;
  coverUrl: string | null;
}

interface EchoWorkshopArtist {
  id: string;
  mediaType: 'local' | 'remote';
  name: string;
  role: 'track' | 'album' | 'both';
  trackCount: number;
  albumCount: number;
  coverUrl: string | null;
}

interface EchoWorkshopGenre {
  id: string;
  mediaType: 'local' | 'remote';
  name: string;
  unclassified: boolean;
  trackCount: number;
  albumCount: number;
  coverUrl: string | null;
}

interface EchoWorkshopPlaylist {
  id: string;
  name: string;
  description: string | null;
  kind: 'manual' | 'smart' | 'synced' | 'system';
  itemCount: number;
  coverUrl: string | null;
}

interface EchoWorkshopPage<T> {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: T[];
}

interface EchoWorkshopPlaylistItem {
  id: string;
  playlistId: string;
  position: number;
  unavailable: boolean;
  track: EchoWorkshopTrack | null;
}

interface EchoWorkshopLibrarySummary {
  trackCount: number;
  albumCount: number;
  artistCount: number;
  totalDurationSeconds: number;
}

interface EchoWorkshopLikedTrackResult {
  trackId: string;
  liked: boolean;
}

interface EchoWorkshopLikedAlbumResult {
  albumId: string;
  liked: boolean;
}

interface EchoWorkshopTrackActionResult {
  track: EchoWorkshopTrack;
}

interface EchoWorkshopTracksActionResult {
  tracks: EchoWorkshopTrack[];
}

interface EchoWorkshopCollectionPlayResult extends EchoWorkshopTrackActionResult {
  count: number;
}

interface EchoWorkshopQueueItem {
  queueId: string;
  track: EchoWorkshopTrack;
}

interface EchoWorkshopQueueSnapshot {
  currentQueueId: string | null;
  currentTrack: EchoWorkshopTrack | null;
  canGoPrevious: boolean;
  canGoNext: boolean;
  shuffleEnabled: boolean;
  repeatMode: 'off' | 'one' | 'all';
  items: EchoWorkshopQueueItem[];
}

interface EchoWorkshopDirectSource {
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  live?: boolean;
}

interface EchoWorkshopSourceTrack {
  providerTrackId: string;
  title: string;
  artist?: string;
  album?: string;
  durationSeconds?: number | null;
  source?: string;
  coverUrl?: string;
  kind?: 'track' | 'collection';
  live?: boolean;
  playable?: boolean;
  unavailableReason?: string;
}

interface EchoWorkshopSourceSearchRequest {
  query: string;
  page: number;
  pageSize: number;
}

interface EchoWorkshopSourceBrowseRequest {
  page?: number;
  pageSize?: number;
}

interface EchoWorkshopSourceCollectionRequest {
  collectionId: string;
  query?: string;
  page?: number;
  pageSize?: number;
}

interface EchoWorkshopSourceSearchResult {
  tracks: EchoWorkshopSourceTrack[];
  total?: number | null;
  hasMore?: boolean;
}

interface EchoWorkshopSourceProviderHandlers {
  search(request: EchoWorkshopSourceSearchRequest): EchoWorkshopSourceSearchResult | Promise<EchoWorkshopSourceSearchResult>;
  resolve(request: { providerTrackId: string }): EchoWorkshopDirectSource | Promise<EchoWorkshopDirectSource>;
  browse?(request: EchoWorkshopSourceBrowseRequest): EchoWorkshopSourceSearchResult | Promise<EchoWorkshopSourceSearchResult>;
  listCollection?(request: EchoWorkshopSourceCollectionRequest): EchoWorkshopSourceSearchResult | Promise<EchoWorkshopSourceSearchResult>;
}

interface EchoWorkshopLyricsCandidate {
  title?: string;
  language?: string;
  source?: string;
  sourceUrl?: string;
  confidence?: number;
  lrc?: string;
  text?: string;
}

interface EchoWorkshopLyricsRequest {
  track: {
    id: string | null;
    title: string;
    artist: string;
    album: string;
    durationSeconds: number;
  };
  query?: string;
}

interface EchoWorkshopMetadataCandidate {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  bpm?: number;
  confidence?: number;
  source?: string;
  sourceUrl?: string;
}

interface EchoWorkshopCoverCandidate {
  imageUrl: string;
  title?: string;
  source?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
  confidence?: number;
}

interface EchoWorkshopNetworkRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

interface EchoWorkshopNetworkResponse {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

interface EchoWorkshopPlaybackShareTrack {
  id: string | null;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  codec: string | null;
  sizeBytes: number;
}

interface EchoWorkshopPlaybackShareInfo {
  available: boolean;
  reason: 'no-current-track' | 'not-local-file' | 'file-unavailable' | null;
  track: EchoWorkshopPlaybackShareTrack | null;
  allowedHosts: string[];
}

interface EchoWorkshopPlaybackShareTask {
  id: string;
  state: 'queued' | 'uploading' | 'ready' | 'error';
  bytesSent: number;
  totalBytes: number;
  progress: number;
  playbackUrl: string | null;
  expiresAt: string | null;
  error: string | null;
  track: EchoWorkshopPlaybackShareTrack;
}

interface EchoWorkshopSandboxLyrics {
  kind: 'empty' | 'plain' | 'synced' | 'instrumental';
  title: string;
  artist: string;
  album: string | null;
  durationSeconds: number | null;
  offsetMs: number;
  provider: 'none' | 'local' | 'manual' | 'cached' | 'remote';
  lines: Array<{
    timeMs: number;
    text: string;
    translation: string | null;
    romanization: string | null;
    kana: string | null;
    words: Array<{ text: string; startMs: number; endMs: number | null }>;
  }>;
  plainText: string | null;
  syncedText: string | null;
}

interface EchoWorkshopRegisteredCommand {
  id: string;
  title: string;
}

type EchoWorkshopHostUnavailableReason =
  | 'unsupported-platform'
  | 'not-entitled'
  | 'capability-not-approved'
  | 'audio-core-unavailable'
  | 'library-unavailable'
  | 'queue-unavailable'
  | 'decoder-unavailable'
  | 'current-mode-incompatible'
  | 'local-track-required'
  | 'feature-disabled';

interface EchoWorkshopHostFeatureAvailability {
  supported: boolean;
  granted: boolean;
  available: boolean;
  reason: EchoWorkshopHostUnavailableReason | null;
}

interface EchoWorkshopHostCapabilities {
  apiVersion: 2;
  features: Record<string, EchoWorkshopHostFeatureAvailability>;
}

/**
 * Host-owned panel sizes. `immersive` fills the whole ECHO window content area (including over the
 * player bar) with no host chrome at all, so the panel must offer its own way out via
 * `echo.ui.closePanel()` (the host's `Ctrl+Shift+Esc` emergency exit always remains). Hosts older
 * than the version that introduced it reject the value with `invalid-payload`, so fall back to `full`
 * when the request fails.
 */
type EchoWorkshopPanelSize = 'compact' | 'comfortable' | 'wide' | 'full' | 'immersive';
type EchoWorkshopPanelAttention = 'none' | 'info' | 'warning';

interface EchoWorkshopPanelPresentation {
  title: string;
  badge: string | null;
  dirty: boolean;
  attention: EchoWorkshopPanelAttention;
  size: EchoWorkshopPanelSize;
}

interface EchoWorkshopUiAppearance {
  accent: string;
  accentText: string;
  panel: string;
  text: string;
  heading: string;
  muted: string;
  appBg: string;
  border: string;
  player: string;
}

interface EchoWorkshopUiContext {
  surface: 'runtime' | 'panel';
  panel: { id: string; placement: 'main' | 'utility' | 'sidebar' | 'home' | 'lyrics' | 'queue' | 'track-detail' | 'player' } | null;
  visible: boolean;
  locale: string;
  direction: 'ltr' | 'rtl';
  colorScheme: 'light' | 'dark';
  reducedMotion: boolean;
  viewport: { width: number; height: number };
  /** A bounded snapshot of ECHO semantic theme tokens. */
  appearance: EchoWorkshopUiAppearance;
  presentation: EchoWorkshopPanelPresentation | null;
}

type EchoWorkshopCommandInput = Record<string, string | number | boolean | null>;

interface EchoWorkshopApi {
  host: {
    /** Returns sanitized API 2 feature states; it never includes account, device, path, or license data. */
    getCapabilities(): Promise<EchoWorkshopHostCapabilities>;
    /** Accepts an API action id (for example audio:getSpectrum) or a declared capability id. */
    getFeatureAvailability(featureId: string): Promise<EchoWorkshopHostFeatureAvailability>;
  };
  commands: {
    /** A trackContextMenus command receives one sanitized EchoWorkshopTrack as its first argument. */
    /** A parameterized command receives one host-validated EchoWorkshopCommandInput as its first argument. */
    register<TInput = unknown, TResult = unknown>(id: string, metadata: { title: string }, handler: (input: TInput, ...args: unknown[]) => TResult | Promise<TResult>): void;
    /** Compose declared commands inside the same sandbox without adding a host permission. */
    execute<TResult = unknown>(id: string, input?: unknown): Promise<TResult>;
    /** Return commands registered by this plug-in runtime. */
    list(): ReadonlyArray<EchoWorkshopRegisteredCommand>;
  };
  events: {
    on(eventName: 'playback:status' | 'audio:spectrum' | 'queue:changed' | 'library:changed' | 'library:liked-changed' | 'settings:changed', handler: (payload: unknown) => unknown): EchoWorkshopUnsubscribe;
  };
  navigation: {
    open(routeId: string): Promise<null>;
  };
  playback: {
    getStatus(): Promise<EchoWorkshopPlaybackStatus>;
    play(): Promise<null>;
    pause(): Promise<null>;
    seek(positionSeconds: number): Promise<null>;
    previous(): Promise<null>;
    next(): Promise<null>;
    setVolume(volume: number): Promise<null>;
    setShuffle(enabled: boolean): Promise<null>;
    toggleShuffle(): Promise<null>;
    setRepeat(mode: 'off' | 'one' | 'all'): Promise<null>;
    cycleRepeat(): Promise<null>;
    getShareInfo(): Promise<EchoWorkshopPlaybackShareInfo>;
    shareCurrentTrack(options: { uploadUrl: string; roomId?: string; headers?: Record<string, string> }): Promise<EchoWorkshopPlaybackShareTask>;
    getShareTask(taskId: string): Promise<EchoWorkshopPlaybackShareTask>;
    playUrl(url: string, metadata?: Omit<EchoWorkshopDirectSource, 'url'>): Promise<EchoWorkshopTrackActionResult>;
  };
  audio: {
    getSpectrum(): Promise<EchoWorkshopSpectrum>;
    dsp: {
      getModule<T extends EchoWorkshopDspModuleId>(moduleId: T): Promise<EchoWorkshopDspModuleStateMap[T]>;
      setModule<T extends EchoWorkshopDspModuleId>(moduleId: T, state: Partial<EchoWorkshopDspWritableStateMap[T]>): Promise<EchoWorkshopDspModuleStateMap[T]>;
      getRackOrder(): Promise<EchoWorkshopDspRackModuleId[]>;
      setRackOrder(order: EchoWorkshopDspRackModuleId[]): Promise<EchoWorkshopDspRackModuleId[]>;
    };
    offline: {
      /** Starts a host-decoded local-track PCM stream after per-track user confirmation. */
      open(options: { trackId: string; sampleRate?: number; channels?: 1 | 2 }): Promise<EchoWorkshopOfflineAudioSession>;
      /** Reads a bounded sequential PCM chunk. At most one read may be pending per session. */
      read(sessionId: string, options?: { maxFrames?: number }): Promise<EchoWorkshopOfflineAudioChunk>;
      close(sessionId: string): Promise<null>;
    };
  };
  library: {
    getSummary(): Promise<EchoWorkshopLibrarySummary>;
    getTrack(trackId: string): Promise<EchoWorkshopTrack>;
    getTracks(query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopTrack>>;
    getAlbums(query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopAlbum>>;
    getAlbumTracks(id: string, query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopTrack>>;
    getArtists(query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopArtist>>;
    getArtistTracks(id: string, query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopTrack>>;
    getArtistAlbums(id: string, query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopAlbum>>;
    getGenres(query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopGenre>>;
    getGenreTracks(id: string, query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopTrack>>;
    getGenreAlbums(id: string, query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopAlbum>>;
    getPlaylists(): Promise<EchoWorkshopPlaylist[]>;
    getPlaylistItems(id: string, query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopPlaylistItem>>;
    getLikedTracks(query?: EchoWorkshopPageQuery): Promise<EchoWorkshopPage<EchoWorkshopPlaylistItem>>;
    getLikedTrackIds(trackIds: string[]): Promise<Record<string, boolean>>;
    toggleTrackLiked(trackId: string): Promise<EchoWorkshopLikedTrackResult>;
    toggleAlbumLiked(albumId: string): Promise<EchoWorkshopLikedAlbumResult>;
    createPlaylist(input: { name: string; description?: string }): Promise<EchoWorkshopPlaylist>;
    addTracksToPlaylist(playlistId: string, trackIds: string[]): Promise<EchoWorkshopPlaylistItem[]>;
  };
  queue: {
    get(): Promise<EchoWorkshopQueueSnapshot>;
    playTrack(trackId: string, queueTrackIds?: string[]): Promise<EchoWorkshopTrackActionResult>;
    enqueueTrack(trackId: string): Promise<EchoWorkshopTrackActionResult>;
    playItem(queueId: string): Promise<null>;
    moveItem(queueId: string, toIndex: number): Promise<null>;
    removeItem(queueId: string): Promise<null>;
    clear(): Promise<null>;
    playAlbum(albumId: string): Promise<EchoWorkshopCollectionPlayResult>;
    playArtist(artistId: string): Promise<EchoWorkshopCollectionPlayResult>;
    playGenre(genreId: string): Promise<EchoWorkshopCollectionPlayResult>;
    playPlaylist(playlistId: string): Promise<EchoWorkshopCollectionPlayResult>;
    playLiked(): Promise<EchoWorkshopCollectionPlayResult>;
  };
  sources: {
    playDirect(source: EchoWorkshopDirectSource): Promise<EchoWorkshopTrackActionResult>;
    enqueueDirect(source: EchoWorkshopDirectSource): Promise<EchoWorkshopTrackActionResult>;
    playQueue(sources: EchoWorkshopDirectSource[]): Promise<EchoWorkshopTracksActionResult>;
    registerProvider(id: string, metadata: { title: string }, handlers: EchoWorkshopSourceProviderHandlers): void;
    search(providerId: string, request: Partial<EchoWorkshopSourceSearchRequest>): Promise<EchoWorkshopSourceSearchResult>;
    browse(providerId: string, request?: EchoWorkshopSourceBrowseRequest): Promise<EchoWorkshopSourceSearchResult>;
    listCollection(providerId: string, collectionId: string, request?: EchoWorkshopSourceBrowseRequest): Promise<EchoWorkshopSourceSearchResult>;
    resolve(providerId: string, providerTrackId: string): Promise<EchoWorkshopDirectSource>;
  };
  agents: {
    register(id: string, metadata: { title: string }, handler: (input: unknown, context: { agentId: string }) => unknown | Promise<unknown>): void;
    run(agentId: string, input: unknown): Promise<unknown>;
  };
  network: {
    request(options: EchoWorkshopNetworkRequest): Promise<EchoWorkshopNetworkResponse>;
    get(url: string, options?: Omit<EchoWorkshopNetworkRequest, 'url' | 'method' | 'body'>): Promise<EchoWorkshopNetworkResponse>;
    post(url: string, body: string, options?: Omit<EchoWorkshopNetworkRequest, 'url' | 'method' | 'body'>): Promise<EchoWorkshopNetworkResponse>;
  };
  lyrics: {
    registerProvider(id: string, metadata: { title: string }, handler: (request: EchoWorkshopLyricsRequest) => { candidates: EchoWorkshopLyricsCandidate[] } | Promise<{ candidates: EchoWorkshopLyricsCandidate[] }>): void;
    get(trackId?: string): Promise<EchoWorkshopSandboxLyrics | null>;
  };
  metadata: {
    registerProvider(id: string, metadata: { title: string }, handler: (request: { track: EchoWorkshopTrack }) => { candidates: EchoWorkshopMetadataCandidate[] } | Promise<{ candidates: EchoWorkshopMetadataCandidate[] }>): void;
  };
  covers: {
    registerProvider(id: string, metadata: { title: string }, handler: (request: { track: EchoWorkshopTrack }) => { candidates: EchoWorkshopCoverCandidate[] } | Promise<{ candidates: EchoWorkshopCoverCandidate[] }>): void;
  };
  settings: {
    get(): Promise<Record<string, string | number | boolean | null>>;
    get(settingId: string): Promise<string | number | boolean | null>;
    set(settingId: string, value: string | number | boolean | null): Promise<Record<string, string | number | boolean | null>>;
    onChanged(handler: (values: Record<string, string | number | boolean | null>) => unknown): EchoWorkshopUnsubscribe;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<null>;
    remove(key: string): Promise<null>;
  };
  files: {
    /** Opens a host save dialog; the plug-in never receives the selected local path. */
    export(options: { suggestedName: string; mimeType: string; dataBase64: string }): Promise<EchoWorkshopFileExportResult>;
  };
  trusted: {
    /**
     * Calls the package's trustedEntry in a separate ECHO utility process.
     * Requires system:full approval. The trusted module has normal Node.js system access.
     */
    invoke<TResult = unknown>(method: string, input?: unknown): Promise<TResult>;
  };
  ui: {
    notify(message: string): Promise<null>;
    /** Returns a sanitized responsive/theme context for this runtime or visible panel. */
    getContext(): Promise<EchoWorkshopUiContext>;
    /** Updates only the host-owned shell around the current panel. Background runtimes are rejected. */
    setPanelPresentation(presentation: Partial<EchoWorkshopPanelPresentation>): Promise<EchoWorkshopPanelPresentation>;
    /**
     * Opens one of this plug-in's declared panels. Background runtimes may call this so
     * `playerBarActions` and dock commands can show a panel. Pass a panel id to open it
     * immediately. Omit the id to let the host choose: one visible panel opens directly,
     * several panels show a host-owned chooser. Returns the opened panel, or `null` if the
     * user dismissed the chooser. Unknown ids reject with `panel-undeclared`.
     */
    openPanel(panelId?: string): Promise<{ id: string; title: string } | null>;
    /** Closes the current visible panel. Background runtimes are rejected. */
    closePanel(): Promise<null>;
    /** Fires when theme, locale, visibility, viewport, or host-owned presentation changes. */
    onContextChanged(handler: (context: EchoWorkshopUiContext) => unknown): EchoWorkshopUnsubscribe;
  };
}

declare const echo: EchoWorkshopApi;
