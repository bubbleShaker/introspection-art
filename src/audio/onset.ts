/**
 * 低域の「打点」を拾う。波紋を落とすきっかけになる。
 *
 * やっていることは単純で、直近の平均より目立って大きい山が来たら
 * 一発とみなす。閾値を固定値にすると曲の音量差でまったく鳴らないか
 * 鳴りっぱなしになるので、平均に対する倍率で見ている。
 */
export type OnsetOptions = {
  /** 直近平均に対して何倍を超えたら打点とみなすか */
  ratio: number
  /** 静かな場面での誤検出を切る下限（0..1） */
  floor: number
  /** 一度鳴ってから次を許すまでの間隔(ms)。連打を防ぐ */
  refractoryMs: number
  /** 平均の追従の速さ（0..1）。小さいほど過去を長く覚える */
  averageRate: number
}

export const DEFAULT_ONSET: OnsetOptions = {
  ratio: 1.28,
  floor: 0.22,
  refractoryMs: 220,
  averageRate: 0.06,
}

export class OnsetDetector {
  private readonly options: OnsetOptions
  private average = 0
  private lastFiredAt = Number.NEGATIVE_INFINITY

  constructor(options: OnsetOptions = DEFAULT_ONSET) {
    this.options = options
  }

  /**
   * @param level 低域の強さ 0..1
   * @param nowMs 現在時刻(ms)
   * @returns 打点なら 0..1 の強さ、そうでなければ null
   */
  push(level: number, nowMs: number): number | null {
    const { ratio, floor, refractoryMs, averageRate } = this.options
    const previousAverage = this.average
    this.average += (level - this.average) * averageRate

    const loudEnough = level >= floor
    const spiking = level > previousAverage * ratio
    const settled = nowMs - this.lastFiredAt >= refractoryMs
    if (!loudEnough || !spiking || !settled) return null

    this.lastFiredAt = nowMs
    // 平均をどれだけ超えたかを強さにする。大きく外れた打点ほど大きな波紋になる
    const excess = previousAverage > 0 ? level / previousAverage - 1 : 1
    return Math.min(1, 0.35 + excess * 0.8)
  }
}
