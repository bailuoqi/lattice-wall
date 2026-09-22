/** ECHO Workshop native-shell protocol v1. See contracts/native-shell.json. */

export type EchoNativeShellOp = 'config' | 'status' | 'quit' | 'ready' | 'log' | 'command';

export type EchoNativeShellCommand =
  | 'focusEcho'
  | 'toggle'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'seekRatio'
  | 'openLyrics'
  | 'setOffset';

export interface EchoNativeShellMessage<T = unknown> {
  v: 1;
  op: EchoNativeShellOp;
  payload?: T;
}

export interface EchoNativeShellStatus {
  state: string;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  positionSeconds: number;
  durationSeconds: number;
  trackKey: string;
  officialEnabled: boolean;
  suppressed: boolean;
  lyricsCurrent: string;
  lyricsNext: string;
  lyricsHas: boolean;
  lyricsInstrumental: boolean;
}

export interface EchoNativeShellCommandPayload {
  action: EchoNativeShellCommand;
  ratio?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface EchoNativeShellLogPayload {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export type EchoNativeShellPermission =
  | 'process:spawn'
  | 'ipc:named-pipe'
  | 'shell:taskbar'
  | 'cover:original'
  | 'window:focus'
  | 'playback:read'
  | 'playback:control'
  | 'lyrics:read';

export interface EchoNativeShellEntry {
  type: 'echo-workshop-native-shell';
  schemaVersion: 1;
  id: string;
  title: string;
  protocolVersion: 1;
  platforms: ['win32'];
  exe: string;
  renderer?: string;
  config?: string;
  configSchema?: string;
  configUi?: string;
  icon?: string;
  permissions: EchoNativeShellPermission[];
}
