import { silence, type Levels } from '../core/levels.ts'
import { BandAnalyser } from './bandAnalyser.ts'

/**
 * 音源の再生を受け持つ。解析そのものは BandAnalyser に任せる。
 *
 * <audio> 要素を噛ませているのは、mp3 全体をメモリに展開せずに
 * 流し始められること、ループや一時停止をブラウザ任せにできることによる。
 * その音を MediaElementAudioSourceNode で Web Audio 側に引き込み、
 * 解析ノードを通してからスピーカーへ返す。
 *
 *   <audio> → MediaElementSource → Analyser → destination
 */
export class AudioEngine {
  private readonly element: HTMLAudioElement
  private context: AudioContext | null = null
  private analyser: BandAnalyser | null = null
  private objectUrl: string | null = null
  private label: string | null = null
  /** play() が通ったか。paused だけでは失敗直後を見分けられない */
  private startedPlaying = false
  /** play() を呼んで、まだ答えが返っていない */
  private startingPlayback = false

  /**
   * 状態が変わった時に呼ばれる。
   *
   * 再生は、こちらが頼まなくても止まる（OS のメディア操作、イヤホンを抜く、
   * 再生中のエラー）。呼び出し側がそれを知る手立てが無いと、ボタンの表示だけが
   * 古いまま残る。
   */
  onChange: (() => void) | null = null

  constructor() {
    this.element = new Audio()
    this.element.loop = true
    this.element.crossOrigin = 'anonymous'
    this.element.preload = 'auto'

    // 事実は要素の側にある。こちらの記録を、起きたことで随時直す
    this.element.addEventListener('playing', () => this.settle(true))
    for (const event of ['pause', 'error', 'emptied', 'ended']) {
      this.element.addEventListener(event, () => this.settle(false))
    }
  }

  /** 再生を始めようとしている最中か */
  get starting(): boolean {
    return this.startingPlayback
  }

  /**
   * 鳴っているか。
   *
   * element.paused だけでは足りない。play() は呼ばれた時点で一旦 paused を
   * 下ろし、鳴らせないと分かってから戻すため、失敗直後に覗くと「鳴っている」と
   * 誤って答える。実際に開始できたかを自分で覚えておき、その上で今の状態を見る。
   */
  get playing(): boolean {
    return this.startedPlaying && !this.element.paused && !this.element.ended
  }

  /** 今読み込まれている音源の表示名（無ければ null） */
  get sourceLabel(): string | null {
    return this.label
  }

  /**
   * 音源を繋ぐ。URL でも、ドロップされた File でもよい。
   *
   * 読み込みの完了は待たない。待つ設計にすると、遅い回線でその間ずっと
   * 画面を止めることになり、しかも「読めたか」の判定を誤りやすい。
   * 実際に鳴らせるかどうかは play() が投げるかどうかで分かる。
   */
  attach(source: string | File): void {
    this.revokeObjectUrl()
    this.settle(false)

    if (typeof source === 'string') {
      this.element.src = source
      this.label = source.split('/').pop() ?? source
    } else {
      this.objectUrl = URL.createObjectURL(source)
      this.element.src = this.objectUrl
      this.label = source.name
    }
  }

  /**
   * 再生する。AudioContext はユーザー操作の中でしか始められないため、
   * 配線もこの中で初めて行う。
   */
  async play(): Promise<void> {
    // 開始を頼んでいる最中にもう一度頼まない。二本目が中断で落ちて
    // 「再生できませんでした」と誤って伝えることになる
    if (this.startingPlayback) return

    this.ensureGraph()
    this.startingPlayback = true
    try {
      if (this.context?.state === 'suspended') await this.context.resume()
      await this.element.play()
      this.settle(true)
    } catch (error) {
      this.settle(false)
      throw error
    } finally {
      this.startingPlayback = false
    }
  }

  pause(): void {
    this.element.pause()
    this.settle(false)
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause()
    else await this.play()
  }

  /** 現在の帯域ごとの強さ。解析器が無い／止まっている間はすべて 0 */
  levels(): Levels {
    if (!this.analyser || !this.playing) return silence()
    return this.analyser.read()
  }

  /**
   * 後始末。ページを離れる時に呼ぶ。
   *
   * これを呼んだ engine は作り直すしかない。MediaElementSource は
   * ひとつの <audio> に対して一度しか作れないためで、配線し直しはできない。
   * 参照を落としているのは、閉じたコンテキストが残っていると play() が
   * 配線済みと勘違いして無音のまま再生してしまうのを防ぐため。
   */
  dispose(): void {
    this.pause()
    this.revokeObjectUrl()
    const context = this.context
    this.context = null
    this.analyser = null
    void context?.close()
  }

  private ensureGraph(): void {
    if (this.context) return

    const context = new AudioContext()
    const analyser = new BandAnalyser(context)

    // MediaElementSource は同じ要素に対して一度しか作れない。
    // context ごと使い回すので、ここが唯一の生成箇所になる
    context.createMediaElementSource(this.element).connect(analyser.node)
    analyser.node.connect(context.destination)

    this.context = context
    this.analyser = analyser
  }

  /** 鳴っているかの記録を更新し、変わっていれば呼び出し側に知らせる */
  private settle(playing: boolean): void {
    if (this.startedPlaying === playing) return
    this.startedPlaying = playing
    this.onChange?.()
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return
    URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = null
  }
}
