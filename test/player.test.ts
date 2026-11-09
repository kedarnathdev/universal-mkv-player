import { parseSrt, parseVtt, parseAss } from '../src/utils/subtitleParsers.ts'
import { validateVideoUrl, formatTime, formatFileSize, getLanguageName } from '../src/utils/helpers.ts'

let passed = 0
let failed = 0

function assert(cond: boolean, name: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: ${name}`)
  }
}

console.log('--- Testing Helpers ---')
assert(formatTime(0) === '0:00', 'formatTime(0) == 0:00')
assert(formatTime(65) === '1:05', 'formatTime(65) == 1:05')
assert(formatTime(3665) === '1:01:05', 'formatTime(3665) == 1:01:05')
assert(formatFileSize(1024) === '1.0 KB', 'formatFileSize(1024) == 1.0 KB')
assert(formatFileSize(1048576) === '1.0 MB', 'formatFileSize(1048576) == 1.0 MB')
assert(getLanguageName('eng') === 'English', 'getLanguageName(eng) == English')
assert(getLanguageName('jpn') === 'Japanese', 'getLanguageName(jpn) == Japanese')
assert(getLanguageName('tel') === 'Telugu', 'getLanguageName(tel) == Telugu')

console.log('--- Testing URL Validation (SSRF protection) ---')
assert(validateVideoUrl('https://example.com/video.mkv').valid === true, 'Public HTTPS MKV valid')
assert(validateVideoUrl('http://example.com/stream.mkv').valid === true, 'Public HTTP valid')
assert(validateVideoUrl('http://localhost/video.mkv').valid === false, 'Block localhost')
assert(validateVideoUrl('http://127.0.0.1:8080/v.mkv').valid === false, 'Block 127.0.0.1')
assert(validateVideoUrl('http://10.0.0.1/test.mkv').valid === false, 'Block 10.x private range')
assert(validateVideoUrl('http://192.168.1.100/test.mkv').valid === false, 'Block 192.168.x')
assert(validateVideoUrl('http://169.254.169.254/meta').valid === false, 'Block cloud metadata endpoint')
assert(validateVideoUrl('ftp://example.com/video.mkv').valid === false, 'Block non-HTTP(S) protocols')

console.log('--- Testing Subtitle Parsers ---')
const sampleSrt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:08,200
Second subtitle line
with multiple lines
`
const srtCues = parseSrt(sampleSrt)
assert(srtCues.length === 2, 'SRT parsed 2 cues')
assert(srtCues[0].start === 1.0, 'SRT cue 1 start is 1.0s')
assert(srtCues[0].end === 4.0, 'SRT cue 1 end is 4.0s')
assert(srtCues[0].text === 'Hello world', 'SRT cue 1 text matches')
assert(srtCues[1].start === 5.5, 'SRT cue 2 start is 5.5s')

const sampleVtt = `WEBVTT

00:01.000 --> 00:04.000
VTT subtitle 1

00:01:05.500 --> 00:01:08.200 line:80%
VTT subtitle 2
`
const vttCues = parseVtt(sampleVtt)
assert(vttCues.length === 2, 'VTT parsed 2 cues')
assert(vttCues[0].start === 1.0, 'VTT cue 1 start is 1.0s')
assert(vttCues[1].start === 65.5, 'VTT cue 2 start is 65.5s')

const sampleAss = `[Script Info]
Title: Sample ASS
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.50,0:00:04.20,Default,,0,0,0,,{\\pos(192,200)}ASS styled text
Dialogue: 0,0:00:06.00,0:00:09.00,Default,,0,0,0,,Line 1\\NLine 2
`
const assCues = parseAss(sampleAss)
assert(assCues.length === 2, 'ASS parsed 2 cues')
assert(assCues[0].start === 1.5, 'ASS cue 1 start is 1.5s')
assert(assCues[0].end === 4.2, 'ASS cue 1 end is 4.2s')
assert(assCues[0].text === 'ASS styled text', 'ASS tags stripped from cue text')
assert(assCues[1].text === 'Line 1\nLine 2', 'ASS \\N converted to newline')

console.log(`\nResults: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
