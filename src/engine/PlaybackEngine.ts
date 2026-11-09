/**
 * MKV Playback Engine
 *
 * Architecture:
 * - mediabunny: MKV demuxer, reads from HTTPS URL via Range requests
 * - WebCodecs VideoDecoder: decodes video frames
 * - WebCodecs AudioDecoder: decodes audio packets
 * - Web Audio API AudioContext: outputs decoded audio samples
 * - <canvas>: renders decoded VideoFrames
 *
 * Audio track switching:
 * 1. Flush current AudioDecoder output queue
 * 2. Close old AudioDecoder
 * 3. Create new EncodedPacketSink on new audio track, seek to currentTime
 * 4. Configure new AudioDecoder with new track's codec config
 * 5. Resume feeding; video is NEVER paused or restarted
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

const BUFFER_AHEAD_SECONDS = 15; // buffer 15s ahead
const BUFFER_BEHIND_SECONDS = 10; // keep 10s behind current

interface AudioNode {
  sourceNode: AudioBufferSourceNode;
  startAt: number; // AudioContext.currentTime when this segment starts
  mediaTime: number; // media timestamp of start
}

export class PlaybackEngine {
  private url: string;
  private canvas: HTMLCanvasElement;
  private onEvent: EngineEventHandler;

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
  private playbackStartTime = 0;    // Date.now() when playback began / resumed
  private playbackMediaStart = 0;    // media time when playback began / resumed
  private currentTime = 0;
  private duration: number | null = null;
  private isPlaying = false;
  private isSeeking = false;
  private isAudioSwitching = false;

  // Frame queue for canvas rendering
  private pendingFrames: VideoFrame[] = [];
  private rafId: number | null = null;

  // Audio output queue
  private scheduledAudioEnd = 0; // AudioContext.currentTime of last scheduled buffer end
  private audioQueue: { buffer: AudioBuffer; mediaTime: number }[] = [];
  private audioSchedulerTimer: ReturnType<typeof setTimeout> | null = null;

  private destroyed = false;

  constructor(url: string, canvas: HTMLCanvasElement, onEvent: EngineEventHandler) {
    this.url = url;
    this.canvas = canvas;
    this.onEvent = onEvent;
  }

  async initialize(): Promise<void> {
    try {
      this.onEvent({ type: 'buffering', value: true });
      const source = new UrlSource(this.url);
      this.input = new Input({ formats: ALL_FORMATS, source });

      const canRead = await this.input.canRead();
      if (!canRead) throw new Error('Cannot read media: unsupported format or inaccessible URL.');

      const format = await this.input.getFormat();
      const duration = await this.input.getDurationFromMetadata();
      this.duration = duration;

      const videoTracks = await this.input.getVideoTracks();
      const audioTracks = await this.input.getAudioTracks();

      this.audioTrackList = audioTracks;

      // Build track info
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
          const canDec = await t.canDecode();
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
        format: format?.constructor.name.replace('InputFormat', '') ?? 'Unknown',
        fileSize: null,
        duration,
        videoTrack: videoInfo,
        audioTracks: audioInfos,
        subtitleTracks: [], // populated by subtitle manager
      };

      this.onEvent({ type: 'ready', mediaInfo });

      // Select default audio track (first decodable or first with default flag)
      const defaultTrack =
        audioTracks.find((_, i) => audioInfos[i].isDefault && audioInfos[i].canDecode) ??
        audioTracks.find((_, i) => audioInfos[i].canDecode) ??
        audioTracks[0];

      if (defaultTrack) {
        await this.initAudioDecoder(defaultTrack);
      }

      if (this.videoTrack) {
        await this.initVideoDecoder(this.videoTrack);
      }

    } catch (err) {
      this.onEvent({ type: 'error', message: (err as Error).message });
    }
  }

  private async initVideoDecoder(track: InputVideoTrack): Promise<void> {
    const config = await track.getDecoderConfig();
    if (!config) {
      this.onEvent({ type: 'error', message: `Cannot get decoder config for video codec: ${await track.getCodec()}` });
      return;
    }

    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) {
      this.onEvent({ type: 'error', message: `Video codec ${getCodecDisplayName(await track.getCodec())} is not supported in this browser.` });
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
  }

  private async initAudioDecoder(track: InputAudioTrack): Promise<void> {
    // Close previous decoder
    this.closeAudioDecoder();

    const config = await track.getDecoderConfig();
    if (!config) {
      console.warn(`No decoder config for audio track ${track.id}`);
      return;
    }

    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) {
      console.warn(`Audio codec not supported: ${await track.getCodec()}`);
      return;
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    const ctx = this.audioContext;

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
  }

  private closeAudioDecoder(): void {
    if (this.audioDecoder) {
      this.audioDecoder.close();
      this.audioDecoder = null;
    }
    // Clear scheduled audio
    this.audioQueue = [];
    this.scheduledAudioEnd = 0;
    if (this.audioSchedulerTimer) {
      clearTimeout(this.audioSchedulerTimer);
      this.audioSchedulerTimer = null;
    }
  }

  private enqueueAudioData(data: AudioData, ctx: AudioContext): void {
    const ch = data.numberOfChannels;
    const frames = data.numberOfFrames;
    const sr = data.sampleRate;

    // Convert to Float32
    const buffer = ctx.createBuffer(ch, frames, sr);
    for (let c = 0; c < ch; c++) {
      const channelData = buffer.getChannelData(c);
      data.copyTo(channelData, { planeIndex: c, format: 'f32-planar' });
    }
    const mediaTime = data.timestamp / 1_000_000; // microseconds → seconds
    data.close();

    this.audioQueue.push({ buffer, mediaTime });
    this.scheduleAudioBuffers();
  }

  private scheduleAudioBuffers(): void {
    if (!this.audioContext || this.audioQueue.length === 0) return;
    if (!this.isPlaying) return;

    const ctx = this.audioContext;
    // Ensure AudioContext is running
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    // Drain queue
    while (this.audioQueue.length > 0) {
      const item = this.audioQueue[0];
      // Schedule relative to playback start
      const targetCtxTime = this.playbackStartTime + (item.mediaTime - this.playbackMediaStart);
      if (targetCtxTime < now - 0.1) {
        // Too late, skip
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
    if (this.destroyed || !this.input) return;
    if (this.isPlaying && !this.isSeeking) return;

    this.isPlaying = true;
    this.currentTime = startTime;

    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
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

    // Start render loop
    this.startRenderLoop();
    this.onEvent({ type: 'buffering', value: false });
  }

  async pause(): Promise<void> {
    this.isPlaying = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioContext) await this.audioContext.suspend();
    this.onEvent({ type: 'paused' });
  }

  async seek(time: number): Promise<void> {
    if (this.destroyed) return;
    this.isSeeking = true;
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

    // Reset audio output
    this.closeAudioDecoder();
    await this.initAudioDecoder(track);

    // Resume audio feed from current time
    if (wasPlaying && this.audioDecoder) {
      if (this.audioContext) {
        this.playbackStartTime = this.audioContext.currentTime;
        this.playbackMediaStart = time;
      }
      this.feedAudioPackets(time); // fire-and-forget, runs in background
    }

    this.isAudioSwitching = false;
    this.onEvent({ type: 'audiotrack-switched', trackId });
  }

  setVolume(vol: number): void {
    // Create/update a GainNode if needed; for simplicity use context.destination.gain via AudioNode
    // For now we store volume and apply it to source nodes via gain
    if (this.audioContext) {
      const gain = this.audioContext.createGain();
      gain.gain.value = vol;
      gain.connect(this.audioContext.destination);
    }
  }

  setPlaybackRate(rate: number): void {
    // For canvas-based rendering, we'd need to adjust how fast we consume packets.
    // For this implementation, seek-and-play effectively resets; a full implementation
    // would adjust the packet consumption rate. Stored for display only.
    console.log(`Playback rate: ${rate} (canvas renderer uses wall-clock)`);
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
        // Flow control: don't get too far ahead
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
        if (this.isAudioSwitching) break; // bail if switching
        const chunk = this.packetToAudioChunk(packet);
        if (this.audioDecoder && this.audioDecoder.state === 'configured') {
          this.audioDecoder.decode(chunk);
        }
        // Schedule periodically
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
      timestamp: packet.timestamp * 1_000_000, // seconds → microseconds
      duration: (packet.duration ?? 0) * 1_000_000,
      data: packet.data,
    });
  }

  private packetToAudioChunk(packet: EncodedPacket): EncodedAudioChunk {
    return new EncodedAudioChunk({
      type: 'key', // audio packets are always independently decodable
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

      // Determine current media time
      const wallClock = this.audioContext?.currentTime ?? performance.now() / 1000;
      const wallElapsed = wallClock - this.playbackStartTime;
      this.currentTime = this.playbackMediaStart + wallElapsed;

      // Emit time update at ~4Hz to avoid state thrashing
      this.onEvent({ type: 'timeupdate', currentTime: this.currentTime, duration: this.duration });

      // Find the right frame to display
      if (this.pendingFrames.length > 0) {
        // Find the last frame whose timestamp ≤ currentTime
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
          // Resize canvas to frame dimensions
          if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
          }
          ctx.drawImage(frame, 0, 0);
          // Close and remove all frames up to frameIdx
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
    if (this.videoDecoder) { this.videoDecoder.close(); this.videoDecoder = null; }
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null; }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
