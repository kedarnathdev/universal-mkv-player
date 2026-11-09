/**
 * URL validation for video sources.
 * Blocks private/local addresses to prevent SSRF when a backend proxy is used.
 */

const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/0\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,
  /^https?:\/\/\[::1\]/,
  /^https?:\/\/\[fc/i,
  /^https?:\/\/\[fd/i,
  /^https?:\/\/metadata\.google\.internal/i,
  /^https?:\/\/169\.254\.169\.254/,
];

export function validateVideoUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP and HTTPS URLs are supported.' };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(url)) {
      return { valid: false, error: 'Private/local network URLs are not allowed.' };
    }
  }

  return { valid: true };
}

export function detectSubtitleFormat(filename: string): 'srt' | 'vtt' | 'ass' | 'ssa' | 'unknown' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'srt') return 'srt';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'ass') return 'ass';
  if (ext === 'ssa') return 'ssa';
  return 'unknown';
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatBitrate(bps: number | null): string {
  if (bps === null) return 'Unknown';
  if (bps < 1000) return `${bps} bps`;
  if (bps < 1000000) return `${(bps / 1000).toFixed(0)} kbps`;
  return `${(bps / 1000000).toFixed(1)} Mbps`;
}

export function getLanguageName(code: string): string {
  const ISO_NAMES: Record<string, string> = {
    und: 'Unknown', eng: 'English', jpn: 'Japanese', spa: 'Spanish',
    fra: 'French', deu: 'German', zho: 'Chinese', kor: 'Korean',
    por: 'Portuguese', ita: 'Italian', rus: 'Russian', ara: 'Arabic',
    hin: 'Hindi', tel: 'Telugu', tam: 'Tamil', ben: 'Bengali',
    pol: 'Polish', nld: 'Dutch', swe: 'Swedish', nor: 'Norwegian',
    dan: 'Danish', fin: 'Finnish', hun: 'Hungarian', ces: 'Czech',
    slk: 'Slovak', ron: 'Romanian', bul: 'Bulgarian', hrv: 'Croatian',
    srp: 'Serbian', ukr: 'Ukrainian', heb: 'Hebrew', tur: 'Turkish',
    vie: 'Vietnamese', tha: 'Thai', ind: 'Indonesian', msa: 'Malay',
    cmn: 'Mandarin', yue: 'Cantonese',
  };
  // Also try 2-letter codes
  const TWO_LETTER: Record<string, string> = {
    en: 'English', ja: 'Japanese', es: 'Spanish', fr: 'French',
    de: 'German', zh: 'Chinese', ko: 'Korean', pt: 'Portuguese',
    it: 'Italian', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  };
  return ISO_NAMES[code] ?? TWO_LETTER[code] ?? code.toUpperCase();
}

export function formatChannels(ch: number): string {
  if (ch === 1) return 'Mono';
  if (ch === 2) return 'Stereo';
  if (ch === 6) return '5.1';
  if (ch === 8) return '7.1';
  return `${ch}ch`;
}

export function getCodecDisplayName(codec: string | null): string {
  if (!codec) return 'Unknown';
  const names: Record<string, string> = {
    avc: 'H.264/AVC', hevc: 'H.265/HEVC', vp8: 'VP8', vp9: 'VP9',
    av1: 'AV1', prores: 'ProRes',
    aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis',
    flac: 'FLAC', ac3: 'AC-3 (Dolby Digital)', eac3: 'E-AC-3 (Dolby Digital+)',
    dts: 'DTS', truehd: 'Dolby TrueHD',
  };
  return names[codec] ?? codec.toUpperCase();
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Convert SRT timestamp "00:01:23,456" → seconds */
export function parseSrtTime(ts: string): number {
  const [h, m, rest] = ts.split(':');
  const [s, ms] = rest.split(',');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

/** Convert VTT timestamp "00:01:23.456" → seconds */
export function parseVttTime(ts: string): number {
  const parts = ts.split(':');
  if (parts.length === 2) {
    const [m, rest] = parts;
    const [s, ms] = rest.split('.');
    return parseInt(m) * 60 + parseInt(s) + parseInt(ms || '0') / 1000;
  }
  const [h, m, rest] = parts;
  const [s, ms] = rest.split('.');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms || '0') / 1000;
}
