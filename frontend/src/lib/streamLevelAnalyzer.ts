/**
 * Analysis-only spectrum pipeline for platforms where Web Audio cannot tap
 * an <audio> element. iOS Safari never exposes live/chunked stream samples
 * to MediaElementAudioSourceNode (WebKit 180696 / 211394), so playback stays
 * on the native element while this fetches the same stream in parallel,
 * decodes it off the playback path and serves levels indexed by the
 * element's currentTime.
 *
 * Supports raw MPEG audio (mp3, layer II/III), ADTS AAC and decodable HLS
 * media segments — the formats used by icecast/shoutcast radio streams.
 */

export type StreamAnalyzerState = "connecting" | "analyzing" | "failed"

export type StreamLevelAnalyzer = {
  readonly state: StreamAnalyzerState
  /** Fill `out` with levels at media time `t` seconds. False if unavailable. */
  read(t: number, out: Float32Array): boolean
  dispose(): void
}

const FFT_SIZE = 2048
const BAND_MIN_HZ = 45
const BAND_MAX_HZ = 14000
const MIN_DB = -100
const MAX_DB = -30
const MAX_HISTORY_SEC = 120
/** Keep showing the newest frame while decode briefly trails playback. */
const EDGE_CLAMP_SEC = 2
/** Bytes tolerated before the first valid audio frame (error pages, garbage). */
const MAX_UNSYNCED_BYTES = 256 * 1024
const MAX_PENDING_BYTES = 8 * 1024 * 1024
const HLS_PLAYLIST_POLL_FLOOR_MS = 1000
const HLS_SEGMENT_HISTORY = 24

const MPEG_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
}
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const BITRATES_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 384]
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const ADTS_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000,
]

type FrameInfo = {
  length: number
  sampleRate: number
  samplesPerFrame: number
}

function parseMpegFrame(b: Uint8Array, off: number): FrameInfo | null {
  if (off + 4 > b.length) return null
  if (b[off] !== 0xff || ((b[off + 1] ?? 0) & 0xe0) !== 0xe0) return null
  const b1 = b[off + 1] ?? 0
  const b2 = b[off + 2] ?? 0
  const version = (b1 >> 3) & 3
  const layer = (b1 >> 1) & 3
  // version 1 reserved; layer 0 reserved; layer 3 (= Layer I) not used by radios
  if (version === 1 || layer === 0 || layer === 3) return null
  const bitrateIdx = (b2 >> 4) & 15
  const srIdx = (b2 >> 2) & 3
  if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) return null
  const sampleRate = MPEG_SAMPLE_RATES[version]?.[srIdx]
  if (!sampleRate) return null
  const padding = (b2 >> 1) & 1
  const isV1 = version === 3
  const isLayer3 = layer === 1
  const table = isV1 ? (isLayer3 ? BITRATES_V1_L3 : BITRATES_V1_L2) : BITRATES_V2
  const bitrate = (table[bitrateIdx] ?? 0) * 1000
  if (!bitrate) return null
  const samplesPerFrame = !isLayer3 ? 1152 : isV1 ? 1152 : 576
  const length = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding
  if (length < 24) return null
  return { length, sampleRate, samplesPerFrame }
}

function parseAdtsFrame(b: Uint8Array, off: number): FrameInfo | null {
  if (off + 7 > b.length) return null
  if (b[off] !== 0xff || ((b[off + 1] ?? 0) & 0xf6) !== 0xf0) return null
  const sampleRate = ADTS_SAMPLE_RATES[((b[off + 2] ?? 0) >> 2) & 15]
  if (!sampleRate) return null
  const length =
    (((b[off + 3] ?? 0) & 3) << 11) |
    ((b[off + 4] ?? 0) << 3) |
    ((b[off + 5] ?? 0) >> 5)
  if (length < 7) return null
  return { length, sampleRate, samplesPerFrame: 1024 }
}

function parseFrame(b: Uint8Array, off: number): FrameInfo | null {
  return parseAdtsFrame(b, off) ?? parseMpegFrame(b, off)
}

function isHlsUrl(url: string) {
  const lower = url.toLowerCase()
  return lower.includes(".m3u8") || lower.includes("playlist.m3u")
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true },
    )
  })
}

type HlsPlaylist = {
  segments: string[]
  variants: string[]
  targetDuration: number
}

