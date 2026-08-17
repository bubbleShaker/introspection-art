import { describe, expect, it } from 'vitest'
import { advanceParticles, particleBrightness, seedParticles } from '../src/scene/particles.ts'

/** 0..1 を順に返す決め打ちの乱数。撒き方を検証できるようにする */
function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

describe('seedParticles', () => {
  it('指定した数だけ作る', () => {
    expect(seedParticles(50)).toHaveLength(50)
  })

  it('位置は 0..1 に収まる', () => {
    for (const p of seedParticles(200)) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(1)
    }
  })

  it('乱数を渡せば同じ配置を再現できる', () => {
    const a = seedParticles(5, sequence([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]))
    const b = seedParticles(5, sequence([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]))
    expect(a).toEqual(b)
  })
})

describe('advanceParticles', () => {
  it('drift のぶんだけ横に流れる', () => {
    const particles = seedParticles(1, sequence([0.5]))
    particles[0].x = 0.5
    particles[0].drift = 0.1
    advanceParticles(particles, 1)
    expect(particles[0].x).toBeCloseTo(0.6)
  })

  it('右端を越えたら左から戻る', () => {
    const particles = seedParticles(1, sequence([0.5]))
    particles[0].x = 1.0
    particles[0].drift = 0.1
    advanceParticles(particles, 1)
    expect(particles[0].x).toBeLessThan(0.1)
  })

  it('左端を越えたら右から戻る', () => {
    const particles = seedParticles(1, sequence([0.5]))
    particles[0].x = 0
    particles[0].drift = -0.1
    advanceParticles(particles, 1)
    expect(particles[0].x).toBeGreaterThan(0.9)
  })
})

describe('particleBrightness', () => {
  it('つねに 0..1 に収まる', () => {
    const [particle] = seedParticles(1, sequence([0.3]))
    for (let t = 0; t < 20000; t += 137) {
      for (const high of [0, 0.5, 1]) {
        const value = particleBrightness(particle, t, high)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('高域が強いほど明滅の振れ幅が大きい', () => {
    const [particle] = seedParticles(1, sequence([0.3]))
    const range = (high: number) => {
      let min = Infinity
      let max = -Infinity
      for (let t = 0; t < 20000; t += 53) {
        const value = particleBrightness(particle, t, high)
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      return max - min
    }
    expect(range(1)).toBeGreaterThan(range(0))
  })
})
