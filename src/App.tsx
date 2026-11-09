import { useState } from 'react'
import HomePage from './ui/components/HomePage'
import PlayerPage from './ui/components/PlayerPage'
import './ui/styles/global.css'

export default function App() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null)

  const handlePlay = (url: string, subUrl: string | null) => {
    setVideoUrl(url)
    setSubtitleUrl(subUrl)
  }

  const handleBack = () => {
    setVideoUrl(null)
    setSubtitleUrl(null)
  }

  if (videoUrl) {
    return (
      <PlayerPage
        videoUrl={videoUrl}
        subtitleUrl={subtitleUrl}
        onBack={handleBack}
      />
    )
  }

  return <HomePage onPlay={handlePlay} />
}
