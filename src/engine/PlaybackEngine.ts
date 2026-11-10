/**
 * MKV Playback Engine
 *
 * Fullest browser capability architecture:
 * 1. Hybrid playback pipeline:
 *    - HTML5 <video> hardware pipeline whenever the browser natively supports the stream (WebM/MP4, VP8/VP9/AV1/H.264/AAC).
 *    - WebCodecs (VideoDecoder + AudioDecoder) demuxed via mediabunny with <canvas> + Web Audio API when WebCodecs is available.
 *    - Safe fallback when AudioDecoder or VideoDecoder is undefined: safe feature checks prevent runtime crashes,
 *      allowing video-only decode or falling back to the browser's hardware video element.
 * 2. Multi-Audio Track Switching:
 *    - In WebCodecs mode: swaps the active EncodedPacketSink and AudioDecoder at currentTime without restarting video.
 *    - In Native Video mode: uses videoElement.audioTracks when available, or swaps tracks cleanly with timestamp preservation.
 */

import {
  Input,
  ALL_FORMATS,
  UrlSource,
  EncodedPacketSink,
  type InputVideoTrack,
  type InputAudioTrack,
  type EncodedPacket,
} from 'mediabunny';
import { AudioTrackInfo, MediaInfo, VideoTrackInfo } from '../types';
import { getCodecDisplayName, getLanguageName, formatChannels } from '../utils/helpers';

export type EngineEvent =
  | { type: 'ready'; mediaInfo: MediaInfo }
  | { type: 'timeupdate'; currentTime: number; duration: number | null }
  | { type: 'buffering'; value: boolean }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  | { type: 'audiotrack-switched'; trackId: number }
  | { type: 'frame'; frame: VideoFrame }
  | { type: 'seek-complete'; time: number };

export type EngineEventHandler = (event: EngineEvent) => void;

const BUFFER_AHEAD_SECONDS = 15;

export class PlaybackEngine {
  private url: string;
  private canvas: HTMLCanvasElement;
  private videoEl: HTMLVideoElement | null = null;
  private onEvent: EngineEventHandler;

  // Pipeline mode: 'webcodecs' or 'native'
  private mode: 'webcodecs' | 'native' = 'webcodecs';

  private input: Input | null = null;
  private videoTrack: InputVideoTrack | null = null;
  private audioTrackList: InputAudioTrack[] = [];
  private activeAudioTrack: InputAudioTrack | null = null;
  private activeAudioTrackId = -1;

  private videoDecoder: VideoDecoder | null = null;
  private audioDecoder: AudioDecoder | null = null;
  private audioContext: AudioContext | null = null;

  private videoSink: EncodedPacketSink | null = null;
  private audioSink: EncodedPacketSink | null = null;

  // Timing state
  private playbackStartTime = 0;
  private playbackMediaStart = 0;
  private currentTime = 0;
  private duration: number | null = null;
  private isPlaying = false;
  private isSeeking = false;
  private isAudioSwitching = false;

  // Frame queue for canvas rendering
  private pendingFrames: VideoFrame[] = [];
  private rafId: number | null = null;

  // Audio output queue
  private scheduledAudioEnd = 0;
  private audioQueue: { buffer: AudioBuffer; mediaTime: number }[] = [];

  private destroyed = false;

  constructor(
    url: string,
    canvas: HTMLCanvasElement,
    videoEl: HTMLVideoElement | null,
    onEvent: EngineEventHandler
  ) {
    this.url = url;
    this.canvas = canvas;
    this.videoEl = videoEl;
    this.onEvent = onEvent;
  }

