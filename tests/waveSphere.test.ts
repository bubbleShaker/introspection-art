import { describe, expect, it } from 'vitest'
import { packWaveRing, waveAt, WAVE_RING_POINTS } from '../src/scene/waveSphere.ts'

function ring(): Float32Array {
  return new Float32Array(WAVE_RING_POINTS)
}

/** 隣り合う値の差。輪の端（末尾 → 先頭）も含めて数える */
function steps(values: Float32Array): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) {
    out.push(Math.abs(values[(i + 1) % values.length] - values[i]))
  }
  return out
}

describe('waveAt', () => {
  /** 経度 lon（0..1）の向きを、単位ベクトルの xz にする */
  function at(values: Float32Array, lon: number, y = 0): number {
    const angle = (lon - 0.5) * Math.PI * 2
    const around = Math.sqrt(1 - y * y)
    return waveAt(values, Math.cos(angle) * around, Math.sin(angle) * around)
  }

  it('その向きの値を引く', () => {
    const values = new Float32Array(WAVE_RING_POINTS)
    values[64] = 1
    // 輪の 64 番目は経度 0.5、つまり +x の向き
    expect(at(values, 64 / WAVE_RING_POINTS)).toBeCloseTo(1, 5)
    expect(at(values, 0)).toBeCloseTo(0, 5)
  })

  it('極では、どの向きでも 0 になる', () => {
    const values = new Float32Array(WAVE_RING_POINTS).fill(1)
    // 極は経度が定まらない。細めないと、輪の全部の値がここでぶつかる
    expect(waveAt(values, 0, 0)).toBe(0)
    expect(at(values, 0.3, 1)).toBeCloseTo(0, 5)
  })

  it('隣り合う点のあいだで段にならない', () => {
    const values = Float32Array.from({ length: WAVE_RING_POINTS }, (_, i) =>
      Math.sin((i / WAVE_RING_POINTS) * Math.PI * 2),
    )

    // 一周を、輪の点よりずっと細かく歩く
    const steps = 400
    let previous = at(values, 0)
    for (let i = 1; i <= steps; i++) {
      const value = at(values, i / steps)
      // 滑らかに繋いでいれば、1 歩の差は 2π / 400 ≒ 0.016 のあたりに収まる。
      // 繋がずに最寄りの点を拾うと、輪の点の上で 2π / 128 ≒ 0.049 の段になる
      expect(Math.abs(value - previous)).toBeLessThan(0.03)
      previous = value
    }
  })

  it('輪が 1 を越えて届いても、-1..1 に収まる', () => {
    const values = new Float32Array(WAVE_RING_POINTS).fill(1.07)
    expect(at(values, 0.25)).toBeLessThanOrEqual(1)
    expect(at(values.map((v) => -v), 0.25)).toBeGreaterThanOrEqual(-1)
  })
})

describe('packWaveRing', () => {
  it('無音なら、息づかいのぶんだけ揺れる', () => {
    const out = ring()
    packWaveRing(new Float32Array(128), 0, out)

    for (const value of out) {
      expect(Math.abs(value)).toBeLessThanOrEqual(0.0701)
    }
  })

  it('波形の先頭と末尾が食い違っていても、輪に継ぎ目ができない', () => {
    // 折り返さずに一周ぶん配ると、ここで +1 から -1 へ跳ぶ
    const wave = Float32Array.from({ length: 128 }, (_, i) => (i < 64 ? 1 : -1))
    const out = ring()
    packWaveRing(wave, 0, out)

    const all = steps(out)
    const seam = all[all.length - 1]
    const others = all.slice(0, -1)
    // 継ぎ目が、いちばん大きい隣り合わせより開かない
    expect(seam).toBeLessThanOrEqual(Math.max(...others))
  })

  it('輪の後半は、前半を逆にたどったものになる', () => {
    const wave = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.3))
    const out = ring()
    // 息づかいを止めて、折り返しだけを見る（sin(角度 * 3) が 0 になる時刻）
    packWaveRing(wave, 0, out)

    const half = WAVE_RING_POINTS / 2
    for (let i = 0; i < half; i++) {
      const mirrored = WAVE_RING_POINTS - 1 - i
      // 息づかいは向きによって違うので、波形そのものの差だけを見る
      const breathA = Math.sin(((i / WAVE_RING_POINTS) * Math.PI * 2) * 3) * 0.07
      const breathB = Math.sin(((mirrored / WAVE_RING_POINTS) * Math.PI * 2) * 3) * 0.07
      expect(out[i] - breathA).toBeCloseTo(out[mirrored] - breathB, 5)
    }
  })

  it('大きな振幅でも、tanh が受け止めて暴れない', () => {
    const wave = Float32Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 5 : -5))
    const out = ring()
    packWaveRing(wave, 0, out)

    for (const value of out) {
      // tanh が 1 で頭打ちになるので、息づかいを足した 1.07 が上限
      expect(Math.abs(value)).toBeLessThanOrEqual(1.07)
    }
  })

  it('波形が輪の点より短くても、輪をすべて埋める', () => {
    const wave = Float32Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5))
    const out = ring()
    out.fill(Number.NaN)
    packWaveRing(wave, 0, out)

    for (const value of out) {
      expect(Number.isNaN(value)).toBe(false)
    }
  })

  it('波形が空でも、息づかいだけの輪になる', () => {
    const out = ring()
    out.fill(Number.NaN)
    packWaveRing(new Float32Array(0), 0, out)

    for (const value of out) {
      expect(Number.isNaN(value)).toBe(false)
      expect(Math.abs(value)).toBeLessThanOrEqual(0.0701)
    }
  })

  it('時刻が進むと、無音でも輪郭が動く', () => {
    const wave = new Float32Array(128)
    const a = ring()
    const b = ring()
    packWaveRing(wave, 0, a)
    packWaveRing(wave, 2, b)
    expect([...a]).not.toEqual([...b])
  })

  it('書き込み先が足りなければ、入るぶんだけ書いて配列の外へ出ない', () => {
    const out = new Float32Array(10)
    packWaveRing(Float32Array.from({ length: 128 }, () => 1), 0, out)
    expect(out.every((value) => value > 0.9)).toBe(true)
  })
})
