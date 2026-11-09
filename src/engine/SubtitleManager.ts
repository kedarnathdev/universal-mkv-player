/**
 * Subtitle manager - handles embedded and external subtitle tracks,
 * fetching, parsing, and providing current active cues for rendering.
 */

import { SubtitleCue, SubtitleTrackInfo } from '../types';
import { parseSubtitles } from '../utils/subtitleParsers';
import { detectSubtitleFormat } from '../utils/helpers';

export class SubtitleManager {
  private tracks: Map<string, SubtitleTrackInfo> = new Map();
  private cues: Map<string, SubtitleCue[]> = new Map();
  private activeTrackId: string | null = null;

  /** Add a parsed embedded subtitle track */
  addEmbeddedTrack(info: SubtitleTrackInfo, cueList: SubtitleCue[]): void {
    this.tracks.set(info.id, info);
    this.cues.set(info.id, cueList);
  }

  /** Fetch and parse an external subtitle URL */
  async loadExternalUrl(url: string): Promise<SubtitleTrackInfo | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const filename = new URL(url).pathname.split('/').pop() ?? 'subtitle';
      const format = detectSubtitleFormat(filename);
      const cueList = parseSubtitles(text, format);

      const id = `external-${encodeURIComponent(url)}`;
      const info: SubtitleTrackInfo = {
        id,
        source: 'external',
        language: 'Unknown',
        languageCode: 'und',
        format,
        name: filename,
      };
      this.tracks.set(id, info);
      this.cues.set(id, cueList);
      return info;
    } catch (err) {
      console.error('Failed to load subtitle URL:', err);
      return null;
    }
  }

  /** Load a local File dropped/selected by the user */
  async loadLocalFile(file: File): Promise<SubtitleTrackInfo | null> {
    try {
      const text = await file.text();
      const format = detectSubtitleFormat(file.name);
      const cueList = parseSubtitles(text, format);

      const id = `local-${file.name}-${Date.now()}`;
      const info: SubtitleTrackInfo = {
        id,
        source: 'local',
        language: 'Unknown',
        languageCode: 'und',
        format,
        name: file.name,
      };
      this.tracks.set(id, info);
      this.cues.set(id, cueList);
      return info;
    } catch (err) {
      console.error('Failed to load subtitle file:', err);
      return null;
    }
  }

  setActiveTrack(id: string | null): void {
    this.activeTrackId = id;
  }

  getActiveTrackId(): string | null {
    return this.activeTrackId;
  }

  getAllTracks(): SubtitleTrackInfo[] {
    return Array.from(this.tracks.values());
  }

  /** Get cues active at the given time (with optional delay offset) */
  getActiveCues(time: number, delay = 0): SubtitleCue[] {
    if (!this.activeTrackId) return [];
    const cueList = this.cues.get(this.activeTrackId);
    if (!cueList) return [];
    const adjusted = time - delay;
    return cueList.filter(c => c.start <= adjusted && c.end > adjusted);
  }

  clear(): void {
    this.tracks.clear();
    this.cues.clear();
    this.activeTrackId = null;
  }
}
