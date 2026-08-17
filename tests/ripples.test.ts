import { describe, expect, it } from 'vitest'
import {
  opacityRatio,
  progress,
  radiusRatio,
  RIPPLE_LIFE_MS,
  RippleField,
} from '../src/scene/ripples.ts'

describe('radiusRatio', () => {
  it('0 から 1 まで単調に増える', () => {
    expect(radiusRatio(0)).toBe(0)
    expect(radiusRatio(1)).toBe(1)
    expect(radiusRatio(0.25)).toBeCloseTo(0.5)
  })

  it('前半のほうが速く拡がる', () => {
    const early = radiusRatio(0.2) - radiusRatio(0)
    const late = radiusRatio(1) - radiusRatio(0.8)
    expect(early).toBeGreaterThan(late)
  })

  it('範囲外は端で止まる', () => {
    expect(radiusRatio(-1)).toBe(0)
    expect(radiusRatio(2)).toBe(1)
  })
})

describe('opacityRatio', () => {
  it('生まれる前と消えたあとは 0', () => {
    expect(opacityRatio(0)).toBe(0)
    expect(opacityRatio(1)).toBe(0)
    expect(opacityRatio(1.5)).toBe(0)
  })

  it('立ち上がり切ったあとは単調に減る', () => {
    let previous = opacityRatio(0.06)
    for (let t = 0.1; t < 1; t += 0.05) {
      const current = opacityRatio(t)
      expect(current).toBeLessThan(previous)
      previous = current
    }
  })

  it('つねに 0..1 に収まる', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const value = opacityRatio(t)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe('RippleField', () => {
  it('落とした波紋を保持する', () => {
    const field = new RippleField()
    field.spawn(0.5, 0.3, 1, 0)
    expect(field.items).toHaveLength(1)
  })

  it('寿命を過ぎたものを捨てる', () => {
    const field = new RippleField()
    field.spawn(0.5, 0.3, 1, 0)
    field.prune(RIPPLE_LIFE_MS - 1)
    expect(field.items).toHaveLength(1)
    field.prune(RIPPLE_LIFE_MS + 1)
    expect(field.items).toHaveLength(0)
  })

  it('上限を超えたら古いものから捨てる', () => {
    const field = new RippleField(3)
    for (let i = 0; i < 10; i++) field.spawn(i / 10, 0.3, 1, i)
    expect(field.items).toHaveLength(3)
    // 残るのは新しい 3 つ
    expect(field.items.map((r) => r.birth)).toEqual([7, 8, 9])
  })
})

describe('progress', () => {
  it('生まれてからの割合を返す', () => {
    const ripple = { x: 0, depth: 0, birth: 1000, strength: 1 }
    expect(progress(ripple, 1000)).toBe(0)
    expect(progress(ripple, 1000 + RIPPLE_LIFE_MS / 2)).toBeCloseTo(0.5)
  })
})
