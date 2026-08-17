/**
 * 空をゆっくり漂う光の粒。
 *
 * 位置は 0..1 の相対値で持つ。画面のリサイズで散らばりが崩れないのと、
 * 解像度に依らず同じ画になるため。
 */
export type Particle = {
  x: number
  y: number
  /** 大きさの係数 0..1 */
  size: number
  /** 横に流れる速さ（1秒あたりの相対値） */
  drift: number
  /** 明滅の周期(ms あたりの角速度) */
  twinkleRate: number
  /** 明滅の位相。粒ごとにずらして一斉に光らないようにする */
  twinklePhase: number
}

/**
 * 粒を撒く。
 *
 * 乱数生成器を引数で受け取るのは、テストで固定した数列を渡せるようにするため。
 */
export function seedParticles(count: number, random: () => number = Math.random): Particle[] {
  const particles: Particle[] = []
  for (let i = 0; i < count; i++) {
    particles.push({
      x: random(),
      // 上ほど密に、水平線際は疎に。2乗で上に寄せている
      y: random() ** 2,
      size: 0.25 + random() ** 3,
      drift: (random() - 0.5) * 0.012,
      twinkleRate: 0.0006 + random() * 0.0018,
      twinklePhase: random() * Math.PI * 2,
    })
  }
  return particles
}

/** 経過時間(秒)ぶん流す。画面の外に出たら反対側から戻す */
export function advanceParticles(particles: Particle[], deltaSeconds: number): void {
  for (const p of particles) {
    p.x += p.drift * deltaSeconds
    if (p.x < -0.02) p.x += 1.04
    else if (p.x > 1.02) p.x -= 1.04
  }
}

/**
 * その瞬間の明るさ 0..1。
 * 高域が強いほど明滅の振れ幅が大きくなり、静かな場面では落ち着く。
 */
export function particleBrightness(p: Particle, timeMs: number, high: number): number {
  const wave = Math.sin(timeMs * p.twinkleRate + p.twinklePhase) * 0.5 + 0.5
  const depth = 0.35 + high * 0.5
  return 1 - depth + wave * depth
}
