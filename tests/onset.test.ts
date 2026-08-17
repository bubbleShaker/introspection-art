import { describe, expect, it } from 'vitest'
import { DEFAULT_ONSET, OnsetDetector } from '../src/audio/onset.ts'

/** 一定の値を繰り返し流し込み、平均を落ち着かせる */
function settle(detector: OnsetDetector, level: number, count: number, startMs = 0): number {
  let now = startMs
  for (let i = 0; i < count; i++) {
    detector.push(level, now)
    now += 16
  }
  return now
}

describe('OnsetDetector', () => {
  it('平均より十分大きい山を打点として拾う', () => {
    const detector = new OnsetDetector()
    const now = settle(detector, 0.3, 200)
    expect(detector.push(0.9, now + 1000)).not.toBeNull()
  })

  it('下限を下回る小さな音は無視する', () => {
    const detector = new OnsetDetector()
    const now = settle(detector, 0.01, 200)
    // 平均の何倍あっても floor 未満なら鳴らさない
    expect(detector.push(DEFAULT_ONSET.floor - 0.01, now + 1000)).toBeNull()
  })

  it('平均どおりの平坦な音では鳴らない', () => {
    const detector = new OnsetDetector()
    const now = settle(detector, 0.5, 300)
    expect(detector.push(0.5, now + 1000)).toBeNull()
  })

  it('不応期の内は続けて鳴らない', () => {
    const detector = new OnsetDetector()
    const now = settle(detector, 0.3, 200)
    expect(detector.push(0.9, now)).not.toBeNull()
    expect(detector.push(0.95, now + DEFAULT_ONSET.refractoryMs - 1)).toBeNull()
  })

  it('不応期を過ぎれば再び鳴る', () => {
    const detector = new OnsetDetector()
    let now = settle(detector, 0.3, 200)
    expect(detector.push(0.9, now)).not.toBeNull()
    now += DEFAULT_ONSET.refractoryMs + 1
    settle(detector, 0.3, 10, now)
    expect(detector.push(0.95, now + 500)).not.toBeNull()
  })

  it('返す強さは 0..1 に収まる', () => {
    const detector = new OnsetDetector()
    const now = settle(detector, 0.25, 200)
    const strength = detector.push(1, now + 1000)
    expect(strength).not.toBeNull()
    expect(strength!).toBeGreaterThan(0)
    expect(strength!).toBeLessThanOrEqual(1)
  })
})