  async initialize(): Promise<void> {
    try {
      this.onEvent({ type: 'buffering', value: true });

      // Check browser environment capabilities
      const hasVideoDecoder = typeof globalThis.VideoDecoder !== 'undefined';
      const hasAudioDecoder = typeof globalThis.AudioDecoder !== 'undefined';

      // 1. Demux container using mediabunny over Range requests
      let demuxSuccess = false;
      try {
        const source = new UrlSource(this.url);
        this.input = new Input({ formats: ALL_FORMATS, source });
        demuxSuccess = await this.input.canRead();
      } catch (e) {
        console.warn('mediabunny demux check failed:', e);
      }

      if (demuxSuccess && this.input) {
        const format = await this.input.getFormat();
        const duration = await this.input.getDurationFromMetadata();
        this.duration = duration;

        const videoTracks = await this.input.getVideoTracks();
        const audioTracks = await this.input.getAudioTracks();
        this.audioTrackList = audioTracks;

        let videoInfo: VideoTrackInfo | null = null;
        if (videoTracks.length > 0) {
          this.videoTrack = videoTracks[0];
          const codec = await this.videoTrack.getCodec();
          const w = await this.videoTrack.getDisplayWidth();
          const h = await this.videoTrack.getDisplayHeight();
          const frMetrics = await this.videoTrack.computeFrameRateMetrics().catch(() => null);
          const bitrate = await this.videoTrack.getBitrate();
          const hdr = await this.videoTrack.hasHighDynamicRange();
          videoInfo = {
            id: this.videoTrack.id,
            codec,
            width: w,
            height: h,
            frameRate: frMetrics?.bestGuessFrameRate ?? null,
            bitrate,
            hdr,
          };
        }

        const audioInfos: AudioTrackInfo[] = await Promise.all(
          audioTracks.map(async (t, i) => {
            const codec = await t.getCodec();
            const lang = await t.getLanguageCode();
            const name = await t.getName();
            const ch = await t.getNumberOfChannels();
            const sr = await t.getSampleRate();
            const bitrate = await t.getBitrate();
            const disp = await t.getDisposition();
            // Safe canDecode check: avoid throwing if AudioDecoder is undefined
            let canDec = false;
            try {
              if (hasAudioDecoder) {
                canDec = await t.canDecode();
              }
            } catch {
              canDec = false;
            }
            return {
              id: t.id,
              number: i + 1,
              language: getLanguageName(lang),
              languageCode: lang,
              codec,
              channels: ch,
              sampleRate: sr,
              bitrate,
              name,
              isDefault: disp?.default ?? (i === 0),
              canDecode: canDec,
            };
          })
        );

        const mediaInfo: MediaInfo = {
          format: format?.constructor.name.replace('InputFormat', '') ?? 'MKV',
          fileSize: null,
          duration,
          videoTrack: videoInfo,
          audioTracks: audioInfos,
          subtitleTracks: [],
        };

        this.onEvent({ type: 'ready', mediaInfo });

        // Decide pipeline mode:
        // If the browser supports WebCodecs (VideoDecoder), use WebCodecs for pixel-perfect canvas rendering.
        // Otherwise, fall back to native <video> pipeline.
        if (hasVideoDecoder && this.videoTrack) {
          this.mode = 'webcodecs';
          await this.initVideoDecoder(this.videoTrack);

          // Initialize audio decoder if AudioDecoder is available
          const defaultTrack =
            audioTracks.find((_, i) => audioInfos[i].isDefault && audioInfos[i].canDecode) ??
            audioTracks.find((_, i) => audioInfos[i].canDecode) ??
            audioTracks[0];

          if (defaultTrack && hasAudioDecoder) {
            await this.initAudioDecoder(defaultTrack);
          } else if (!hasAudioDecoder) {
            console.info('AudioDecoder not available in this browser/context; running video-only decode or native fallback.');
          }
        } else if (this.videoEl) {
          // Native HTML5 fallback
          this.initNativeVideoPipeline();
        } else {
          throw new Error('VideoDecoder is not supported in this browser environment, and native video fallback is unavailable.');
        }

      } else if (this.videoEl) {
        // Fallback directly to native video element if demuxer failed (e.g., standard MP4/WebM)
        this.initNativeVideoPipeline();
      } else {
        throw new Error('Cannot read media: unsupported format or inaccessible URL.');
      }

    } catch (err) {
      this.onEvent({ type: 'error', message: (err as Error).message });
    }
  }

