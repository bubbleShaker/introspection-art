import { BAND_HZ, bandLevel, binRange, type BinRange, type Levels } from './bands.ts'

/**
 * 音源の再生と解析をまとめて持つ。
 *
 * <audio> 要素を噛ませているのは、mp3 全体をメモリに展開せずに
 * 流し始められること、ループや一時停止をブラウザ任せにできることによる。
 * その音を MediaElementAudioSourceNode で Web Audio 側に引き込み、
 * AnalyserNode を通してからスピーカーへ返す。
 *
 *   <audio> → MediaElementSource → Analyser → destination
 */
export class AudioEngine {
  private readonly element: HTMLAudioElement
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0)
  private ranges: Record<keyof Levels, BinRange> | null = null
  private objectUrl: string | null = null

  constructor() {
    this.element = new Audio()
    this.element.loop = true
    this.element.crossOrigin = 'anonymous'
    this.element.preload = 'auto'
  }

  get playing(): boolean {
    return !this.element.paused && !this.element.ended
  }

  /** 今読み込まれている音源の表示名（無ければ null） */
  sourceLabel: string | null = null

  /**
   * 音源を差し替える。URL でも、ドロップされた File でもよい。
   * 読み込めたかどうかを返し、呼び出し側が表示を切り替えられるようにする。
   */
  async load(source: string | File): Promise<boolean> {
    this.revokeObjectUrl()

    if (typeof source === 'string') {
      this.element.src = source
      this.sourceLabel = source.split('/').pop() ?? source
    } else {
      this.objectUrl = URL.createObjectURL(source)
      this.element.src = this.objectUrl
      this.sourceLabel = source.name
    }

    return await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        this.element.removeEventListener('canplay', onReady)
        this.element.removeEventListener('error', onError)
        resolve(ok)
      }
      const onReady = () => done(true)
      const onError = () => done(false)
      this.element.addEventListener('canplay', onReady, { once: true })
      this.element.addEventListener('error', onError, { once: true })
      this.element.load()
    })
  }

  /**
   * 再生する。AudioContext はユーザー操作の中でしか始められないため、
   * 配線もこの中で初めて行う。
   */
  async play(): Promise<void> {
    this.ensureGraph()
    if (this.context?.state === 'suspended') await this.context.resume()
    await this.element.play()
  }

  pause(): void {
    this.element.pause()
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause()
    else await this.play()
  }

  /** 現在の帯域ごとの強さ。解析器が無い／止まっている間はすべて 0 */
  levels(): Levels {
    if (!this.analyser || !this.ranges || !this.playing) {
      return { low: 0, mid: 0, high: 0 }
    }
    this.analyser.getByteFrequencyData(this.freqData)
    return {
      low: bandLevel(this.freqData, this.ranges.low),
      mid: bandLevel(this.freqData, this.ranges.mid),
      high: bandLevel(this.freqData, this.ranges.high),
    }
  }

  dispose(): void {
    this.pause()
    this.revokeObjectUrl()
    void this.context?.close()
  }

  private ensureGraph(): void {
    if (this.context) return

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    // 2048 だと約 21Hz 刻み。低域を数ビンに分けられる程度には細かく、
    // 毎フレーム走査しても重くない大きさ
    analyser.fftSize = 2048
    // AnalyserNode 自身も前フレームと混ぜてくれる。ここで軽く効かせておくと
    // 描画側の平滑化が薄くて済む
    analyser.smoothingTimeConstant = 0.75

    // MediaElementSource は同じ要素に対して一度しか作れない。
    // context ごと使い回すので、ここが唯一の生成箇所になる
    context.createMediaElementSource(this.element).connect(analyser)
    analyser.connect(context.destination)

    this.context = context
    this.analyser = analyser
    this.freqData = new Uint8Array(analyser.frequencyBinCount)
    this.ranges = {
      low: binRange(BAND_HZ.low[0], BAND_HZ.low[1], context.sampleRate, analyser.fftSize),
      mid: binRange(BAND_HZ.mid[0], BAND_HZ.mid[1], context.sampleRate, analyser.fftSize),
      high: binRange(BAND_HZ.high[0], BAND_HZ.high[1], context.sampleRate, analyser.fftSize),
    }
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return
    URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }
}
