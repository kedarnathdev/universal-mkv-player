import { MediaInfo } from '../../types'
import { formatBitrate, formatChannels, formatFileSize, formatTime, getCodecDisplayName } from '../../utils/helpers'
import styles from './MediaInfoPanel.module.css'

interface Props {
  mediaInfo: MediaInfo | null
  currentTime: number
  onClose: () => void
}

export default function MediaInfoPanel({ mediaInfo, currentTime, onClose }: Props) {
  if (!mediaInfo) return null

  const { format, fileSize, duration, videoTrack, audioTracks, subtitleTracks } = mediaInfo

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span className={styles.title}>Media Information</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} title="Close">✕</button>
      </div>

      <div className={styles.content}>
        {/* Container */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Container</h4>
          <div className={styles.grid}>
            <span className={styles.label}>Format</span>
            <span className={styles.value}>{format.toUpperCase()}</span>

            <span className={styles.label}>Duration</span>
            <span className={styles.value}>{duration ? formatTime(duration) : 'Unknown'}</span>

            <span className={styles.label}>Current Time</span>
            <span className={styles.value}>{formatTime(currentTime)}</span>

            <span className={styles.label}>File Size</span>
            <span className={styles.value}>{formatFileSize(fileSize)}</span>
          </div>
        </section>

        {/* Video Track */}
        {videoTrack && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Video Track</h4>
            <div className={styles.grid}>
              <span className={styles.label}>Codec</span>
              <span className={styles.value}>{getCodecDisplayName(videoTrack.codec)}</span>

              <span className={styles.label}>Resolution</span>
              <span className={styles.value}>{videoTrack.width} × {videoTrack.height}</span>

              <span className={styles.label}>Frame Rate</span>
              <span className={styles.value}>
                {videoTrack.frameRate ? `${videoTrack.frameRate.toFixed(2)} fps` : 'Unknown'}
              </span>

              <span className={styles.label}>Bitrate</span>
              <span className={styles.value}>{formatBitrate(videoTrack.bitrate)}</span>

              <span className={styles.label}>HDR</span>
              <span className={styles.value}>{videoTrack.hdr ? 'Yes' : 'No (SDR)'}</span>
            </div>
          </section>
        )}

        {/* Audio Tracks */}
        {audioTracks.length > 0 && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Audio Tracks ({audioTracks.length})</h4>
            <div className={styles.trackList}>
              {audioTracks.map((track) => (
                <div key={track.id} className={styles.trackCard}>
                  <div className={styles.trackHeader}>
                    <span className={styles.trackName}>
                      Track {track.number}: {track.language}
                      {track.name ? ` (${track.name})` : ''}
                    </span>
                    {track.isDefault && <span className={styles.defaultBadge}>Default</span>}
                  </div>
                  <div className={styles.grid}>
                    <span className={styles.label}>Codec</span>
                    <span className={styles.value}>{getCodecDisplayName(track.codec)}</span>

                    <span className={styles.label}>Channels</span>
                    <span className={styles.value}>{formatChannels(track.channels)} ({track.channels}ch)</span>

                    <span className={styles.label}>Sample Rate</span>
                    <span className={styles.value}>{(track.sampleRate / 1000).toFixed(1)} kHz</span>

                    <span className={styles.label}>Browser Support</span>
                    <span className={`${styles.value} ${track.canDecode ? styles.supported : styles.unsupported}`}>
                      {track.canDecode ? 'Decodable' : 'Unsupported'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Subtitle Tracks */}
        {subtitleTracks.length > 0 && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Subtitle Tracks ({subtitleTracks.length})</h4>
            <div className={styles.trackList}>
              {subtitleTracks.map((sub) => (
                <div key={sub.id} className={styles.trackCard}>
                  <div className={styles.trackHeader}>
                    <span className={styles.trackName}>{sub.name || sub.language}</span>
                    <span className={styles.defaultBadge}>{sub.format.toUpperCase()}</span>
                  </div>
                  <div className={styles.grid}>
                    <span className={styles.label}>Source</span>
                    <span className={styles.value}>{sub.source}</span>
                    <span className={styles.label}>Language</span>
                    <span className={styles.value}>{sub.language}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