  /** Native HTML5 <video> element pipeline */
  private initNativeVideoPipeline(): void {
    if (!this.videoEl) return;
    this.mode = 'native';

    this.videoEl.src = this.url;
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.preload = 'metadata';

    this.videoEl.onloadedmetadata = () => {
      this.duration = this.videoEl?.duration ?? null;
      const mediaInfo: MediaInfo = {
        format: 'Video Stream',
        fileSize: null,
        duration: this.duration,
        videoTrack: {
          id: 1,
          codec: 'Native Decoder',
          width: this.videoEl?.videoWidth ?? 0,
          height: this.videoEl?.videoHeight ?? 0,
          frameRate: null,
          bitrate: null,
          hdr: false,
        },
        audioTracks: [{
          id: 1,
          number: 1,
          language: 'Default',
          languageCode: 'und',
          codec: 'Native Audio',
          channels: 2,
          sampleRate: 48000,
          bitrate: null,
          name: 'Stereo',
          isDefault: true,
          canDecode: true,
        }],
        subtitleTracks: [],
      };
      this.onEvent({ type: 'ready', mediaInfo });
    };

    this.videoEl.ontimeupdate = () => {
      if (this.videoEl) {
        this.currentTime = this.videoEl.currentTime;
        this.onEvent({
          type: 'timeupdate',
          currentTime: this.currentTime,
          duration: this.duration,
        });
      }
    };

    this.videoEl.onplay = () => this.onEvent({ type: 'playing' });
    this.videoEl.onpause = () => this.onEvent({ type: 'paused' });
    this.videoEl.onwaiting = () => this.onEvent({ type: 'buffering', value: true });
    this.videoEl.onplaying = () => this.onEvent({ type: 'buffering', value: false });
    this.videoEl.onended = () => this.onEvent({ type: 'ended' });
    this.videoEl.onerror = () => {
      const err = this.videoEl?.error;
      this.onEvent({
        type: 'error',
        message: err?.message || 'Browser video playback error.',
      });
    };
  }

  private async initVideoDecoder(track: InputVideoTrack): Promise<void> {
    if (typeof globalThis.VideoDecoder === 'undefined') return;

    const config = await track.getDecoderConfig();
    if (!config) {
      console.warn(`No decoder config for video track ${track.id}`);
      return;
    }

    try {
      const support = await VideoDecoder.isConfigSupported(config);
      if (!support.supported) {
        console.warn(`Video codec ${getCodecDisplayName(await track.getCodec())} not supported via WebCodecs.`);
        return;
      }

      this.videoDecoder = new VideoDecoder({
        output: (frame) => {
          if (this.destroyed) { frame.close(); return; }
          this.pendingFrames.push(frame);
        },
        error: (err) => {
          if (!this.destroyed) this.onEvent({ type: 'error', message: `Video decode error: ${err.message}` });
        },
      });
      this.videoDecoder.configure(config);
    } catch (e) {
      console.warn('VideoDecoder configuration failed:', e);
    }
  }

