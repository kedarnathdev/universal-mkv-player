# Universal Web-Based MKV Streaming Player

A modern, responsive, self-hostable web video player with first-class support for Matroska (MKV) containers and runtime switching between embedded audio tracks and subtitles without restarting playback or losing playback position.

---

## Key Features

1. **Direct HTTPS Video Streaming**
   - Progressive streaming via HTTP Range requests (`206 Partial Content`)
   - No file pre-download required
   - Private network & SSRF protection built-in

2. **MKV Embedded Multi-Audio Track Switching**
   - Discovers all embedded audio tracks and exposes metadata: track number, language, codec, channel layout, and default flag
   - Switches audio streams during active playback without restarting or pausing video
   - Audio and video remain synchronized using hardware-accelerated WebCodecs and Web Audio API
   - Non-decodable codecs are flagged gracefully

3. **Subtitles Support**
   - Embedded and external subtitles (SRT, WebVTT, ASS/SSA)
   - Dynamic switching and disabling during playback
   - Local subtitle file loading (`.srt`, `.vtt`, `.ass`, `.ssa`)
   - Full style customization: font size, font color, background opacity, outline, shadow, vertical position, and ±30s delay offset

4. **Netflix-Inspired Player UI**
   - Smooth seek bar with live scrub and buffering indicator
   - Volume and mute control with memory
   - Playback rate selector: `0.25×` to `2.0×`
   - Technical Media Information overlay (container, video codec, resolution, fps, bitrate, audio channels, decodability)
   - Fullscreen and Picture-in-Picture (PiP)
   - Keyboard shortcuts: `Space`/`k` (play/pause), `←`/`→` (seek ±10s), `↑`/`↓` (volume), `m` (mute), `f` (fullscreen), `i` (info overlay)

---

## Architecture

```
HTTPS Source URL (Range Requests)
             │
             ▼
     mediabunny Demuxer
       (UrlSource + Input)
             │
      ┌──────┴──────────────┐
      ▼                     ▼
 Video Track           Audio Tracks (All discovered)
      │                     │
EncodedPacketSink     EncodedPacketSink (Active track only)
      │                     │
 VideoDecoder          AudioDecoder  (WebCodecs API)
      │                     │
  VideoFrame            AudioData
      │                     │
   <canvas>           Web Audio API AudioContext
                            │
                       Audio Output
```

- **Audio Track Switching:** Only the audio `EncodedPacketSink` and `AudioDecoder` are swapped at `currentTime`. The video decode pipeline and canvas rendering loop continue uninterrupted.
- Detailed architecture rationale is documented in [`ADR.md`](../ADR.md).

---

## Local Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run unit tests
npx -y tsx test/player.test.ts

# Build production bundle
npm run build

# Preview production build
npm run preview
```

---

## Docker Deployment (Self-Hosted)

### Using Docker Compose

```bash
docker compose up -d --build
```

Access the player at `http://localhost:8080`.

### Using Docker CLI

```bash
docker build -t mkv-player .
docker run -d -p 8080:80 --name mkv-player mkv-player
```

---

## Verification & Test Results

Run the unit test suite:
```bash
npx -y tsx test/player.test.ts
```

All 29 tests verify:
- Time formatting (`0:00`, `1:05`, `1:01:05`)
- File size calculations
- ISO 639 language code resolution (e.g., `eng` → English, `jpn` → Japanese, `tel` → Telugu)
- SSRF prevention (blocking localhost, `127.0.0.1`, `10.x`, `192.168.x`, `169.254.169.254`)
- SRT cue parsing and timestamp conversion
- WebVTT cue parsing and position tag sanitization
- ASS/SSA dialogue parsing, style tag removal, and `\N` newline conversion
