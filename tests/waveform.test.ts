import { describe, expect, it } from 'vitest'
import { foldWaveform, followWave, silentWave, WAVE_POINTS } from '../src/audio/waveform.ts'

// getByteTimeDomainData と同じ形の値を、そのまま置いて確かめる。
// 128 が無音、192 が +0.5、64 が -0.5 にあたる
const SILENT = 128
const PLUS_HALF = 192
const MINUS_HALF = 64

describe('foldWaveform', () => {
  it('無音（128 で埋まったデータ）は 0 になる', () => {
    const out = new Float32Array(4)
    foldWaveform(new Uint8Array(64).fill(128), out)
    expect([...out]).toEqual([0, 0, 0, 0])
  })

  it('値域を -1..1 に直す', () => {
    const out = new Float32Array(2)
    foldWaveform(Uint8Array.from([0, 0, 255, 255]), out)
    expect(out[0]).toBeCloseTo(-1, 5)
    expect(out[1]).toBeCloseTo(0.992, 3)
  })

  it('入る点の数だけ、平均して畳む', () => {
    const out = new Float32Array(2)
    // 前半の平均は +0.25、後半の平均は -0.25
    const samples = Uint8Array.from([
      PLUS_HALF, SILENT, PLUS_HALF, SILENT,
      MINUS_HALF, SILENT, MINUS_HALF, SILENT,
    ])
    foldWaveform(samples, out)
    expect(out[0]).toBeCloseTo(0.25, 5)
    expect(out[1]).toBeCloseTo(-0.25, 5)
  })

  it('間引きではなく平均なので、細かい振動は打ち消される', () => {
    const out = new Float32Array(1)
    const samples = Uint8Array.from([
      PLUS_HALF, MINUS_HALF, PLUS_HALF, MINUS_HALF,
      PLUS_HALF, MINUS_HALF, PLUS_HALF, MINUS_HALF,
    ])
    foldWaveform(samples, out)
    expect(out[0]).toBeCloseTo(0, 5)
  })

  it('サンプルより点の数が多くても、割り当てが飛ばない', () => {
    const out = new Float32Array(4)
    foldWaveform(Uint8Array.from([255, 255]), out)
    // 2 サンプルを 4 点へ配る。どの点も、どれかのサンプルを見ている
    expect([...out].every((v) => v > 0.9)).toBe(true)
  })

  it('データが空でも落ちず、0 で埋まる', () => {
    const out = new Float32Array(3).fill(0.5)
    foldWaveform(new Uint8Array(0), out)
    expect([...out]).toEqual([0, 0, 0])
  })

  it('書き込み先が空でも落ちない', () => {
    expect(() => foldWaveform(new Uint8Array(8).fill(200), new Float32Array(0))).not.toThrow()
  })
})

describe('followWave', () => {
  it('今の値へ、割合のぶんだけ寄る', () => {
    const current = Float32Array.from([0, 0])
    followWave(current, Float32Array.from([1, -1]), 0.5)
    expect([...current]).toEqual([0.5, -0.5])
  })

  it('山と谷で追従の速さが変わらない（形が歪まない）', () => {
    const up = Float32Array.from([0])
    const down = Float32Array.from([0])
    followWave(up, Float32Array.from([1]), 0.4)
    followWave(down, Float32Array.from([-1]), 0.4)
    expect(up[0]).toBeCloseTo(-down[0], 6)
  })

  it('割合が 1 なら、生の値そのものになる', () => {
    const current = Float32Array.from([0.3, -0.2])
    followWave(current, Float32Array.from([1, 1]), 1)
    expect([...current]).toEqual([1, 1])
  })

  it('長さが食い違っても、短い方までしか触らない', () => {
    const current = Float32Array.from([0, 0, 0])
    followWave(current, Float32Array.from([1]), 1)
    expect([...current]).toEqual([1, 0, 0])
  })
})

describe('silentWave', () => {
  it('WAVE_POINTS 点の 0 を返す', () => {
    const wave = silentWave()
    expect(wave).toHaveLength(WAVE_POINTS)
    expect([...wave].every((v) => v === 0)).toBe(true)
  })
})
