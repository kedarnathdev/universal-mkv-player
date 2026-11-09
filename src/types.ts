// Shared types for the MKV player

export interface AudioTrackInfo {
  id: number;
  number: number;
  language: string;
  languageCode: string;
  codec: string | null;
  channels: number;
  sampleRate: number;
  bitrate: number | null;
  name: string | null;
  isDefault: boolean;
  canDecode: boolean;
}

export interface VideoTrackInfo {
  id: number;
  codec: string | null;
  width: number;
  height: number;
  frameRate: number | null;
  bitrate: number | null;
  hdr: boolean;
}

export interface SubtitleTrackInfo {
  id: string; // 'embedded-{n}' or 'external-{url}' or 'local-{name}'
  source: 'embedded' | 'external' | 'local';
  language: string;
  languageCode: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'unknown';
  name: string | null;
}

export interface MediaInfo {
  format: string;
  fileSize: number | null;
  duration: number | null;
  videoTrack: VideoTrackInfo | null;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
}

export interface SubtitleCue {
  start: number; // seconds
  end: number;   // seconds
  text: string;
  style?: SubtitleStyle;
}

export interface SubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  position?: 'bottom' | 'top';
  outline?: boolean;
  shadow?: boolean;
}

export interface PlayerSettings {
  volume: number;
  muted: boolean;
  playbackRate: number;
  subtitleStyle: SubtitleStyle;
  subtitleDelay: number; // seconds offset
}

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerState {
  status: PlayerStatus;
  currentTime: number;
  duration: number | null;
  buffered: TimeRange[];
  mediaInfo: MediaInfo | null;
  activeAudioTrackId: number | null;
  activeSubtitleTrackId: string | null;
  error: string | null;
  settings: PlayerSettings;
}

export interface TimeRange {
  start: number;
  end: number;
}
