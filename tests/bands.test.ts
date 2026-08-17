import { describe, expect, it } from 'vitest'
import { bandLevel, binRange, smooth } from '../src/audio/bands.ts'

describe('binRange', () => {
  it('周波数をビン幅で割った添字を返す', () => {
    // sampleRate 48000 / fftSize 2048 = 23.4375 Hz/bin
    expect(binRange(0, 160, 48000, 2048)).toEqual({ from: 0, to: 7 })
  })

  it('ナイキスト周波数を超える指定はビン数で頭打ちにする', () => {
    // 添字の上限は fftSize / 2 = 1024
    expect(binRange(20000, 96000, 48000, 2048).to).toBe(1024)
  })

  it('幅が潰れても最低 1 ビンは残す', () => {
    const range = binRange(100, 100, 48000, 2048)
    expect(range.to).toBeGreaterThan(range.from)
  })

  it('負の周波数を渡されても添字は 0 未満にならない', () => {
    expect(binRange(-100, 200, 48000, 2048).from).toBe(0)
  })
})

describe('bandLevel', () => {
  it('範囲内の平均を 0..1 に正規化する', () => {
    const data = new Uint8Array([255, 255, 0, 0])
    expect(bandLevel(data, { from: 0, to: 2 })).toBe(1)
    expect(bandLevel(data, { from: 0, to: 4 })).toBe(0.5)
  })

  it('配列の長さを超える範囲を渡されても壊れない', () => {
    const data = new Uint8Array([255, 255])
    expect(bandLevel(data, { from: 0, to: 100 })).toBe(1)
  })

  it('空の範囲は 0', () => {
    expect(bandLevel(new Uint8Array([255]), { from: 5, to: 5 })).toBe(0)
  })
})

describe('smooth', () => {
  it('上がる時は attack、下がる時は release の速さで寄る', () => {
    expect(smooth(0, 1, 0.5, 0.1)).toBeCloseTo(0.5)
    expect(smooth(1, 0, 0.5, 0.1)).toBeCloseTo(0.9)
  })

  it('繰り返すと目標値へ収束する', () => {
    let value = 0
    for (let i = 0; i < 200; i++) value = smooth(value, 1, 0.5, 0.1)
    expect(value).toBeCloseTo(1)
  })
})
