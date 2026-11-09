import { SubtitleCue, SubtitleStyle } from '../../types'
import styles from './SubtitleOverlay.module.css'

interface Props {
  cues: SubtitleCue[]
  style: SubtitleStyle
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

export default function SubtitleOverlay({ cues, style }: Props) {
  if (cues.length === 0) return null

  const {
    fontFamily = 'sans-serif',
    fontSize = 22,
    color = '#ffffff',
    backgroundColor = '#000000',
    backgroundOpacity = 0.6,
    position = 'bottom',
    outline = true,
    shadow = false,
  } = style

  const bgColor = `rgba(${hexToRgb(backgroundColor)}, ${backgroundOpacity})`
  const textShadow = [
    outline ? '1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000' : '',
    shadow ? '2px 4px 8px rgba(0,0,0,0.8)' : '',
  ].filter(Boolean).join(', ')

  return (
    <div className={`${styles.overlay} ${position === 'top' ? styles.top : styles.bottom}`}>
      {cues.map((cue, i) => (
        <div
          key={`${cue.start}-${i}`}
          className={styles.cue}
          style={{
            fontFamily,
            fontSize: `${fontSize}px`,
            color,
            backgroundColor: backgroundOpacity > 0 ? bgColor : 'transparent',
            textShadow: textShadow || undefined,
          }}
        >
          {cue.text.split('\n').map((line, li) => (
            <span key={li}>
              {line}
              {li < cue.text.split('\n').length - 1 && <br />}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
