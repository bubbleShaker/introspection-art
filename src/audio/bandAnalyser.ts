import type { Levels } from '../core/levels.ts'
import { BAND_HZ, bandLevel, binRange, type BinRange } from './bands.ts'

/**
 * AnalyserNode を持ち、毎フレーム三つの帯域の強さを読み出す。
 *
 * 音を鳴らすこと（トランスポート）と、音を測ることは変わる理由が別なので
 * AudioEngine から切り離してある。
 */
export class BandAnalyser {
  /** 音声グラフに繋ぐためのノード */
  readonly node: AnalyserNode

  private readonly data: Uint8Array<ArrayBuffer>
  private readonly ranges: Record<keyof Levels, BinRange>

  constructor(context: AudioContext) {
    const node = context.createAnalyser()
    // 2048 だと約 21Hz 刻み。低域を数ビンに分けられる程度には細かく、
    // 毎フレーム走査しても重くない大きさ
    node.fftSize = 2048
    // AnalyserNode 自身も前フレームと混ぜてくれる。ここで軽く効かせておくと
    // 描画側の平滑化が薄くて済む
    node.smoothingTimeConstant = 0.75

    this.node = node
    this.data = new Uint8Array(node.frequencyBinCount)
    this.ranges = {
      low: binRange(BAND_HZ.low[0], BAND_HZ.low[1], context.sampleRate, node.fftSize),
      mid: binRange(BAND_HZ.mid[0], BAND_HZ.mid[1], context.sampleRate, node.fftSize),
      high: binRange(BAND_HZ.high[0], BAND_HZ.high[1], context.sampleRate, node.fftSize),
    }
  }

  read(): Levels {
    this.node.getByteFrequencyData(this.data)
    return {
      low: bandLevel(this.data, this.ranges.low),
      mid: bandLevel(this.data, this.ranges.mid),
      high: bandLevel(this.data, this.ranges.high),
    }
  }
}
