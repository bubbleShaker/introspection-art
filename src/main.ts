import './style.css'
import { smooth, type Levels } from './audio/bands.ts'
import { AudioEngine } from './audio/engine.ts'
import { OnsetDetector } from './audio/onset.ts'
import { WaterScene } from './scene/waterScene.ts'

/** 同梱の音源。無ければドロップで受け取る */
const BUNDLED_TRACK = `${import.meta.env.BASE_URL}audio/introspection.mp3`

/** 音が無い間、これくらいの間隔で水面がひとりでに揺れる(ms) */
const IDLE_SPLASH_INTERVAL_MS = 2600

const canvas = requireElement<HTMLCanvasElement>('#stage')
const overlay = requireElement<HTMLDivElement>('#overlay')
const enterButton = requireElement<HTMLButtonElement>('#enter')
const overlayNote = requireElement<HTMLParagraphElement>('#overlay-note')
const toggleButton = requireElement<HTMLButtonElement>('#toggle')
const status = requireElement<HTMLParagraphElement>('#status')

const scene = new WaterScene(canvas)
const engine = new AudioEngine()
const onset = new OnsetDetector()

/** 生の解析値をならしたもの。これを画に渡す */
const levels: Levels = { low: 0, mid: 0, high: 0 }

let trackReady = false
let started = false
let nextIdleSplashMs = 0

// ---- 起動 ------------------------------------------------------------------

void (async () => {
  trackReady = await engine.load(BUNDLED_TRACK)
  if (trackReady) {
    enterButton.textContent = '再生する'
    overlayNote.textContent = 'Introspection — Mona Wonderlick'
  } else {
    enterButton.textContent = 'そのまま見る'
    overlayNote.textContent =
      '音源が見つかりません。mp3 をこの画面にドロップすると、その曲で水面が揺れます'
  }
  enterButton.disabled = false
})()

enterButton.addEventListener('click', () => {
  void start()
})

toggleButton.addEventListener('click', () => {
  void engine.toggle().then(updateToggleLabel)
})

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return
  // ボタンにフォーカスがある時は、ブラウザ既定のクリックに任せて二重発火を避ける
  if (document.activeElement instanceof HTMLButtonElement) return
  event.preventDefault()
  if (!started) void start()
  else void engine.toggle().then(updateToggleLabel)
})

async function start(): Promise<void> {
  if (started) return
  started = true
  overlay.classList.add('is-hidden')
  if (trackReady) {
    await engine.play().catch(() => undefined)
  }
  updateToggleLabel()
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
  if (!file) return
  if (!file.type.startsWith('audio/')) {
    showStatus('音声ファイルを渡してください')
    return
  }
  void adoptFile(file)
})

async function adoptFile(file: File): Promise<void> {
  const ok = await engine.load(file)
  if (!ok) {
    showStatus('この形式は読み込めませんでした')
    return
  }
  trackReady = true
  started = true
  overlay.classList.add('is-hidden')
  await engine.play().catch(() => undefined)
  updateToggleLabel()
  showStatus(`▶ ${engine.sourceLabel ?? ''}`)
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

window.addEventListener('resize', () => scene.resize())

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
