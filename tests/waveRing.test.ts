import { describe, expect, it } from 'vitest'
import { ringPointCount, traceWaveRing } from '../src/scene/waveRing.ts'

/** 点 i の中心からの距離 */
function radiusAt(points: Float32Array, i: number): number {
  return Math.hypot(points[i * 2], points[i * 2 + 1])
}

/** 隣り合う点の距離。輪の端（末尾 → 先頭）も含めて数える */
function gaps(points: Float32Array, count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    out.push(Math.hypot(points[i * 2] - points[j * 2], points[i * 2 + 1] - points[j * 2 + 1]))
  }
  return out
}

function buffer(waveLength: number): Float32Array {
  return new Float32Array(ringPointCount(waveLength) * 2)
}

describe('traceWaveRing', () => {
  it('波形を折り返すので、点の数は波形の 2 倍になる', () => {
    const wave = new Float32Array(8)
    const out = buffer(wave.length)
    expect(traceWaveRing(wave, 100, 20, 0, out)).toBe(16)
  })

  it('無音なら、ほぼ真円になる（息づかいのぶんだけ揺れる）', () => {
    const wave = new Float32Array(16)
    const out = buffer(wave.length)
    const count = traceWaveRing(wave, 100, 20, 0, out)

    for (let i = 0; i < count; i++) {
      expect(radiusAt(out, i)).toBeGreaterThan(98)
      expect(radiusAt(out, i)).toBeLessThan(102)
    }
  })

  it('波形の先頭と末尾が食い違っていても、輪に継ぎ目ができない', () => {
    // 折り返さずに一周ぶん配ると、ここで半径が +swing から -swing へ跳ぶ
    const wave = Float32Array.from({ length: 32 }, (_, i) => (i < 16 ? 1 : -1))
    const out = buffer(wave.length)
    const count = traceWaveRing(wave, 100, 30, 0, out)

    const all = gaps(out, count)
    const seam = all[count - 1]
    const others = all.slice(0, count - 1)
    // 継ぎ目が、いちばん広い隣り合わせより広がらない
    expect(seam).toBeLessThanOrEqual(Math.max(...others))
  })

  it('大きな振幅でも、半径が振れ幅を越えて暴れない', () => {
    const wave = Float32Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 5 : -5))
    const out = buffer(wave.length)
    const count = traceWaveRing(wave, 100, 30, 0, out)

    for (let i = 0; i < count; i++) {
      // 基準 100 ± 振れ幅 30 ± 息づかい 1.3（tanh が 1 で頭打ちになるので、ここが上限）
      expect(radiusAt(out, i)).toBeLessThanOrEqual(131.31)
      expect(radiusAt(out, i)).toBeGreaterThanOrEqual(68.69)
    }
  })

  it('時刻が進むと、無音でも輪郭が動く', () => {
    const wave = new Float32Array(16)
    const a = buffer(wave.length)
    const b = buffer(wave.length)
    traceWaveRing(wave, 100, 20, 0, a)
    traceWaveRing(wave, 100, 20, 2, b)
    expect([...a]).not.toEqual([...b])
  })

  it('書き込み先が足りなければ、入るぶんだけ書いて配列の外へ出ない', () => {
    const wave = new Float32Array(16)
    const out = new Float32Array(10)
    expect(traceWaveRing(wave, 100, 20, 0, out)).toBe(5)
  })
})
