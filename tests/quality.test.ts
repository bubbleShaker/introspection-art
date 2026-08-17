import { describe, expect, it } from 'vitest'
import { densityLadder, MAX_PIXEL_DENSITY, QualityGovernor } from '../src/scene/gl/quality.ts'

/** 判定が始まるまでのウォームアップを空回しする */
function warmUp(governor: QualityGovernor): void {
  for (let i = 0; i < 200; i++) governor.sample(16)
}

/** 同じフレーム時間を n 回入れて、最後に返った細かさを見る */
function feed(governor: QualityGovernor, deltaMs: number, frames: number): number | null {
  let last: number | null = null
  for (let i = 0; i < frames; i++) {
    const next = governor.sample(deltaMs)
    if (next !== null) last = next
  }
  return last
}

describe('densityLadder', () => {
  it('端末の DPI を超える段は使わない', () => {
    expect(densityLadder(1)).toEqual([1, 0.75])
    expect(densityLadder(1.5)).toEqual([1.5, 1, 0.75])
  })

  it('DPI がいくら高くても頭打ちにする', () => {
    expect(densityLadder(4)[0]).toBe(MAX_PIXEL_DENSITY)
  })

  it('どの段にも満たない DPI でも、空にはしない', () => {
    expect(densityLadder(0.5)).toEqual([0.5])
  })

  it('DPI が取れなかった時は 1 として扱う', () => {
    expect(densityLadder(0)).toEqual([1, 0.75])
  })
})

describe('QualityGovernor', () => {
  it('起動直後の重さでは落とさない', () => {
    const governor = new QualityGovernor(2)
    // ウォームアップの間はどれだけ遅くても据え置き
    expect(feed(governor, 200, 89)).toBeNull()
    expect(governor.density).toBe(2)
  })

  it('30fps のままでも落とさない', () => {
    // 省電力モードや 30Hz の画面では、描画が軽くても 33ms が定常的に出る。
    // ここを重いと読むと、問題の無い端末が最低画質へ落ちてしまう
    const governor = new QualityGovernor(2)
    warmUp(governor)
    expect(feed(governor, 34, 300)).toBeNull()
    expect(governor.density).toBe(2)
  })

  it('明らかに遅ければ 1 段落とす', () => {
    const governor = new QualityGovernor(2)
    warmUp(governor)
    expect(feed(governor, 90, 45)).toBe(1.5)
  })

  it('たまに混じる大きな飛びには引きずられない', () => {
    const governor = new QualityGovernor(2)
    warmUp(governor)
    // 45 フレーム中 5 回だけ跳ねる。中央値で見ているので据え置きになる
    for (let i = 0; i < 45; i++) {
      expect(governor.sample(i % 9 === 0 ? 400 : 16)).toBeNull()
    }
    expect(governor.density).toBe(2)
  })

  it('遅いままなら最後の段まで落ちて、そこで止まる', () => {
    const governor = new QualityGovernor(2)
    warmUp(governor)
    feed(governor, 200, 45 * 10)
    expect(governor.density).toBe(0.75)
    // これ以上は落とさない
    expect(feed(governor, 200, 45 * 3)).toBeNull()
  })

  it('落とした段は戻さない', () => {
    const governor = new QualityGovernor(2)
    warmUp(governor)
    feed(governor, 90, 45)
    expect(governor.density).toBe(1.5)
    // 速くなっても上げ直さない。境目で上下すると作り直しの方が高くつく
    feed(governor, 8, 45 * 4)
    expect(governor.density).toBe(1.5)
  })

  it('進んでいない時刻は数えない', () => {
    const governor = new QualityGovernor(2)
    warmUp(governor)
    expect(feed(governor, 0, 500)).toBeNull()
  })
})
