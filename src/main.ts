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
const pickButton = requireElement<HTMLButtonElement>('#pick')
const fileInput = requireElement<HTMLInputElement>('#file')
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

/**
 * 今どこから来た音源を持っているか。
 *
 * 同梱の音源が在るかの確認は通信なので、いつ返るか分からない。その間に
 * ユーザーが自分の音源を渡していることがあり、あとから来た確認結果で
 * それを上書きしてはいけない。渡されたものが常に優先する。
 */
let trackFrom: 'none' | 'bundled' | 'user' = 'none'

/**
 * 音源を採り込んだ回数。続けて渡された時、古い呼び出しの後始末が
 * 新しい音源の表示を書き換えないようにするための番号。
 */
let adoptions = 0

/** 音源は持っているが、まだ鳴り始めていない */
let preparing = false

// ---- 起動 ------------------------------------------------------------------

// 入口は読み込みを待たない。待たせると、音源が返ってこない回線で
// 「準備中」のまま画面が二度と開かなくなる
enterButton.disabled = false
enterButton.textContent = 'はじめる'

const bundledTrack = probeTrack(BUNDLED_TRACK).then((found) => {
  // 待っている間にユーザーが音源を渡していたら、それを奪わない
  if (trackFrom === 'user') return false

  if (found) {
    engine.attach(BUNDLED_TRACK)
    trackFrom = 'bundled'
  }
  trackReady = found
  overlayNote.textContent = found
    ? 'Introspection — Mona Wonderlick'
    : '音源が見つかりません。下の「音源を選ぶ」から、手元の曲で水面を揺らせます'
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

// ---- 音源のファイル選択 ----------------------------------------------------

pickButton.addEventListener('click', () => fileInput.click())

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  // 選ばずに閉じた時は files が空。何もしない
  if (!file) return
  // 同じ音源をもう一度選んだ時にも change が飛ぶよう、値を空に戻しておく。
  // File は上で受け取り済みで、入力を空にしても中身は失われない
  fileInput.value = ''
  void adoptFile(file)
})

/**
 * 受け取った音源を採り込む。ドロップとファイル選択の共通の受け口。
 *
 * ここでは拡張子や MIME で弾かない。type が空になる形式（環境によっては
 * .flac や .opus）があるので、鳴らせるかどうかは実際に再生してみて決める。
 * ファイル選択の accept はあくまで候補を絞る入口の便宜で、検証ではない。
 */
async function adoptFile(file: File): Promise<void> {
  const adoption = ++adoptions
  engine.attach(file)
  trackFrom = 'user'
  trackReady = true
  started = true
  preparing = true
  dismissOverlay()
  // 再生が始まるのを待たずに操作を出す。音の準備は環境によって数秒かかることが
  // あり、その間ボタンが無いと「渡せたのかどうか」が分からない
  updateToggleLabel()

  let message: string
  try {
    await engine.play()
    message = engine.sourceLabel ?? ''
  } catch {
    message = 'この音源は再生できませんでした'
  }

  // 待っている間に別の音源が渡されていたら、古い結果は表に出さない
  if (adoption !== adoptions) return
  preparing = false
  updateToggleLabel()
  if (message) showStatus(message)
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
  // 鳴り始めるまでは押させない。「再生」と出したまま押せると、
  // 始まりかけの再生にもう一本重ねてしまう
  toggleButton.disabled = preparing
  toggleButton.textContent = preparing ? '準備中' : engine.playing ? '一時停止' : '再生'
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
