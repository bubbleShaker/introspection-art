import { describe, expect, it } from 'vitest'
import sceneSource from '../src/scene/gl/shaders/scene.frag.glsl?raw'
import { packWaveRing, WAVE_RING_POINTS, WAVE_SLOTS } from '../src/scene/waveSphere.ts'

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

describe('シェーダーとの取り決め', () => {
  /**
   * 輪の点の数は、JS とシェーダーの二か所に書いてある。ずれても例外は飛ばない
   * （短ければ余った vec4 が前フレームの値のまま残り、長ければ黙って捨てられる）。
   * 黙って壊れるものは、テストで留めておく。
   */
  it('輪の点の数が、シェーダーの WAVE_POINTS と一致する', () => {
    const found = /const int WAVE_POINTS = (\d+);/.exec(sceneSource)
    expect(found).not.toBeNull()
    expect(Number(found?.[1])).toBe(WAVE_RING_POINTS)
  })

  it('vec4 の本数だけ 4 点ずつ詰めて、輪をちょうど埋め切る', () => {
    expect(WAVE_SLOTS * 4).toBe(WAVE_RING_POINTS)
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
