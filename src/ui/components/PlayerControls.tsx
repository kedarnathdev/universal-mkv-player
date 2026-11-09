import { useState, useRef } from 'react'
import {
  PlayerState, AudioTrackInfo, SubtitleTrackInfo, SubtitleStyle
} from '../../types'
import { formatTime, getCodecDisplayName, getLanguageName, formatChannels, clamp } from '../../utils/helpers'
import styles from './PlayerControls.module.css'

interface Props {
  state: PlayerState
  audioTracks: AudioTrackInfo[]
  subtitleTracks: SubtitleTrackInfo[]
  onPlayPause: () => void
  onSeek: (time: number) => void
  onVolumeChange: (vol: number) => void
  onMuteToggle: () => void
  onAudioTrackSwitch: (id: number) => void
  onSubtitleTrackSwitch: (id: string | null) => void
  onPlaybackRate: (rate: number) => void
  onFullscreen: () => void
  onPiP: () => void
  onSubtitleFileLoad: (file: File) => void
  onSubtitleStyleChange: (style: Partial<SubtitleStyle>) => void
  onSubtitleDelayChange: (delay: number) => void
  onToggleInfo: () => void
  isFullscreen: boolean
}

type MenuPanel = 'audio' | 'subtitles' | 'speed' | 'subSettings' | null

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export default function PlayerControls({
  state, audioTracks, subtitleTracks,
  onPlayPause, onSeek, onVolumeChange, onMuteToggle,
  onAudioTrackSwitch, onSubtitleTrackSwitch, onPlaybackRate,
  onFullscreen, onPiP, onSubtitleFileLoad,
  onSubtitleStyleChange, onSubtitleDelayChange, onToggleInfo,
  isFullscreen,
}: Props) {
  const [openMenu, setOpenMenu] = useState<MenuPanel>(null)
  const [isDraggingSeek, setIsDraggingSeek] = useState(false)
  const [isDraggingVol, setIsDraggingVol] = useState(false)
  const seekBarRef = useRef<HTMLDivElement>(null)
  const volumeBarRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { currentTime, duration, status, settings } = state
  const { volume, muted, playbackRate, subtitleStyle, subtitleDelay } = settings

  const isPlaying = status === 'playing'
  const progress = duration ? clamp(currentTime / duration, 0, 1) : 0
  const volumeDisplay = muted ? 0 : volume

  const toggleMenu = (menu: MenuPanel) => setOpenMenu(prev => prev === menu ? null : menu)

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration || !seekBarRef.current) return
    const rect = seekBarRef.current.getBoundingClientRect()
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    onSeek(ratio * duration)
  }

  const handleSeekMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingSeek(true)
    handleSeekClick(e)
    const up = () => { setIsDraggingSeek(false); window.removeEventListener('mouseup', up) }
    window.addEventListener('mouseup', up)
  }

  const handleSeekMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingSeek || !duration || !seekBarRef.current) return
    const rect = seekBarRef.current.getBoundingClientRect()
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    onSeek(ratio * duration)
  }

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!volumeBarRef.current) return
    const rect = volumeBarRef.current.getBoundingClientRect()
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    onVolumeChange(ratio)
  }

  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingVol(true)
    handleVolumeClick(e)
    const up = () => { setIsDraggingVol(false); window.removeEventListener('mouseup', up) }
    window.addEventListener('mouseup', up)
  }

  const handleVolumeMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingVol || !volumeBarRef.current) return
    const rect = volumeBarRef.current.getBoundingClientRect()
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1)
    onVolumeChange(ratio)
  }

  const handleSubtitleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onSubtitleFileLoad(file)
    e.target.value = ''
  }

  return (
    <div className={styles.controls} onClick={e => e.stopPropagation()}>
      {/* Seek bar */}
      <div
        ref={seekBarRef}
        className={styles.seekBar}
        onMouseDown={handleSeekMouseDown}
        onMouseMove={handleSeekMouseMove}
      >
        <div className={styles.seekTrack}>
          <div className={styles.seekFill} style={{ width: `${progress * 100}%` }} />
          <div className={styles.seekThumb} style={{ left: `${progress * 100}%` }} />
        </div>
      </div>

      {/* Controls row */}
      <div className={styles.row}>
        {/* Left group */}
        <div className={styles.left}>
          {/* Play/Pause */}
          <button className={styles.iconBtn} onClick={onPlayPause} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
            {isPlaying
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            }
          </button>

          {/* Volume */}
          <div className={styles.volumeGroup}>
            <button className={styles.iconBtn} onClick={onMuteToggle} title="Mute (M)">
              {volumeDisplay === 0
                ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5zm8.07-1.07A10 10 0 0 1 21 12a10 10 0 0 1-1.93 5.93L17.5 16.37A8 8 0 0 0 19 12a8 8 0 0 0-1.5-4.63l1.57-1.44z"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2"/></svg>
                : volumeDisplay < 0.5
                ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
              }
            </button>
            <div
              ref={volumeBarRef}
              className={styles.volumeBar}
              onMouseDown={handleVolumeMouseDown}
              onMouseMove={handleVolumeMouseMove}
            >
              <div className={styles.volumeTrack}>
                <div className={styles.volumeFill} style={{ width: `${volumeDisplay * 100}%` }} />
                <div className={styles.volumeThumb} style={{ left: `${volumeDisplay * 100}%` }} />
              </div>
            </div>
          </div>

          {/* Time */}
          <span className={styles.time}>
            {formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}
          </span>
        </div>

        {/* Right group */}
        <div className={styles.right}>
          {/* Audio track button */}
          {audioTracks.length > 1 && (
            <div className={styles.menuWrapper}>
              <button
                className={`${styles.iconBtn} ${styles.textBtn} ${openMenu === 'audio' ? styles.active : ''}`}
                onClick={() => toggleMenu('audio')}
                title="Audio tracks"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                Audio
              </button>
              {openMenu === 'audio' && (
                <div className={styles.menu}>
                  <div className={styles.menuTitle}>Audio Tracks</div>
                  {audioTracks.map(track => (
                    <button
                      key={track.id}
                      className={`${styles.menuItem} ${state.activeAudioTrackId === track.id ? styles.menuItemActive : ''}`}
                      onClick={() => { onAudioTrackSwitch(track.id); setOpenMenu(null) }}
                    >
                      <span className={styles.menuItemCheck}>
                        {state.activeAudioTrackId === track.id ? '✓' : ''}
                      </span>
                      <span className={styles.menuItemLabel}>
                        <span className={styles.trackLang}>{track.language}</span>
                        <span className={styles.trackMeta}>
                          {getCodecDisplayName(track.codec)} · {formatChannels(track.channels)}
                          {track.isDefault ? ' · Default' : ''}
                          {!track.canDecode ? ' · ⚠ Unsupported' : ''}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Subtitle button */}
          <div className={styles.menuWrapper}>
            <button
              className={`${styles.iconBtn} ${styles.textBtn} ${openMenu === 'subtitles' ? styles.active : ''}`}
              onClick={() => toggleMenu('subtitles')}
              title="Subtitles"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="6" width="20" height="12" rx="2"/>
                <path d="M6 10h4M14 10h4M6 14h8"/>
              </svg>
              CC
            </button>
            {openMenu === 'subtitles' && (
              <div className={styles.menu}>
                <div className={styles.menuTitle}>Subtitles</div>
                <button
                  className={`${styles.menuItem} ${state.activeSubtitleTrackId === null ? styles.menuItemActive : ''}`}
                  onClick={() => { onSubtitleTrackSwitch(null); setOpenMenu(null) }}
                >
                  <span className={styles.menuItemCheck}>{state.activeSubtitleTrackId === null ? '✓' : ''}</span>
                  <span className={styles.menuItemLabel}><span className={styles.trackLang}>Off</span></span>
                </button>
                {subtitleTracks.map(track => (
                  <button
                    key={track.id}
                    className={`${styles.menuItem} ${state.activeSubtitleTrackId === track.id ? styles.menuItemActive : ''}`}
                    onClick={() => { onSubtitleTrackSwitch(track.id); setOpenMenu(null) }}
                  >
                    <span className={styles.menuItemCheck}>
                      {state.activeSubtitleTrackId === track.id ? '✓' : ''}
                    </span>
                    <span className={styles.menuItemLabel}>
                      <span className={styles.trackLang}>{track.language || track.name || 'Track'}</span>
                      <span className={styles.trackMeta}>
                        {track.format.toUpperCase()} · {track.source}
                      </span>
                    </span>
                  </button>
                ))}
                <div className={styles.menuDivider}/>
                <button
                  className={styles.menuItem}
                  onClick={() => { fileInputRef.current?.click(); setOpenMenu(null) }}
                >
                  <span className={styles.menuItemCheck}/>
                  <span className={styles.menuItemLabel}>
                    <span className={styles.trackLang}>+ Load local file</span>
                  </span>
                </button>
                <button
                  className={styles.menuItem}
                  onClick={() => { toggleMenu('subSettings') }}
                >
                  <span className={styles.menuItemCheck}/>
                  <span className={styles.menuItemLabel}>
                    <span className={styles.trackLang}>⚙ Subtitle settings</span>
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Subtitle settings panel */}
          {openMenu === 'subSettings' && (
            <div className={`${styles.menu} ${styles.settingsMenu}`} style={{ right: 0 }}>
              <div className={styles.menuTitle}>Subtitle Settings</div>
              <div className={styles.settingRow}>
                <label>Font size</label>
                <input
                  type="range" min={12} max={48} step={1}
                  value={subtitleStyle.fontSize ?? 22}
                  onChange={e => onSubtitleStyleChange({ fontSize: Number(e.target.value) })}
                />
                <span>{subtitleStyle.fontSize ?? 22}px</span>
              </div>
              <div className={styles.settingRow}>
                <label>Color</label>
                <input
                  type="color"
                  value={subtitleStyle.color ?? '#ffffff'}
                  onChange={e => onSubtitleStyleChange({ color: e.target.value })}
                />
              </div>
              <div className={styles.settingRow}>
                <label>Background opacity</label>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={subtitleStyle.backgroundOpacity ?? 0.6}
                  onChange={e => onSubtitleStyleChange({ backgroundOpacity: Number(e.target.value) })}
                />
                <span>{Math.round((subtitleStyle.backgroundOpacity ?? 0.6) * 100)}%</span>
              </div>
              <div className={styles.settingRow}>
                <label>Delay (s)</label>
                <input
                  type="number" step={0.1} min={-30} max={30}
                  value={subtitleDelay}
                  onChange={e => onSubtitleDelayChange(Number(e.target.value))}
                  className={styles.numberInput}
                />
              </div>
              <div className={styles.settingRow}>
                <label>Position</label>
                <select
                  value={subtitleStyle.position ?? 'bottom'}
                  onChange={e => onSubtitleStyleChange({ position: e.target.value as 'bottom' | 'top' })}
                  className={styles.select}
                >
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </div>
            </div>
          )}

          {/* Playback speed */}
          <div className={styles.menuWrapper}>
            <button
              className={`${styles.iconBtn} ${styles.textBtn} ${openMenu === 'speed' ? styles.active : ''}`}
              onClick={() => toggleMenu('speed')}
              title="Playback speed"
            >
              {playbackRate}×
            </button>
            {openMenu === 'speed' && (
              <div className={styles.menu}>
                <div className={styles.menuTitle}>Speed</div>
                {PLAYBACK_RATES.map(r => (
                  <button
                    key={r}
                    className={`${styles.menuItem} ${playbackRate === r ? styles.menuItemActive : ''}`}
                    onClick={() => { onPlaybackRate(r); setOpenMenu(null) }}
                  >
                    <span className={styles.menuItemCheck}>{playbackRate === r ? '✓' : ''}</span>
                    <span>{r === 1 ? 'Normal' : `${r}×`}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info panel toggle */}
          <button className={styles.iconBtn} onClick={onToggleInfo} title="Media info (I)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </button>

          {/* PiP */}
          {'pictureInPictureEnabled' in document && (
            <button className={styles.iconBtn} onClick={onPiP} title="Picture-in-Picture">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor"/>
              </svg>
            </button>
          )}

          {/* Fullscreen */}
          <button className={styles.iconBtn} onClick={onFullscreen} title="Fullscreen (F)">
            {isFullscreen
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                </svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
            }
          </button>
        </div>
      </div>

      {/* Hidden file input for local subtitles */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,.vtt,.ass,.ssa"
        className={styles.hiddenInput}
        onChange={handleSubtitleFileInput}
      />
    </div>
  )
}
