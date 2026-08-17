import './style.css'
import { smooth } from './audio/bands.ts'
import { AudioEngine } from './audio/engine.ts'
import { OnsetDetector } from './audio/onset.ts'
import { probeTrack } from './audio/track.ts'
import { silence, type Levels } from './core/levels.ts'
import { WaterScene } from './scene/waterScene.ts'

/** 同梱の音源。無ければドロップで受け取る */
const BUNDLED_TRACK = `${import.meta.env.BASE_URL}audio/introspection.mp3`

/** 入口が消えるまで(ms)。style.css の transition と揃える */
const OVERLAY_FADE_MS = 1400

/** 音が無い間、これくらいの間隔で水面がひとりでに揺れる(ms) */
const IDLE_SPLASH_INTERVAL_MS = 2600

const canvas = requireElement<HTMLCanvasElement>('#stage')
const overlay = requireElement<HTMLDivElement>('#overlay')
const enterButton = requireElement<HTMLButtonElement>('#enter')
const overlayNote = requireElement<HTMLParagraphElement>('#overlay-note')
const toggleButton = requireElement<HTMLButtonElement>('#toggle')
const status = requireElement<HTMLParagraphElement>('#status')

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const scene = new WaterScene(canvas, { reducedMotion })
const engine = new AudioEngine()
const onset = new OnsetDetector()

/** 生の解析値をならしたもの。これを画に渡す */
const levels: Levels = silence()

let trackReady = false
let started = false
let nextIdleSplashMs = 0

// ---- 起動 ------------------------------------------------------------------

// 入口は読み込みを待たない。待たせると、音源が返ってこない回線で
// 「準備中」のまま画面が二度と開かなくなる
enterButton.disabled = false
enterButton.textContent = 'はじめる'

const bundledTrack = probeTrack(BUNDLED_TRACK).then((found) => {
  if (found) engine.attach(BUNDLED_TRACK)
  trackReady = found
  overlayNote.textContent = found
    ? 'Introspection — Mona Wonderlick'
    : '音源が見つかりません。mp3 をこの画面にドロップすると、その曲で水面が揺れます'
  updateToggleLabel()
  return found
})

enterButton.addEventListener('click', () => {
  void start()
})

toggleButton.addEventListener('click', toggleAudio)

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return
  // ボタンにフォーカスがある時は、ブラウザ既定のクリックに任せて二重発火を避ける
  if (document.activeElement instanceof HTMLButtonElement) return
  event.preventDefault()
  if (!started) void start()
  else toggleAudio()
})

// 音声グラフと objectURL を畳んでからページを離れる
window.addEventListener('pagehide', () => engine.dispose())

async function start(): Promise<void> {
  if (started) return
  started = true
  dismissOverlay()
  // ここで初めて読み込みの結果を待つ。読めていなければ静かな水面のまま
  if (await bundledTrack) await playOrReport()
  updateToggleLabel()
}

/**
 * 入口を閉じる。
 *
 * フェードは見た目のためのもので、消えること自体はトランジションに
 * 委ねない。走らない環境があると、入口が画を覆ったまま残ってしまう。
 */
function dismissOverlay(): void {
  overlay.classList.add('is-hidden')
  window.setTimeout(() => {
    overlay.hidden = true
  }, OVERLAY_FADE_MS)
}

function toggleAudio(): void {
  if (engine.playing) {
    engine.pause()
    updateToggleLabel()
    return
  }
  void playOrReport().finally(updateToggleLabel)
}

/**
 * play() は連打時の中断や自動再生の制限で普通に失敗する。
 * 握り潰さず、失敗したことだけは伝える。
 */
async function playOrReport(): Promise<void> {
  try {
    await engine.play()
  } catch {
    showStatus('音を再生できませんでした')
  }
}

// ---- 音源のドロップ --------------------------------------------------------

window.addEventListener('dragover', (event) => {
  event.preventDefault()
  document.body.classList.add('is-dropping')
})

window.addEventListener('dragleave', (event) => {
  // 子要素をまたぐたびに dragleave が飛ぶ。画面外に出た時だけ解除する
  if (event.relatedTarget !== null) return
  document.body.classList.remove('is-dropping')
})

window.addEventListener('drop', (event) => {
  event.preventDefault()
  document.body.classList.remove('is-dropping')
  const file = event.dataTransfer?.files?.[0]
  if (file) void adoptFile(file)
})

/**
 * 拡張子や MIME で弾かない。type が空になる形式（環境によっては .flac や
 * .opus）があるので、鳴らせるかどうかは実際に再生してみて決める。
 */
async function adoptFile(file: File): Promise<void> {
  engine.attach(file)
  trackReady = true
  started = true
  dismissOverlay()
  try {
    await engine.play()
    showStatus(engine.sourceLabel ?? '')
  } catch {
    showStatus('この音源は再生できませんでした')
  }
  updateToggleLabel()
}

// ---- 毎フレーム ------------------------------------------------------------

function frame(nowMs: number): void {
  const raw = engine.levels()
  // 上がる時は速く、下がる時はゆっくり。音が切れても余韻が水面に残る
  levels.low = smooth(levels.low, raw.low, 0.5, 0.08)
  levels.mid = smooth(levels.mid, raw.mid, 0.35, 0.05)
  levels.high = smooth(levels.high, raw.high, 0.6, 0.12)

  if (engine.playing) {
    const hit = onset.push(raw.low, nowMs)
    if (hit !== null) scene.splash(hit, nowMs)
  } else if (nowMs >= nextIdleSplashMs) {
    // 無音でも水面は生きている。まばらに、弱く落とす
    scene.splash(0.22 + Math.random() * 0.2, nowMs)
    nextIdleSplashMs = nowMs + IDLE_SPLASH_INTERVAL_MS * (0.6 + Math.random() * 0.9)
  }

  scene.draw(levels, nowMs)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// ---- 画面まわり ------------------------------------------------------------

// resize は連続で飛ぶ（モバイルの URL バー伸縮、ウィンドウのドラッグ）。
// 1 フレームにひとつへ畳まないと、その都度キャンバスを 3 枚張り直すことになる
let resizePending = false
window.addEventListener('resize', () => {
  if (resizePending) return
  resizePending = true
  requestAnimationFrame(() => {
    resizePending = false
    scene.resize()
  })
})

function updateToggleLabel(): void {
  toggleButton.hidden = !trackReady
  toggleButton.textContent = engine.playing ? '一時停止' : '再生'
  toggleButton.setAttribute('aria-pressed', String(engine.playing))
}

let statusTimer: number | undefined
function showStatus(message: string): void {
  status.textContent = message
  status.classList.add('is-visible')
  window.clearTimeout(statusTimer)
  statusTimer = window.setTimeout(() => status.classList.remove('is-visible'), 3200)
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`${selector} が見つかりません`)
  return element
}
