import { useState, useRef } from 'react'
import { validateVideoUrl } from '../../utils/helpers'
import styles from './HomePage.module.css'

interface Props {
  onPlay: (url: string, subtitleUrl: string | null) => void
}

const HISTORY_KEY = 'mkv-player-history'

interface HistoryEntry {
  url: string
  title: string
  timestamp: number
}

function getHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch { return [] }
}

function saveToHistory(url: string): void {
  const history = getHistory().filter(e => e.url !== url)
  const entry: HistoryEntry = {
    url,
    title: decodeURIComponent(url.split('/').pop() ?? url).slice(0, 60),
    timestamp: Date.now(),
  }
  history.unshift(entry)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)))
}

function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}

export default function HomePage({ onPlay }: Props) {
  const [url, setUrl] = useState('')
  const [subtitleUrl, setSubtitleUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(getHistory)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)

  const handlePlay = () => {
    const trimmed = url.trim()
    if (!trimmed) {
      setUrlError('Please enter a video URL.')
      urlRef.current?.focus()
      return
    }
    const { valid, error } = validateVideoUrl(trimmed)
    if (!valid) {
      setUrlError(error ?? 'Invalid URL.')
      return
    }
    setUrlError(null)
    saveToHistory(trimmed)
    setHistory(getHistory())
    onPlay(trimmed, subtitleUrl.trim() || null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePlay()
  }

  const handleHistoryPlay = (entry: HistoryEntry) => {
    setUrl(entry.url)
    onPlay(entry.url, null)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" fill="#7c3aed"/>
            <polygon points="20,15 20,33 35,24" fill="white"/>
            <circle cx="13" cy="24" r="4" fill="#c4b5fd"/>
          </svg>
          <span className={styles.logoText}>MKV Player</span>
        </div>
        <p className={styles.tagline}>Universal web video player with multi-track audio &amp; subtitle support</p>
      </header>

      <main className={styles.main}>
        <section className={styles.inputSection}>
          <div className={styles.inputGroup}>
            <label className={styles.label} htmlFor="video-url">
              Video URL
            </label>
            <div className={styles.inputRow}>
              <input
                ref={urlRef}
                id="video-url"
                className={`${styles.input} ${urlError ? styles.inputError : ''}`}
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setUrlError(null) }}
                onKeyDown={handleKeyDown}
                placeholder="https://example.com/video.mkv"
                spellCheck={false}
                autoComplete="off"
              />
              <button className={styles.playBtn} onClick={handlePlay}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
                Play
              </button>
            </div>
            {urlError && <p className={styles.errorMsg}>{urlError}</p>}
          </div>

          <button
            className={styles.advancedToggle}
            onClick={() => setShowAdvanced(v => !v)}
            type="button"
          >
            {showAdvanced ? '▾' : '▸'} Advanced options
          </button>

          {showAdvanced && (
            <div className={styles.advancedPanel}>
              <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="subtitle-url">
                  External Subtitle URL (optional)
                </label>
                <input
                  id="subtitle-url"
                  className={styles.input}
                  type="url"
                  value={subtitleUrl}
                  onChange={e => setSubtitleUrl(e.target.value)}
                  placeholder="https://example.com/subtitles.srt"
                  spellCheck={false}
                />
                <p className={styles.hint}>Supports .srt, .vtt, .ass, .ssa</p>
              </div>
            </div>
          )}
        </section>

        <section className={styles.formatInfo}>
          <h2 className={styles.sectionTitle}>Supported formats</h2>
          <div className={styles.badgeRow}>
            {['MKV', 'MP4', 'WebM', 'MOV', 'TS'].map(f => (
              <span key={f} className={styles.badge}>{f}</span>
            ))}
          </div>
          <div className={styles.codecGrid}>
            <div className={styles.codecGroup}>
              <h3>Video</h3>
              <ul>
                <li>H.264 / AVC</li>
                <li>H.265 / HEVC *</li>
                <li>VP9</li>
                <li>AV1</li>
              </ul>
            </div>
            <div className={styles.codecGroup}>
              <h3>Audio</h3>
              <ul>
                <li>AAC</li>
                <li>Opus</li>
                <li>MP3</li>
                <li>FLAC</li>
                <li>AC-3 / DTS †</li>
              </ul>
            </div>
            <div className={styles.codecGroup}>
              <h3>Subtitles</h3>
              <ul>
                <li>SRT</li>
                <li>WebVTT</li>
                <li>ASS / SSA</li>
                <li>External files</li>
              </ul>
            </div>
          </div>
          <p className={styles.footnote}>* HEVC requires hardware support in browser. † AC-3/DTS may require server-side transcoding.</p>
        </section>

        {history.length > 0 && (
          <section className={styles.historySection}>
            <div className={styles.historyHeader}>
              <h2 className={styles.sectionTitle}>Recently played</h2>
              <button
                className={styles.clearBtn}
                onClick={() => { clearHistory(); setHistory([]) }}
              >
                Clear
              </button>
            </div>
            <ul className={styles.historyList}>
              {history.map(entry => (
                <li key={entry.url} className={styles.historyItem}>
                  <button
                    className={styles.historyBtn}
                    onClick={() => handleHistoryPlay(entry)}
                    title={entry.url}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={styles.historyIcon}>
                      <polygon points="5,3 19,12 5,21"/>
                    </svg>
                    <span className={styles.historyTitle}>{entry.title}</span>
                    <span className={styles.historyTime}>
                      {new Date(entry.timestamp).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className={styles.footer}>
        <p>Direct browser streaming · No server upload required · CORS-aware</p>
      </footer>
    </div>
  )
}
