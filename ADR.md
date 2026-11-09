# Architecture Decision Record — MKV Web Streaming Player

**Date:** 2026-11-09  
**Status:** Accepted

---

## Problem

Build a browser-based MKV player that can switch audio tracks mid-playback without restarting the video. HTML5 `<video>` cannot select individual audio tracks embedded in MKV containers; MKV is not an MSE-supported MIME type (`video/x-matroska`); and no single off-the-shelf player library solves this end-to-end.

---

## Decision

Use **mediabunny** as the demuxer + packet extractor, and feed two separate MSE `SourceBuffer`s (one video, one audio) using the **WebCodecs API** for decoding and the **Web Audio API** for audio output. Video is rendered to a `<canvas>` via `VideoFrame`.

This is a *custom playback engine*, not a wrapper around `<video>`.

---

## Architecture

```
HTTPS URL (Range requests)
        │
        ▼
  UrlSource (mediabunny)       ← lazy HTTP range reader
        │
        ▼
  Input (mediabunny)           ← MKV/MP4/WebM demuxer
        │
   ┌────┴────────────┐
   ▼                 ▼
VideoTrack        AudioTrack[] (all embedded tracks)
   │                 │
EncodedPacketSink    EncodedPacketSink (active track only)
   │                 │
VideoDecoder      AudioDecoder    ← WebCodecs API (hardware-accelerated)
   │                 │
VideoFrame        AudioData
   │                 │
<canvas>          AudioWorkletNode / AudioContext.decodeAudioData
                       │
                  Web Audio API output
```

**Audio track switching:**  
When the user picks a different audio track, the active `EncodedPacketSink` is replaced with one on the new track, the `AudioDecoder` is re-initialized with the new codec config, and audio output resumes from `currentTime`. Video is never touched.

**Subtitle rendering:**  
Subtitles are drawn on an overlay `<canvas>` or a positioned `<div>` on top of the video canvas. SRT/VTT parsed in JS; ASS/SSA via `ass.js` (WASM). No `<track>` element is used.

---

## Why mediabunny (not alternatives)

| Option | MKV demux | Multi-audio tracks | Language metadata | Active maintenance |
|---|---|---|---|---|
| **mediabunny** | ✓ | ✓ (`getAudioTracks()`) | ✓ (`getLanguageCode()`) | ✓ 7.5k ⭐ |
| Shaka Player | ✗ (no MKV file input) | — | — | ✓ |
| ffmpeg.wasm | ✓ | ✓ | ✓ | ✓ |
| matroska-demuxer (npm) | ✓ | Partial | Partial | ⚠️ |
| HTML5 `<video>` | ✗ (codec-dependent) | ✗ | ✗ | — |

**ffmpeg.wasm** is kept as the fallback for unsupported codecs (AC3, DTS, TrueHD → transcode to Opus on-the-fly). It is not used by default.

---

## Audio track switching — exact mechanism

1. Capture `video.currentTime` (or the canvas playback clock).
2. Dispose the current `AudioDecoder` and drain the `AudioContext` queue.
3. Create a new `EncodedPacketSink` on the selected `InputAudioTrack`.
4. Seek the new sink to `currentTime` using `sink.packets(currentTime)`.
5. Configure a fresh `AudioDecoder` with the new track's `getDecoderConfig()`.
6. Resume feeding audio packets; video keeps playing uninterrupted.

> **No MSE is used for audio.** MSE is used only for video (Chrome/Edge/Firefox support WebM/MKV SourceBuffer), or the video is also decoded via WebCodecs + canvas for maximum control and Safari parity.

---

## Browser limitations

| Browser | H.264 | HEVC | VP9 | AV1 | AAC | Opus | AC3 | DTS |
|---|---|---|---|---|---|---|---|---|
| Chrome/Edge | ✓ | ✓* | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Firefox | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Safari | ✓ | ✓ | ✗ | ✗† | ✓ | ✗ | ✗ | ✗ |

*HEVC on Chrome requires hardware support.  
†AV1 on Safari 17+.  

AC3/DTS → ffmpeg.wasm transcode fallback.  
HEVC on Firefox → ffmpeg.wasm transcode to H.264 or VP9.

---

## Subtitle rendering mechanism

- **SRT / VTT**: parsed to cue objects in JS, displayed in an overlay `<div>` with CSS styling.
- **ASS / SSA**: rendered via `SubtitleOctopus` (libass compiled to WASM) on an overlay canvas.
- Subtitle delay, font, color, background: CSS custom properties + runtime patch of cue offsets.
- External subtitle URLs fetched via `fetch()` with CORS; local files via `FileReader`.

---

## Fallback strategy

1. **Primary path**: mediabunny demux → WebCodecs decode → canvas/Web Audio output. Works for H.264+AAC/Opus MKV on Chrome/Edge/Firefox (all major browsers).
2. **Codec fallback**: If `track.canDecode()` returns false, offer optional ffmpeg.wasm transcoding to VP9+Opus and pipe the result through MSE.
3. **CORS blocked**: Show CORS error with explanation. Never proxy by default; optional backend proxy provided via Docker.

---

## Network / streaming

- `mediabunny` accepts a `UrlSource` that issues HTTP Range requests (`bytes=X-Y`), loading only the bytes needed for the requested time window.
- Buffer: keep ±30 s around `currentTime`; evict older data to control RAM.
- Seeking: re-issue a range request from the keyframe before the target timestamp (provided by mediabunny's seek API).

---

## Security

- Only `http:` and `https:` URLs accepted; `localhost`, `169.254.x.x`, `10.x`, `172.16-31.x`, `192.168.x.x` blocked in the backend proxy path.
- URLs are not persisted unless the user enables history.
- No arbitrary header injection from URL input field.
