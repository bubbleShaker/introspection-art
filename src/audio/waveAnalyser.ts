import { foldWaveform } from './waveform.ts'

/**
 * AnalyserNode を持ち、毎フレーム時間領域の波形を読み出す。
 *
 * BandAnalyser（帯域の強さ）と分けてあるのは、測っているものが別だから。
 * 片方の都合（FFT の細かさ、前フレームとの混ぜ具合）でもう片方の見え方が
 * 変わってほしくない。ノードを二つ持つ費用はごく小さい。
 */
export class WaveAnalyser {
  /** 音声グラフに繋ぐためのノード */
  readonly node: AnalyserNode

  private readonly data: Uint8Array<ArrayBuffer>

  constructor(context: AudioContext) {
    const node = context.createAnalyser()
    // 44.1kHz で約 23ms ぶん。長くすると一度に見える波の数が増えて
    // 輪郭が細かくなりすぎ、短くすると形がフレームごとに跳ねる
    node.fftSize = 1024
    // smoothingTimeConstant は周波数データにしか効かない。時間領域を
    // ならすのは描く側（main.ts）の仕事なので、ここでは何もしない

    this.node = node
    this.data = new Uint8Array(node.fftSize)
  }

  /** 今の波形を out へ書き出す。値域は -1..1 */
  read(out: Float32Array): void {
    this.node.getByteTimeDomainData(this.data)
    foldWaveform(this.data, out)
  }
}
