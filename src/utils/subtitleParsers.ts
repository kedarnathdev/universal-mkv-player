import { SubtitleCue } from '../types';
import { parseSrtTime, parseVttTime } from './helpers';

/** Parse SRT subtitle text into cue objects */
export function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // Find the timing line
    let timingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(' --> ')) {
        timingIdx = i;
        break;
      }
    }
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx];
    const match = timingLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match) continue;

    const start = parseSrtTime(match[1]);
    const end = parseSrtTime(match[2]);
    const text = lines.slice(timingIdx + 1).join('\n').replace(/<[^>]+>/g, '').trim();

    if (text) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/** Parse WebVTT subtitle text into cue objects */
export function parseVtt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (!normalized.startsWith('WEBVTT')) return cues;

  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timingIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(' --> ')) {
        timingIdx = i;
        break;
      }
    }
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx];
    // VTT can have positioning info after the timestamps, strip it
    const timingPart = timingLine.split(/\s+(?:line|position|size|align):/)[0];
    const match = timingPart.match(/([\d:]+\.[\d]+)\s+-->\s+([\d:]+\.[\d]+)/);
    if (!match) continue;

    const start = parseVttTime(match[1]);
    const end = parseVttTime(match[2]);
    const textLines = lines.slice(timingIdx + 1);
    const text = textLines.join('\n').replace(/<[^>]+>/g, '').trim();

    if (text) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

/** Basic ASS/SSA parser - extracts text from [Events] section */
export function parseAss(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let inEvents = false;
  let formatLine: string[] = [];

  for (const line of lines) {
    if (line.trim() === '[Events]') {
      inEvents = true;
      continue;
    }
    if (line.startsWith('[') && inEvents) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;

    if (line.startsWith('Format:')) {
      formatLine = line.slice(7).split(',').map(s => s.trim().toLowerCase());
      continue;
    }

    if (line.startsWith('Dialogue:')) {
      const values = line.slice(9).split(',');
      if (formatLine.length === 0) continue;

      const startIdx = formatLine.indexOf('start');
      const endIdx = formatLine.indexOf('end');
      const textIdx = formatLine.indexOf('text');

      if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

      // Text may contain commas, so join remaining parts
      const textPart = values.slice(textIdx).join(',');
      const start = parseAssTime(values[startIdx]?.trim() ?? '');
      const end = parseAssTime(values[endIdx]?.trim() ?? '');

      // Strip ASS override tags like {\an8} {\pos(x,y)} etc.
      const plainText = textPart.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();

      if (plainText && start >= 0 && end > start) {
        cues.push({ start, end, text: plainText });
      }
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

/** Parse ASS time "H:MM:SS.cc" → seconds */
function parseAssTime(ts: string): number {
  const match = ts.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
}

/** Determine format from content and parse */
export function parseSubtitles(content: string, format: string): SubtitleCue[] {
  if (format === 'srt') return parseSrt(content);
  if (format === 'vtt') return parseVtt(content);
  if (format === 'ass' || format === 'ssa') return parseAss(content);
  // Try to auto-detect
  if (content.startsWith('WEBVTT')) return parseVtt(content);
  if (content.includes('[Events]')) return parseAss(content);
  return parseSrt(content);
}
