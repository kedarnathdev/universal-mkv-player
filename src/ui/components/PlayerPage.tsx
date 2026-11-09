import { useEffect, useRef, useState, useCallback } from 'react'
import { PlaybackEngine, EngineEvent } from '../../engine/PlaybackEngine'
import { SubtitleManager } from '../../engine/SubtitleManager'
import {
  MediaInfo, PlayerState, SubtitleCue, SubtitleStyle,
  AudioTrackInfo, SubtitleTrackInfo
} from '../../types'
import PlayerControls from './PlayerControls'
import MediaInfoPanel from './MediaInfoPanel'
import SubtitleOverlay from './SubtitleOverlay'
import styles from './PlayerPage.module.css'

interface Props {
  videoUrl: string
  subtitleUrl: string | null
  onBack: () => void
}

const DEFAULT_SETTINGS = {
  volume: 1,
  muted: false,
  playbackRate: 1,
  subtitleStyle: {
    fontFamily: 'sans-serif',
    fontSize: 22,
    color: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0.6,
    position: 'bottom' as const,
    outline: true,
    shadow: false,
  },
  subtitleDelay: 0,
}

export default function PlayerPage({ videoUrl, subtitleUrl, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const subtitleMgrRef = useRef(new SubtitleManager())
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [playerState, setPlayerState] = useState<PlayerState>({
    status: 'loading',
    currentTime: 0,
    duration: null,
    buffered: [],
    mediaInfo: null,
    activeAudioTrackId: null,
    activeSubtitleTrackId: null,
    error: null,
    settings: DEFAULT_SETTINGS,
  })

  const [activeCues, setActiveCues] = useState<SubtitleCue[]>([])
  const [showControls, setShowControls] = useState(true)
  const [showInfoPanel, setShowInfoPanel] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [externalSubtitleTracks, setExternalSubtitleTracks] = useState<SubtitleTrackInfo[]>([])

  const updateState = useCallback((patch: Partial<PlayerState>) => {
    setPlayerState(prev => ({ ...prev, ...patch }))
  }, [])

  // Handle engine events
  const handleEvent = useCallback((event: EngineEvent) => {
    switch (event.type) {
      case 'ready':
        updateState({
          status: 'paused',
          mediaInfo: event.mediaInfo,
          duration: event.mediaInfo.duration,
          activeAudioTrackId: event.mediaInfo.audioTracks[0]?.id ?? null,
        })
        // Auto-play on load
        engineRef.current?.play(0)
        break

      case 'playing':
        updateState({ status: 'playing' })
        break

      case 'paused':
        updateState({ status: 'paused' })
        break

      case 'buffering':
        if (event.value) updateState({ status: 'buffering' })
        break

      case 'timeupdate':
        setPlayerState(prev => ({
          ...prev,
          currentTime: event.currentTime,
          duration: event.duration,
          status: prev.status === 'buffering' ? 'playing' : prev.status,
        }))
        // Update subtitles
        setActiveCues(
          subtitleMgrRef.current.getActiveCues(
            event.currentTime,
            playerState.settings.subtitleDelay
          )
        )
        break

      case 'ended':
        updateState({ status: 'ended' })
        break

      case 'error':
        updateState({ status: 'error', error: event.message })
        break

      case 'audiotrack-switched':
        updateState({ activeAudioTrackId: event.trackId })
        break

      case 'seek-complete':
        updateState({ currentTime: event.time })
        break
    }
  }, [updateState, playerState.settings.subtitleDelay])

  // Initialize engine
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new PlaybackEngine(videoUrl, canvas, handleEvent)
    engineRef.current = engine
    engine.initialize()

    // Load external subtitle if provided
    if (subtitleUrl) {
      subtitleMgrRef.current.loadExternalUrl(subtitleUrl).then(info => {
        if (info) {
          subtitleMgrRef.current.setActiveTrack(info.id)
          setExternalSubtitleTracks(prev => [...prev, info])
          updateState({ activeSubtitleTrackId: info.id })
        }
      })
    }

    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlayPause()
          break
        case 'ArrowRight':
          e.preventDefault()
          handleSeek(playerState.currentTime + 10)
          break
        case 'ArrowLeft':
          e.preventDefault()
          handleSeek(playerState.currentTime - 10)
          break
        case 'ArrowUp':
          e.preventDefault()
          handleVolumeChange(Math.min(1, playerState.settings.volume + 0.1))
          break
        case 'ArrowDown':
          e.preventDefault()
          handleVolumeChange(Math.max(0, playerState.settings.volume - 0.1))
          break
        case 'm':
          handleMuteToggle()
          break
        case 'f':
          handleFullscreen()
          break
        case 'i':
          setShowInfoPanel(v => !v)
          break
        case 'Escape':
          if (document.fullscreenElement) document.exitFullscreen()
          break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [playerState.currentTime, playerState.settings.volume]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const showControlsTemp = useCallback(() => {
    setShowControls(true)
    if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current)
    controlsHideTimer.current = setTimeout(() => {
      if (playerState.status === 'playing') setShowControls(false)
    }, 3000)
  }, [playerState.status])

  const togglePlayPause = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    if (playerState.status === 'playing') {
      engine.pause()
    } else {
      engine.play(playerState.currentTime)
    }
  }, [playerState.status, playerState.currentTime])

  const handleSeek = useCallback((time: number) => {
    const engine = engineRef.current
    if (!engine || playerState.duration === null) return
    const clamped = Math.max(0, Math.min(time, playerState.duration))
    engine.seek(clamped)
    updateState({ currentTime: clamped })
  }, [playerState.duration, updateState])

  const handleVolumeChange = useCallback((vol: number) => {
    engineRef.current?.setVolume(vol)
    updateState({ settings: { ...playerState.settings, volume: vol, muted: vol === 0 } })
  }, [playerState.settings, updateState])

  const handleMuteToggle = useCallback(() => {
    const newMuted = !playerState.settings.muted
    engineRef.current?.setVolume(newMuted ? 0 : playerState.settings.volume)
    updateState({ settings: { ...playerState.settings, muted: newMuted } })
  }, [playerState.settings, updateState])

  const handleAudioTrackSwitch = useCallback((id: number) => {
    engineRef.current?.switchAudioTrack(id)
    updateState({ activeAudioTrackId: id })
  }, [updateState])

  const handleSubtitleTrackSwitch = useCallback((id: string | null) => {
    subtitleMgrRef.current.setActiveTrack(id)
    updateState({ activeSubtitleTrackId: id })
  }, [updateState])

  const handlePlaybackRate = useCallback((rate: number) => {
    engineRef.current?.setPlaybackRate(rate)
    updateState({ settings: { ...playerState.settings, playbackRate: rate } })
  }, [playerState.settings, updateState])

  const handleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }, [])

  const handlePiP = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // PiP works with video elements; we'd need a trick with captureStream()
    // Try to create a hidden video fed from canvas stream
    const stream = canvas.captureStream()
    const video = document.createElement('video')
    video.srcObject = stream
    video.play()
    if ('requestPictureInPicture' in video) {
      video.requestPictureInPicture().catch(console.warn)
    }
  }, [])

  const handleSubtitleFileLoad = useCallback(async (file: File) => {
    const info = await subtitleMgrRef.current.loadLocalFile(file)
    if (info) {
      setExternalSubtitleTracks(prev => [...prev, info])
      subtitleMgrRef.current.setActiveTrack(info.id)
      updateState({ activeSubtitleTrackId: info.id })
    }
  }, [updateState])

  const handleSubtitleStyleChange = useCallback((style: Partial<SubtitleStyle>) => {
    updateState({
      settings: {
        ...playerState.settings,
        subtitleStyle: { ...playerState.settings.subtitleStyle, ...style }
      }
    })
  }, [playerState.settings, updateState])

  const handleSubtitleDelayChange = useCallback((delay: number) => {
    updateState({ settings: { ...playerState.settings, subtitleDelay: delay } })
  }, [playerState.settings, updateState])

  const allSubtitleTracks: SubtitleTrackInfo[] = [
    ...(playerState.mediaInfo?.subtitleTracks ?? []),
    ...externalSubtitleTracks,
  ]

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${isFullscreen ? styles.fullscreen : ''}`}
      onMouseMove={showControlsTemp}
      onTouchStart={showControlsTemp}
    >
      {/* Back button */}
      {!isFullscreen && (
        <button className={styles.backBtn} onClick={onBack} title="Back to home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M5 12l7-7M5 12l7 7"/>
          </svg>
        </button>
      )}

      {/* Video canvas area */}
      <div className={styles.videoWrapper} onClick={togglePlayPause}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />

        {/* Subtitle overlay */}
        {activeCues.length > 0 && (
          <SubtitleOverlay
            cues={activeCues}
            style={playerState.settings.subtitleStyle}
          />
        )}

        {/* Loading / Error overlay */}
        {playerState.status === 'loading' || playerState.status === 'buffering' ? (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner}/>
            <p>{playerState.status === 'loading' ? 'Loading media…' : 'Buffering…'}</p>
          </div>
        ) : null}

        {playerState.status === 'error' && (
          <div className={styles.errorOverlay}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className={styles.errorText}>{playerState.error}</p>
            <div className={styles.errorHelp}>
              <p>Common causes:</p>
              <ul>
                <li>CORS policy blocking the URL (try enabling CORS on the server)</li>
                <li>Unsupported codec in this browser</li>
                <li>URL not accessible or authentication required</li>
              </ul>
            </div>
            <button className={styles.retryBtn} onClick={onBack}>← Go back</button>
          </div>
        )}

        {/* Play/Pause center indicator */}
        {playerState.status === 'paused' && (
          <div className={styles.pausedIndicator}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </div>
        )}
      </div>

      {/* Player controls */}
      <div className={`${styles.controlsWrapper} ${showControls || playerState.status !== 'playing' ? styles.visible : styles.hidden}`}>
        <PlayerControls
          state={playerState}
          audioTracks={playerState.mediaInfo?.audioTracks ?? []}
          subtitleTracks={allSubtitleTracks}
          onPlayPause={togglePlayPause}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onMuteToggle={handleMuteToggle}
          onAudioTrackSwitch={handleAudioTrackSwitch}
          onSubtitleTrackSwitch={handleSubtitleTrackSwitch}
          onPlaybackRate={handlePlaybackRate}
          onFullscreen={handleFullscreen}
          onPiP={handlePiP}
          onSubtitleFileLoad={handleSubtitleFileLoad}
          onSubtitleStyleChange={handleSubtitleStyleChange}
          onSubtitleDelayChange={handleSubtitleDelayChange}
          onToggleInfo={() => setShowInfoPanel(v => !v)}
          isFullscreen={isFullscreen}
        />
      </div>

      {/* Media info panel */}
      {showInfoPanel && (
        <div className={styles.infoPanel}>
          <MediaInfoPanel
            mediaInfo={playerState.mediaInfo}
            currentTime={playerState.currentTime}
            onClose={() => setShowInfoPanel(false)}
          />
        </div>
      )}
    </div>
  )
}