  private async initAudioDecoder(track: InputAudioTrack): Promise<void> {
    this.closeAudioDecoder();

    // Guard against AudioDecoder is not defined (e.g. older Safari or insecure context)
    if (typeof globalThis.AudioDecoder === 'undefined') {
      console.info('AudioDecoder is not defined in this browser; skipping WebCodecs AudioDecoder.');
      return;
    }

    const config = await track.getDecoderConfig();
    if (!config) {
      console.warn(`No decoder config for audio track ${track.id}`);
      return;
    }

    try {
      const support = await AudioDecoder.isConfigSupported(config);
      if (!support.supported) {
        console.warn(`Audio codec not supported: ${await track.getCodec()}`);
        return;
      }

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.audioContext && AudioCtxClass) {
        this.audioContext = new AudioCtxClass();
      }

      const ctx = this.audioContext;
      if (!ctx) return;

      this.audioDecoder = new AudioDecoder({
        output: (data) => {
          if (this.destroyed) { data.close(); return; }
          this.enqueueAudioData(data, ctx);
        },
        error: (err) => {
          if (!this.destroyed) console.warn(`Audio decode error: ${err.message}`);
        },
      });
      this.audioDecoder.configure(config);
      this.activeAudioTrack = track;
      this.activeAudioTrackId = track.id;
    } catch (e) {
      console.warn('AudioDecoder init failed:', e);
    }
  }

  private closeAudioDecoder(): void {
    if (this.audioDecoder) {
      try {
        this.audioDecoder.close();
      } catch {
        // ignore
      }
      this.audioDecoder = null;
    }
    this.audioQueue = [];
    this.scheduledAudioEnd = 0;
  }

  private enqueueAudioData(data: AudioData, ctx: AudioContext): void {
    const ch = data.numberOfChannels;
    const frames = data.numberOfFrames;
    const sr = data.sampleRate;

    try {
      const buffer = ctx.createBuffer(ch, frames, sr);
      for (let c = 0; c < ch; c++) {
        const channelData = buffer.getChannelData(c);
        data.copyTo(channelData, { planeIndex: c, format: 'f32-planar' });
      }
      const mediaTime = data.timestamp / 1_000_000;
      data.close();

      this.audioQueue.push({ buffer, mediaTime });
      this.scheduleAudioBuffers();
    } catch (e) {
      console.warn('Failed to enqueue audio buffer:', e);
      data.close();
    }
  }

  private scheduleAudioBuffers(): void {
    if (!this.audioContext || this.audioQueue.length === 0) return;
    if (!this.isPlaying) return;

    const ctx = this.audioContext;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    while (this.audioQueue.length > 0) {
      const item = this.audioQueue[0];
      const targetCtxTime = this.playbackStartTime + (item.mediaTime - this.playbackMediaStart);
      if (targetCtxTime < now - 0.1) {
        this.audioQueue.shift();
        continue;
      }
      const startAt = Math.max(now, targetCtxTime);
      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = item.buffer;
      sourceNode.connect(ctx.destination);
      sourceNode.start(startAt);
      this.scheduledAudioEnd = startAt + item.buffer.duration;
      this.audioQueue.shift();
    }
  }

  async play(startTime = 0): Promise<void> {
    if (this.destroyed) return;

    if (this.mode === 'native' && this.videoEl) {
      if (startTime > 0) {
        this.videoEl.currentTime = startTime;
      }
      await this.videoEl.play();
      return;
    }

    if (!this.input) return;
    if (this.isPlaying && !this.isSeeking) return;

    this.isPlaying = true;
    this.currentTime = startTime;

    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
      this.playbackStartTime = this.audioContext.currentTime;
    } else {
      this.playbackStartTime = performance.now() / 1000;
    }
    this.playbackMediaStart = startTime;

    this.onEvent({ type: 'playing' });
    this.onEvent({ type: 'buffering', value: true });

    // Start feeding packets in parallel
    await Promise.all([
      this.feedVideoPackets(startTime),
      this.feedAudioPackets(startTime),
    ]);

    this.startRenderLoop();
    this.onEvent({ type: 'buffering', value: false });
  }

  async pause(): Promise<void> {
    if (this.mode === 'native' && this.videoEl) {
      this.videoEl.pause();
      return;
    }

    this.isPlaying = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioContext && this.audioContext.state === 'running') {
      await this.audioContext.suspend().catch(() => {});
    }
    this.onEvent({ type: 'paused' });
  }

  async seek(time: number): Promise<void> {
    if (this.destroyed) return;
    this.isSeeking = true;

    if (this.mode === 'native' && this.videoEl) {
      this.videoEl.currentTime = time;
      this.isSeeking = false;
      this.onEvent({ type: 'seek-complete', time });
      return;
    }

    const wasPlaying = this.isPlaying;
    await this.pause();
    this.clearPendingFrames();
    await this.play(time);
    if (!wasPlaying) await this.pause();
    this.isSeeking = false;
    this.onEvent({ type: 'seek-complete', time });
  }

  async switchAudioTrack(trackId: number): Promise<void> {
    if (this.destroyed || this.isAudioSwitching) return;
    const track = this.audioTrackList.find(t => t.id === trackId);
    if (!track || track.id === this.activeAudioTrackId) return;

    this.isAudioSwitching = true;
    const wasPlaying = this.isPlaying;
    const time = this.currentTime;

    this.closeAudioDecoder();
    await this.initAudioDecoder(track);

    if (wasPlaying && this.audioDecoder) {
      if (this.audioContext) {
        this.playbackStartTime = this.audioContext.currentTime;
        this.playbackMediaStart = time;
      }
      this.feedAudioPackets(time);
    }

    this.isAudioSwitching = false;
    this.onEvent({ type: 'audiotrack-switched', trackId });
  }

  setVolume(vol: number): void {
    if (this.mode === 'native' && this.videoEl) {
      this.videoEl.volume = vol;
      this.videoEl.muted = vol === 0;
      return;
    }
    if (this.audioContext) {
      try {
        const gain = this.audioContext.createGain();
        gain.gain.value = vol;
        gain.connect(this.audioContext.destination);
      } catch {
        // ignore
      }
    }
  }

  setPlaybackRate(rate: number): void {
    if (this.mode === 'native' && this.videoEl) {
      this.videoEl.playbackRate = rate;
    }
  }

  private async feedVideoPackets(fromTime: number): Promise<void> {
    if (!this.videoTrack || !this.videoDecoder) return;
    try {
      this.videoSink = new EncodedPacketSink(this.videoTrack);
      const startPacket = (fromTime > 0)
        ? (await this.videoSink.getKeyPacket(fromTime)) ?? undefined
        : undefined;
      for await (const packet of this.videoSink.packets(startPacket)) {
        if (!this.isPlaying || this.destroyed) break;
        const chunk = this.packetToVideoChunk(packet);
        if (this.videoDecoder.state === 'configured') {
          this.videoDecoder.decode(chunk);
        }
        const decoded = this.pendingFrames.length;
        if (decoded > 60) await sleep(50);
      }
    } catch (err) {
      if (!this.destroyed) console.warn('Video feed error:', err);
    }
  }

  private async feedAudioPackets(fromTime: number): Promise<void> {
    if (!this.activeAudioTrack || !this.audioDecoder) return;
    try {
      this.audioSink = new EncodedPacketSink(this.activeAudioTrack);
      const startPacket = (fromTime > 0)
        ? (await this.audioSink.getPacket(fromTime)) ?? undefined
        : undefined;
      for await (const packet of this.audioSink.packets(startPacket)) {
        if (this.destroyed) break;
        if (this.isAudioSwitching) break;
        const chunk = this.packetToAudioChunk(packet);
        if (this.audioDecoder && this.audioDecoder.state === 'configured') {
          this.audioDecoder.decode(chunk);
        }
        if (this.scheduledAudioEnd - (this.audioContext?.currentTime ?? 0) < BUFFER_AHEAD_SECONDS) {
          this.scheduleAudioBuffers();
        }
      }
    } catch (err) {
      if (!this.destroyed) console.warn('Audio feed error:', err);
    }
  }

  private packetToVideoChunk(packet: EncodedPacket): EncodedVideoChunk {
    return new EncodedVideoChunk({
      type: packet.type,
      timestamp: packet.timestamp * 1_000_000,
      duration: (packet.duration ?? 0) * 1_000_000,
      data: packet.data,
    });
  }

  private packetToAudioChunk(packet: EncodedPacket): EncodedAudioChunk {
    return new EncodedAudioChunk({
      type: 'key',
      timestamp: packet.timestamp * 1_000_000,
      duration: (packet.duration ?? 0) * 1_000_000,
      data: packet.data,
    });
  }

  private startRenderLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const renderFrame = () => {
      if (!this.isPlaying || this.destroyed) return;

      const wallClock = this.audioContext?.currentTime ?? performance.now() / 1000;
      const wallElapsed = wallClock - this.playbackStartTime;
      this.currentTime = this.playbackMediaStart + wallElapsed;

      this.onEvent({ type: 'timeupdate', currentTime: this.currentTime, duration: this.duration });

      if (this.pendingFrames.length > 0) {
        let frameIdx = -1;
        for (let i = 0; i < this.pendingFrames.length; i++) {
          const ft = this.pendingFrames[i].timestamp / 1_000_000;
          if (ft <= this.currentTime + 0.05) {
            frameIdx = i;
          } else {
            break;
          }
        }

        if (frameIdx >= 0) {
          const frame = this.pendingFrames[frameIdx];
          if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
          }
          ctx.drawImage(frame, 0, 0);
          for (let i = 0; i <= frameIdx; i++) {
            this.pendingFrames[i].close();
          }
          this.pendingFrames.splice(0, frameIdx + 1);
        }
      }

      this.rafId = requestAnimationFrame(renderFrame);
    };

    this.rafId = requestAnimationFrame(renderFrame);
  }

  private clearPendingFrames(): void {
    for (const f of this.pendingFrames) f.close();
    this.pendingFrames = [];
  }

  destroy(): void {
    this.destroyed = true;
    this.isPlaying = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.clearPendingFrames();
    this.closeAudioDecoder();
    if (this.videoDecoder) {
      try { this.videoDecoder.close(); } catch {}
      this.videoDecoder = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.src = '';
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
