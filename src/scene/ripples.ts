/**
 * 水面に落ちる波紋。低域の打点ひとつにつき一つ生まれ、
 * 拡がりながら薄くなって消える。
 *
 * 描画のことは知らず、位置と寿命だけを持つ。ここを分けておくと
 * 減衰の式をテストで確かめられる。
 */
export type Ripple = {
  /** 中心の横位置（0..1 の相対値。画面幅が変わっても崩れない） */
  x: number
  /** 水平線からの落ちた深さ（0..1 の相対値。1 が画面手前） */
  depth: number
  /** 生まれた時刻(ms) */
  birth: number
  /** 打点の強さ 0..1。最終的な大きさと明るさに効く */
  strength: number
}

/** 波紋が生まれてから消えるまで(ms) */
export const RIPPLE_LIFE_MS = 4200

/** 経過の割合 0..1。1 に達したら消える */
export function progress(ripple: Ripple, nowMs: number): number {
  return (nowMs - ripple.birth) / RIPPLE_LIFE_MS
}

/**
 * 半径の伸び。最初は速く、あとはゆっくり。
 * 素直な線形だと機械的に見えるので、平方根で頭打ちにしている。
 */
export function radiusRatio(t: number): number {
  return Math.sqrt(Math.max(0, Math.min(1, t)))
}

/**
 * 明るさ。立ち上がりは一瞬で、そこから長く尾を引く。
 * 「気づいた瞬間があって、あとは静かに薄れる」という形。
 */
export function opacityRatio(t: number): number {
  if (t <= 0 || t >= 1) return 0
  const rise = Math.min(1, t / 0.06)
  const fall = (1 - t) ** 2.2
  return rise * fall
}

export class RippleField {
  private ripples: Ripple[] = []

  /** 同時に持つ上限。増えすぎると描画が重くなるうえ、画も濁る */
  private readonly limit: number

  constructor(limit = 24) {
    this.limit = limit
  }

  get items(): readonly Ripple[] {
    return this.ripples
  }

  /**
   * 波紋を落とす。
   * @param x 0..1 の横位置
   * @param depth 0..1 の深さ
   */
  spawn(x: number, depth: number, strength: number, nowMs: number): void {
    this.ripples.push({ x, depth, birth: nowMs, strength })
    if (this.ripples.length > this.limit) {
      this.ripples.splice(0, this.ripples.length - this.limit)
    }
  }

  /** 寿命の尽きたものを捨てる。毎フレーム呼ぶ */
  prune(nowMs: number): void {
    this.ripples = this.ripples.filter((r) => progress(r, nowMs) < 1)
  }
}