function parseHlsPlaylist(text: string, playlistUrl: string): HlsPlaylist {
  const lines = text.split(/\r?\n/)
  const segments: string[] = []
  const variants: string[] = []
  let targetDuration = 2
  let nextUriIsVariant = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      const parsed = Number(line.slice("#EXT-X-TARGETDURATION:".length))
      if (Number.isFinite(parsed) && parsed > 0) targetDuration = parsed
      continue
    }
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      nextUriIsVariant = true
      continue
    }
    if (line.startsWith("#")) continue

    const absolute = new URL(line, playlistUrl).toString()
    if (nextUriIsVariant) {
      variants.push(absolute)
      nextUriIsVariant = false
    } else {
      segments.push(absolute)
    }
  }

  return { segments, variants, targetDuration }
}

/** Find the next offset that parses as a frame AND is confirmed by the next header. */
function findVerifiedSync(b: Uint8Array, from: number): number {
  for (let i = from; i + 8 < b.length; i++) {
    const info = parseFrame(b, i)
    if (!info) continue
    const next = i + info.length
    if (next + 8 > b.length) return -1 // plausible, wait for more data
    if (parseFrame(b, next)) return i
  }
  return -1
}

// ---- FFT (radix-2, real input via full complex transform) ----

const hannWindow = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))
}

const reverseTable = new Uint16Array(FFT_SIZE)
{
  const bits = Math.log2(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    let r = 0
    for (let j = 0; j < bits; j++) r = (r << 1) | ((i >> j) & 1)
    reverseTable[i] = r
  }
}

const fftRe = new Float32Array(FFT_SIZE)
const fftIm = new Float32Array(FFT_SIZE)

function fftInPlace(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 0; i < n; i++) {
    const r = reverseTable[i] ?? 0
    if (r > i) {
      let t = re[i] ?? 0
      re[i] = re[r] ?? 0
      re[r] = t
      t = im[i] ?? 0
      im[i] = im[r] ?? 0
      im[r] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = (-2 * Math.PI) / size
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const angle = step * j
        const wr = Math.cos(angle)
        const wi = Math.sin(angle)
        const k = i + j
        const l = k + half
        const xr = (re[l] ?? 0) * wr - (im[l] ?? 0) * wi
        const xi = (re[l] ?? 0) * wi + (im[l] ?? 0) * wr
        re[l] = (re[k] ?? 0) - xr
        im[l] = (im[k] ?? 0) - xi
        re[k] = (re[k] ?? 0) + xr
        im[k] = (im[k] ?? 0) + xi
      }
    }
  }
}

/** Geometric band edges in bin indices for `barCount` bands. */
function computeBandEdges(barCount: number, sampleRate: number): Uint16Array {
  const nyquist = sampleRate / 2
  const maxHz = Math.min(BAND_MAX_HZ, nyquist * 0.95)
  const edges = new Uint16Array(barCount + 1)
  const ratio = maxHz / BAND_MIN_HZ
  let prev = Math.max(1, Math.round((BAND_MIN_HZ * FFT_SIZE) / sampleRate))
  edges[0] = prev
  for (let i = 1; i <= barCount; i++) {
    const hz = BAND_MIN_HZ * Math.pow(ratio, i / barCount)
    let bin = Math.round((hz * FFT_SIZE) / sampleRate)
    if (bin <= prev) bin = prev + 1
    edges[i] = Math.min(bin, FFT_SIZE / 2)
    prev = edges[i] ?? prev
  }
  return edges
}

