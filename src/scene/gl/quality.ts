/**
 * 描くのが追いつかない端末で、絵の細かさを落としていく係。
 *
 * この絵の重さは、ほぼピクセル数に比例する（1 ピクセルごとに視線を飛ばし、
 * 波を 9 枚重ね、空を 2 回引いている）。細かさを 2 から 1 へ落とすだけで
 * 計算量は 1/4 になる。
 *
 * p5 には触らない。ここが返した値を呼び出し側が反映する。
 */

/** 高 DPI で素直に倍率を上げると、ピクセルごとの計算量が跳ねる。2 で頭打ちにする */
export const MAX_PIXEL_DENSITY = 2

/** 落としていける細かさの段階 */
const DENSITY_STEPS = [2, 1.5, 1, 0.75]

/**
 * これより遅いフレームが続いたら、細かさを 1 段落とす(ms)。
 *
 * 30fps ちょうど（33.3ms）のすぐ上に置いてはいけない。見ているのは
 * requestAnimationFrame の間隔であって描画コストそのものではないので、
 * 省電力モードや 30Hz の画面では、描画が軽くても 33ms が定常的に出る。
 * そこを「重い」と読むと、何も問題が無い端末が数秒で最低画質に落ちる。
 */
const SLOW_FRAME_MS = 48

/** 落とすかどうかを決めるのに見るフレーム数 */
const SAMPLE_FRAMES = 45

/**
 * 判定を始めるまでに捨てるフレーム数。
 *
 * 起動直後はシェーダーのコンパイル、音源の読み込み、入口のフェードが
 * 重なって必ず重い。そこを測ると、本来は余裕のある端末まで巻き添えになる。
 */
const WARMUP_FRAMES = 90

/**
 * 端末の DPI から、使える細かさの段階を作る。
 *
 * 先頭が最初に使う値で、後ろへ行くほど粗い。
 */
export function densityLadder(devicePixelRatio: number): number[] {
  const cap = Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, MAX_PIXEL_DENSITY)
  const steps = DENSITY_STEPS.filter((step) => step <= cap)
  return steps.length > 0 ? steps : [cap]
}

export class QualityGovernor {
  private readonly ladder: number[]
  private index = 0
  private warmup = WARMUP_FRAMES
  private readonly samples: number[] = []

  constructor(devicePixelRatio: number) {
    this.ladder = densityLadder(devicePixelRatio)
  }

  /** 今の細かさ */
  get density(): number {
    return this.ladder[this.index]
  }

  /**
   * 1 フレームぶん記録する。落とすべきなら新しい細かさを、
   * そのままでよければ null を返す。
   *
   * 中央値で見ているのは、たまに混じる大きな飛び（タブの切り替え、GC）に
   * 引きずられないため。一度落としたら戻さない。境目のあたりで上げ下げを
   * 繰り返すと、そのたびにキャンバスを作り直して余計に重くなる。
   */
  sample(deltaMs: number): number | null {
    if (deltaMs <= 0) return null
    if (this.warmup > 0) {
      this.warmup--
      return null
    }
    if (this.index >= this.ladder.length - 1) return null

    this.samples.push(deltaMs)
    if (this.samples.length < SAMPLE_FRAMES) return null

    const sorted = [...this.samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    this.samples.length = 0

    if (median <= SLOW_FRAME_MS) return null
    this.index++
    return this.density
  }
}