export function createStreamLevelAnalyzer(
  url: string,
  barCount: number,
): StreamLevelAnalyzer {
  let state: StreamAnalyzerState = "connecting"
  let disposed = false
  const abort = new AbortController()

  let decodeCtx: AudioContext | null = null
  let pending = new Uint8Array(0)
  let id3Checked = false
  let sampleRate = 0
  let hopSec = 0
  let bandEdges: Uint16Array | null = null

  /** Spectrum frames, one per FFT_SIZE samples; frames[0] is frame #baseFrame. */
  let frames: Float32Array[] = []
  let baseFrame = 0
  let firstChunk = true
  /** Bitstream samples consumed — the authoritative clock (matches element time). */
  let totalSamples = 0
  let decodeChain: Promise<void> = Promise.resolve()
  let smoothed: Float32Array | null = null

  const computeBands = (mono: Float32Array, offset: number, out: Float32Array) => {
    for (let i = 0; i < FFT_SIZE; i++) {
      fftRe[i] = (mono[offset + i] ?? 0) * (hannWindow[i] ?? 0)
      fftIm[i] = 0
    }
    fftInPlace(fftRe, fftIm)
    const edges = bandEdges as Uint16Array
    for (let band = 0; band < barCount; band++) {
      const from = edges[band] ?? 1
      const to = Math.max(from + 1, edges[band + 1] ?? from + 1)
      let sum = 0
      for (let bin = from; bin < to; bin++) {
        const re = fftRe[bin] ?? 0
        const im = fftIm[bin] ?? 0
        sum += Math.sqrt(re * re + im * im)
      }
      // Hann coherent gain 0.5 → amplitude ≈ 4|X|/N, then map like AnalyserNode dB.
      const amp = ((sum / (to - from)) * 4) / FFT_SIZE
      const db = 20 * Math.log10(amp + 1e-9)
      const level = (db - MIN_DB) / (MAX_DB - MIN_DB)
      out[band] = level < 0 ? 0 : level > 1 ? 1 : level
    }
  }

  const analyzeBuffer = (buf: AudioBuffer, chunkStart: number, samples: number) => {
    const len = buf.length
    if (!len || !bandEdges) return
    const ch0 = buf.getChannelData(0)
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null
    const mono = new Float32Array(len)
    if (ch1) {
      for (let i = 0; i < len; i++) mono[i] = ((ch0[i] ?? 0) + (ch1[i] ?? 0)) * 0.5
    } else {
      mono.set(ch0)
    }
    // Decoder priming can make decoded length differ slightly from the
    // bitstream sample count — scale positions so the bitstream clock wins
    // and drift never accumulates against the element's currentTime.
    const scale = len / samples
    let k = Math.ceil(chunkStart / FFT_SIZE)
    const kEnd = Math.floor((chunkStart + samples) / FFT_SIZE)
    if (firstChunk) {
      baseFrame = k
      firstChunk = false
    }
    for (; k < kEnd; k++) {
      // Pad any gap left by an undecodable chunk with the last known frame.
      while (baseFrame + frames.length < k) {
        frames.push(frames[frames.length - 1] ?? new Float32Array(barCount))
      }
      if (baseFrame + frames.length > k) continue
      const src = Math.round((k * FFT_SIZE - chunkStart) * scale)
      const levels = new Float32Array(barCount)
      if (src >= 0 && src + FFT_SIZE <= len) {
        computeBands(mono, src, levels)
      } else if (frames.length) {
        levels.set(frames[frames.length - 1] as Float32Array)
      }
      frames.push(levels)
    }
    const maxFrames = Math.ceil(MAX_HISTORY_SEC / hopSec)
    if (frames.length > maxFrames * 1.5) {
      const drop = frames.length - maxFrames
      frames = frames.slice(drop)
      baseFrame += drop
    }
  }

  const enqueueDecode = (bytes: Uint8Array, samples: number) => {
    decodeChain = decodeChain.then(async () => {
      if (disposed) return
      const chunkStart = totalSamples
      totalSamples += samples
      try {
        decodeCtx ??= new AudioContext()
        const copy = bytes.slice().buffer
        const buf = await decodeCtx.decodeAudioData(copy)
        analyzeBuffer(buf, chunkStart, samples)
        if (state === "connecting") state = "analyzing"
      } catch {
        /* skip undecodable chunk; the bitstream clock already advanced */
      }
    })
  }

  const enqueueDecodedSegment = (bytes: ArrayBuffer) => {
    decodeChain = decodeChain.then(async () => {
      if (disposed) return
      try {
        decodeCtx ??= new AudioContext()
        const buf = await decodeCtx.decodeAudioData(bytes.slice(0))
        if (!sampleRate) {
          sampleRate = buf.sampleRate
          hopSec = FFT_SIZE / sampleRate
          bandEdges = computeBandEdges(barCount, sampleRate)
        }
        const chunkStart = totalSamples
        totalSamples += buf.length
        analyzeBuffer(buf, chunkStart, buf.length)
        if (state === "connecting") state = "analyzing"
      } catch {
        /* Some HLS segment containers/codecs are not decodable by Web Audio. */
      }
    })
  }

  const extractChunks = () => {
    for (;;) {
      const sync = findVerifiedSync(pending, 0)
      if (sync < 0) {
        if (!sampleRate && pending.length > MAX_UNSYNCED_BYTES) state = "failed"
        return
      }
      if (sync > 0) pending = pending.slice(sync)

      // Walk whole frames until ~1s of audio is buffered.
      let off = 0
      let samples = 0
      let info: FrameInfo | null = null
      let target = sampleRate || 44100
      while ((info = parseFrame(pending, off))) {
        if (off + info.length + 8 > pending.length) break
        if (!sampleRate) {
          sampleRate = info.sampleRate
          hopSec = FFT_SIZE / sampleRate
          bandEdges = computeBandEdges(barCount, sampleRate)
          target = sampleRate
        }
        off += info.length
        samples += info.samplesPerFrame
        if (samples >= target) break
      }
      if (samples < target) {
        if (info) return // ran out of buffered bytes — wait for more
        // Corrupt frame mid-walk: flush what parsed cleanly, resync past it.
        if (samples > 0) enqueueDecode(pending.slice(0, off), samples)
        pending = pending.slice(off + 1)
        continue
      }
      const chunk = pending.slice(0, off)
      pending = pending.slice(off)
      enqueueDecode(chunk, samples)
    }
  }

  const ingest = (bytes: Uint8Array) => {
    if (pending.length + bytes.length > MAX_PENDING_BYTES) {
      state = "failed"
      return
    }
    const merged = new Uint8Array(pending.length + bytes.length)
    merged.set(pending)
    merged.set(bytes, pending.length)
    pending = merged
    if (!id3Checked) {
      if (pending.length < 10) return
      if (pending[0] === 0x49 && pending[1] === 0x44 && pending[2] === 0x33) {
        const size =
          (((pending[6] ?? 0) & 127) << 21) |
          (((pending[7] ?? 0) & 127) << 14) |
          (((pending[8] ?? 0) & 127) << 7) |
          ((pending[9] ?? 0) & 127)
        if (pending.length < 10 + size) return
        pending = pending.slice(10 + size)
      }
      id3Checked = true
    }
    extractChunks()
  }

  const fetchNoStore = (resourceUrl: string) =>
    fetch(resourceUrl, {
      signal: abort.signal,
      cache: "no-store",
      credentials: "omit",
    })

  const runRawStream = async () => {
    const res = await fetch(url, {
      signal: abort.signal,
      cache: "no-store",
      credentials: "omit",
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done || disposed) break
      if (value?.length && state !== "failed") ingest(value)
    }
    throw new Error("stream ended")
  }

  const runHlsStream = async () => {
    let playlistUrl = url
    const seenSegments: string[] = []

    for (;;) {
      const playlistRes = await fetchNoStore(playlistUrl)
      if (!playlistRes.ok) throw new Error(`HTTP ${playlistRes.status}`)
      const playlist = parseHlsPlaylist(await playlistRes.text(), playlistUrl)

      if (playlist.variants.length) {
        playlistUrl = playlist.variants[playlist.variants.length - 1] as string
        continue
      }

      for (const segmentUrl of playlist.segments) {
        if (disposed) return
        if (seenSegments.includes(segmentUrl)) continue
        seenSegments.push(segmentUrl)
        while (seenSegments.length > HLS_SEGMENT_HISTORY) seenSegments.shift()

        try {
          const segmentRes = await fetchNoStore(segmentUrl)
          if (!segmentRes.ok) continue
          enqueueDecodedSegment(await segmentRes.arrayBuffer())
        } catch {
          if (disposed) return
        }
      }

      const pollMs = Math.max(
        HLS_PLAYLIST_POLL_FLOOR_MS,
        (playlist.targetDuration * 1000) / 2,
      )
      await sleep(pollMs, abort.signal)
    }
  }

  const run = isHlsUrl(url) ? runHlsStream : runRawStream

  run().catch(() => {
    if (!disposed) state = "failed"
  })

  return {
    get state() {
      return state
    },
    read(t: number, out: Float32Array) {
      if (!frames.length || !hopSec) return false
      let rel = Math.floor(t / hopSec) - baseFrame
      const last = frames.length - 1
      if (rel < 0) rel = 0
      if (rel > last) {
        if ((rel - last) * hopSec > EDGE_CLAMP_SEC) return false
        rel = last
      }
      const target = frames[rel] as Float32Array
      if (!smoothed || smoothed.length !== barCount) {
        smoothed = new Float32Array(target)
      }
      for (let i = 0; i < barCount; i++) {
        const s = (smoothed[i] ?? 0) * 0.7 + (target[i] ?? 0) * 0.3
        smoothed[i] = s
        out[i] = s
      }
      return true
    },
    dispose() {
      disposed = true
      state = "failed"
      abort.abort()
      frames = []
      pending = new Uint8Array(0)
      const ctx = decodeCtx
      decodeCtx = null
      if (ctx && ctx.state !== "closed") void ctx.close()
    },
  }
}
